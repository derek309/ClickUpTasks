import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, memberLabel, NO_STORE } from "@/lib/taskDocumentServer";
import { recordCheckpoint } from "@/lib/taskDocumentFiles";
import { sanitizeDocHtml, DOC_MAX_RAW_CHARS, DOC_MAX_HTML_CHARS } from "@/lib/docHtml";

// The team's side of a task's client review document: create it, save the
// working copy, reopen it after the client approved, or bring back an earlier
// version. Reads happen in the browser through row level security (db.ts
// fetchTaskDocument); every write comes through here so the HTML is cleaned and
// an approved document stays locked.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const DOC_STAGES: unknown[] = ["draft", "with_client", "client_submitted", "approved", "completed"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;

  const { data: existing } = await supabaseAdmin.from("task_documents").select("*").eq("task_id", id).is("deleted_at", null).maybeSingle();
  if (existing) return json({ document: existing });

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("task_documents")
    .insert({ id: "tdoc_" + randomUUID(), task_id: id, created_by: access.user.memberId, updated_by: access.user.memberId, created_at: now, updated_at: now })
    .select("*").single();
  if (error) {
    // Two teammates creating at once: task_id is unique, so the second insert
    // fails and gets the document the first one made.
    const { data: winner } = await supabaseAdmin.from("task_documents").select("*").eq("task_id", id).is("deleted_at", null).maybeSingle();
    return winner ? json({ document: winner }) : json({ error: error.message }, 400);
  }
  return json({ document: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;

  const text = await req.text();
  if (text.length > DOC_MAX_RAW_CHARS) return json({ error: "This document is too long." }, 413);
  let payload: { body?: unknown; reopen?: unknown; restoreVersion?: unknown; restoreCheckpoint?: unknown; checkpoint?: unknown; title?: unknown; status?: unknown };
  try { payload = JSON.parse(text); } catch { return json({ error: "Invalid request." }, 400); }

  const { data: doc } = await supabaseAdmin.from("task_documents")
    .select("id, approved_at, body, updated_by, created_at").eq("task_id", id).is("deleted_at", null).maybeSingle();
  if (!doc) return json({ error: "This task has no client document yet." }, 404);
  const stamp = { updated_by: access.user.memberId, updated_at: new Date().toISOString() };

  // Reopen: the client approved, and the team wants to change it anyway.
  if (payload?.reopen === true) {
    const { data, error } = await supabaseAdmin.from("task_documents")
      .update({ approved_at: null, approved_version: null, status: "draft", ...stamp })
      .eq("id", doc.id).select("*").single();
    return error ? json({ error: error.message }, 400) : json({ document: data });
  }
  // Pick a stage by hand. Completed locks the document for the team and closes it
  // for the client; any stage but Approved clears a client approval's lock, the
  // same as Reopen. Sends and client actions still move the stage on their own.
  if (typeof payload?.status === "string") {
    if (!DOC_STAGES.includes(payload.status)) return json({ error: "Unknown stage." }, 400);
    const unlock = payload.status === "approved" ? {} : { approved_at: null, approved_version: null };
    const { data, error } = await supabaseAdmin.from("task_documents")
      .update({ status: payload.status, ...unlock, ...stamp }).eq("id", doc.id).select("*").single();
    return error ? json({ error: error.message }, 400) : json({ document: data });
  }
  // Rename. Allowed on an approved document too: the name is the team's label,
  // not part of what the client approved. Empty means "use the task's title".
  if (typeof payload?.title === "string") {
    const title = payload.title.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 200);
    const { data, error } = await supabaseAdmin.from("task_documents")
      .update({ title, ...stamp }).eq("id", doc.id).select("*").single();
    return error ? json({ error: error.message }, 400) : json({ document: data });
  }
  if (doc.approved_at) return json({ error: "This document is approved. Reopen it to make changes." }, 409);

  let body: string;
  if (typeof payload?.restoreVersion === "number") {
    // "Use this version" in the history, including a client's version.
    const { data: v } = await supabaseAdmin.from("task_document_versions")
      .select("body").eq("document_id", doc.id).eq("version", payload.restoreVersion).maybeSingle();
    if (!v) return json({ error: "That version no longer exists." }, 404);
    body = sanitizeDocHtml(v.body as string);
  } else if (typeof payload?.restoreCheckpoint === "string") {
    // "Use this version" on a saved draft.
    const { data: c } = await supabaseAdmin.from("task_document_checkpoints")
      .select("body").eq("document_id", doc.id).eq("id", payload.restoreCheckpoint).maybeSingle();
    if (!c) return json({ error: "That saved draft no longer exists." }, 404);
    body = sanitizeDocHtml(c.body as string);
  } else if (typeof payload?.body === "string") {
    body = sanitizeDocHtml(payload.body);
  } else {
    return json({ error: "Invalid request." }, 400);
  }
  if (body.length > DOC_MAX_HTML_CHARS) return json({ error: "This document is too long." }, 413);

  // approved_at in the filter closes the gap between the check above and this
  // write: a client approving in between makes this update match nothing.
  const { data, error } = await supabaseAdmin.from("task_documents")
    // Unchanged text (a Save draft click with no edits) leaves "something to send" alone.
    .update({ body, ...(body !== doc.body ? { draft_dirty: true } : {}), ...stamp })
    .eq("id", doc.id).is("approved_at", null).select("*").maybeSingle();
  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: "This document is approved. Reopen it to make changes." }, 409);

  // The history of team edits. A Save draft click or bringing back a version is
  // always kept; plain typing is kept every ten minutes or when the draft
  // changes hands (see recordCheckpoint).
  const user = access.user;
  await recordCheckpoint(
    { documentId: doc.id as string, body: (doc.body as string) ?? "", updatedBy: (doc.updated_by as string | null) ?? null, createdAt: doc.created_at as string },
    { id: user.memberId ?? user.id, label: () => memberLabel(user) },
    body,
    payload.checkpoint === true || typeof payload.restoreVersion === "number" || typeof payload.restoreCheckpoint === "string",
  ).catch(() => { /* the save itself landed; a missed history entry must not fail it */ });
  return json({ document: data });
}

// Delete the document (Derek, 2026-09-11: "we also need to be able to delete the
// document", then "restore them for 30 days"). It moves to the task's deleted
// documents: the client's link stops opening (resolveDocToken), nothing else is
// removed, and /restore brings it all back. The daily purge-trash cron removes it
// and its stored files for good after 30 days (trashCleanupServer.ts).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const { data: doc } = await supabaseAdmin.from("task_documents").select("id").eq("task_id", id).is("deleted_at", null).maybeSingle();
  if (!doc) return json({ ok: true });
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("task_documents")
    .update({ deleted_at: now, deleted_by: access.user.memberId, updated_by: access.user.memberId, updated_at: now })
    .eq("id", doc.id);
  return error ? json({ error: error.message }, 400) : json({ ok: true });
}

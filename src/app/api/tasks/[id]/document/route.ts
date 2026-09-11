import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, NO_STORE } from "@/lib/taskDocumentServer";
import { sanitizeDocHtml, DOC_MAX_RAW_CHARS, DOC_MAX_HTML_CHARS } from "@/lib/docHtml";

// The team's side of a task's client review document: create it, save the
// working copy, reopen it after the client approved, or bring back an earlier
// version. Reads happen in the browser through row level security (db.ts
// fetchTaskDocument); every write comes through here so the HTML is cleaned and
// an approved document stays locked.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;

  const { data: existing } = await supabaseAdmin.from("task_documents").select("*").eq("task_id", id).maybeSingle();
  if (existing) return json({ document: existing });

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("task_documents")
    .insert({ id: "tdoc_" + randomUUID(), task_id: id, created_by: access.user.memberId, updated_by: access.user.memberId, created_at: now, updated_at: now })
    .select("*").single();
  if (error) {
    // Two teammates creating at once: task_id is unique, so the second insert
    // fails and gets the document the first one made.
    const { data: winner } = await supabaseAdmin.from("task_documents").select("*").eq("task_id", id).maybeSingle();
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
  let payload: { body?: unknown; reopen?: unknown; restoreVersion?: unknown };
  try { payload = JSON.parse(text); } catch { return json({ error: "Invalid request." }, 400); }

  const { data: doc } = await supabaseAdmin.from("task_documents").select("id, approved_at").eq("task_id", id).maybeSingle();
  if (!doc) return json({ error: "This task has no client document yet." }, 404);
  const stamp = { updated_by: access.user.memberId, updated_at: new Date().toISOString() };

  // Reopen: the client approved, and the team wants to change it anyway.
  if (payload?.reopen === true) {
    const { data, error } = await supabaseAdmin.from("task_documents")
      .update({ approved_at: null, approved_version: null, status: "draft", ...stamp })
      .eq("id", doc.id).select("*").single();
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
  } else if (typeof payload?.body === "string") {
    body = sanitizeDocHtml(payload.body);
  } else {
    return json({ error: "Invalid request." }, 400);
  }
  if (body.length > DOC_MAX_HTML_CHARS) return json({ error: "This document is too long." }, 413);

  // approved_at in the filter closes the gap between the check above and this
  // write: a client approving in between makes this update match nothing.
  const { data, error } = await supabaseAdmin.from("task_documents")
    .update({ body, draft_dirty: true, ...stamp })
    .eq("id", doc.id).is("approved_at", null).select("*").maybeSingle();
  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: "This document is approved. Reopen it to make changes." }, 409);
  return json({ document: data });
}

// SERVER ONLY. The client review document: a task's one editable document, a
// private link that opens only it, and the version history behind both. See
// supabase/task-documents.sql for the tables and publish_task_document_version.
//
// Two audiences, two doors:
//   the team   signed in, checked against the task's own read policy
//   the client no login, a doc_ link token that resolves to exactly one task
//
// Every client write goes through clientPublish, and every publish goes through
// the database function, which locks the document row and refuses a version
// built on stale text. Nothing here writes document data onto the tasks row.
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "./supabaseAdmin";
import { requireUser, callerCanSeeTask, type AuthedUser } from "./serverAuth";
import { hashToken, mintToken, decryptToken } from "./tokenCrypto";
import { PERSONAL_CLIENT_ID, clientAnswerPatch, htmlToText, type TaskStatus } from "./data";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "./waitingNotify";
import { sanitizeDocHtml, DOC_MAX_RAW_CHARS, DOC_MAX_HTML_CHARS } from "./docHtml";
import { shareTeamFiles } from "./taskDocumentFiles";

/** A document link token: `doc_` plus 32 random bytes in base64url. Checked
 *  before anything touches the database, so garbage never costs a query. */
export const DOC_TOKEN_PATTERN = /^doc_[A-Za-z0-9_-]{43}$/;
export const NO_STORE = { "Cache-Control": "private, no-store" };
export type DocKind = "sent" | "client_submitted" | "client_approved";

// Sending changes emails the owner at most this often per document; approval
// always emails, since it happens once and someone has to act on it.
const SUBMIT_EMAIL_COOLDOWN_MS = 15 * 60_000;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
/** Every reason a link does not open looks the same from outside. */
export const docNotFound = () => json({ error: "Not found" }, 404);

// ---------------------------------------------------------------------------
// The client side

export type DocScope = {
  documentId: string;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  waitingOnClient: boolean;
  assigneeId: string | null;
  projectId: string | null;
  clientId: string;
  clientName: string;
  assignedTo: string[];
};

/** The task a link opens, or null for ANY reason it should not open: a bad
 *  format, a link switched off or expired, a task moved to another client, a
 *  task, list or client in the trash, a private task, the Personal client, or a
 *  document no longer on that task. One null, so none of them can be told apart. */
export async function resolveDocToken(token: string): Promise<DocScope | null> {
  if (!DOC_TOKEN_PATTERN.test(token)) return null;
  const { data: link } = await supabaseAdmin.from("task_document_links")
    .select("document_id, bound_task_id, bound_client_id, revoked_at, expires_at")
    .eq("token_hash", hashToken(token)).maybeSingle();
  if (!link || link.revoked_at) return null;
  if (link.expires_at && new Date(link.expires_at as string).getTime() <= Date.now()) return null;

  const { data: task } = await supabaseAdmin.from("tasks")
    .select("id, title, status, waiting_on_client, assignee_id, project_id, client_id, is_private, deleted_at")
    .eq("id", link.bound_task_id as string).maybeSingle();
  if (!task || task.is_private || task.deleted_at) return null;
  if (task.client_id !== link.bound_client_id || task.client_id === PERSONAL_CLIENT_ID) return null;

  const [{ data: client }, { data: project }, { data: doc }] = await Promise.all([
    supabaseAdmin.from("clients").select("id, name, assigned_to, deleted_at").eq("id", task.client_id as string).maybeSingle(),
    task.project_id
      ? supabaseAdmin.from("projects").select("id, deleted_at").eq("id", task.project_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("task_documents").select("id, task_id").eq("id", link.document_id as string).maybeSingle(),
  ]);
  if (!client || client.deleted_at) return null;
  if (project?.deleted_at) return null;
  if (!doc || doc.task_id !== task.id) return null;

  return {
    documentId: doc.id as string,
    taskId: task.id as string,
    taskTitle: task.title as string,
    taskStatus: task.status as string,
    waitingOnClient: task.waiting_on_client === true,
    assigneeId: (task.assignee_id as string | null) ?? null,
    projectId: (task.project_id as string | null) ?? null,
    clientId: client.id as string,
    clientName: client.name as string,
    assignedTo: (client.assigned_to as string[] | null) ?? [],
  };
}

/** The last version the team sent or the client submitted, cleaned again on the
 *  way out. The client always sees this, never the team's unsent working copy. */
export async function latestPublished(documentId: string): Promise<{ version: number; body: string } | null> {
  const { data } = await supabaseAdmin.from("task_document_versions")
    .select("version, body").eq("document_id", documentId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return data ? { version: data.version as number, body: sanitizeDocHtml(data.body as string) } : null;
}

/** A public POST body, refused unless it is JSON from this site and not huge.
 *  Requiring JSON forces a CORS preflight a cross site form cannot pass. */
export async function readPublicJson(req: NextRequest): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: NextResponse }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, res: json({ error: "Send the document as JSON." }, 415) };
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return { ok: false, res: json({ error: "Not allowed." }, 403) };
  const text = await req.text();
  if (text.length > DOC_MAX_RAW_CHARS) return { ok: false, res: json({ error: "This document is too long to send." }, 413) };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, res: json({ error: "Invalid request." }, 400) };
  }
}

/** Publish through the database function. Returns the new version, or -1 stale
 *  base, -2 approved, -3 no document. Throws only when the call itself fails. */
async function publishVersion(documentId: string, baseVersion: number, kind: DocKind, body: string, authorId: string | null, authorLabel: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("publish_task_document_version", {
    p_document_id: documentId, p_base_version: baseVersion, p_kind: kind, p_body: body,
    p_author_id: authorId, p_author_label: authorLabel, p_version_id: "docv_" + randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as number;
}

/** Claim the right to email about a submit, atomically, so two quick submits
 *  cannot both send. Returns true when this call won the claim. */
async function claimSubmitEmail(documentId: string): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SUBMIT_EMAIL_COOLDOWN_MS).toISOString();
  const { data } = await supabaseAdmin.from("task_documents")
    .update({ last_client_notified_at: now.toISOString() })
    .eq("id", documentId)
    .or(`last_client_notified_at.is.null,last_client_notified_at.lt."${cutoff}"`)
    .select("id");
  return (data ?? []).length > 0;
}

/** A line in the task's activity for something the client did. */
async function appendClientEvent(taskId: string, body: string): Promise<void> {
  await supabaseAdmin.rpc("append_comment", {
    task_id: taskId,
    comment: { id: "cm_" + randomUUID(), authorId: "client", kind: "event", at: new Date().toISOString(), body },
  });
}

/** Log a client action on the task and touch the task, in the order clientPublish
 *  explains below, so the team's open drawer refreshes live. */
export async function logClientDocEvent(taskId: string, body: string): Promise<void> {
  await appendClientEvent(taskId, body);
  await supabaseAdmin.from("tasks").update({ updated_by: null }).eq("id", taskId);
}

export type PublishOutcome =
  | { ok: true; version: number }
  | { ok: false; status: number; error: string; current?: { version: number; body: string } | null };

/** A client sends changes or approves. In order: refuse a closed task, clean the
 *  HTML, publish against the version they started from, log it on the task,
 *  update the task, then tell the owner.
 *
 *  The comment goes in BEFORE the task update, and the update sets updated_by to
 *  null. append_comment stamps updated_by with the comment's author (keeping the
 *  last teammate's id when there is none), and the team's app ignores a realtime
 *  event whose updated_by is the viewer, so writing the task last is what makes
 *  the change show up live for whoever last touched it. */
export async function clientPublish(scope: DocScope, kind: "client_submitted" | "client_approved", rawHtml: unknown, baseVersion: unknown): Promise<PublishOutcome> {
  if (typeof rawHtml !== "string" || typeof baseVersion !== "number" || !Number.isInteger(baseVersion)) {
    return { ok: false, status: 400, error: "Invalid request." };
  }
  if (scope.taskStatus === "done") return { ok: false, status: 400, error: "This document is closed." };
  const html = sanitizeDocHtml(rawHtml);
  if (html.length > DOC_MAX_HTML_CHARS) return { ok: false, status: 413, error: "This document is too long to send." };
  if (!htmlToText(html).trim()) return { ok: false, status: 400, error: "The document is empty." };

  let version: number;
  try {
    version = await publishVersion(scope.documentId, baseVersion, kind, html, null, scope.clientName);
  } catch {
    return { ok: false, status: 500, error: "Could not save. Please try again." };
  }
  if (version === -1 || version === -2) {
    return {
      ok: false, status: 409,
      error: version === -2 ? "This document is already approved." : "The team posted a newer version while you were editing.",
      current: await latestPublished(scope.documentId),
    };
  }
  if (version < 0) return { ok: false, status: 404, error: "Not found" };

  const approved = kind === "client_approved";
  await appendClientEvent(scope.taskId, approved
    ? `${scope.clientName} approved the client document (version ${version})`
    : `${scope.clientName} sent changes to the client document (version ${version})`);

  const recipient = scope.assigneeId ?? await resolveNotifyRecipient(scope.assignedTo);
  const patch = clientAnswerPatch(
    { status: scope.taskStatus, waiting_on_client: scope.waitingOnClient, assignee_id: scope.assigneeId },
    recipient,
    (approved ? "approved" : "review") as TaskStatus,
  );
  await supabaseAdmin.from("tasks").update({ ...patch, updated_by: null }).eq("id", scope.taskId);

  if (recipient && (approved || await claimSubmitEmail(scope.documentId))) {
    await notifyTeamOfClientActivity({
      notifyRecipient: recipient, clientId: scope.clientId, taskId: scope.taskId, projectId: scope.projectId,
      clientName: scope.clientName, taskTitle: scope.taskTitle,
      notifText: approved
        ? `${scope.clientName} approved the client document on "${scope.taskTitle}".`
        : `${scope.clientName} sent changes to the client document on "${scope.taskTitle}".`,
      subject: approved
        ? `${scope.clientName} approved "${scope.taskTitle}"`
        : `${scope.clientName} sent changes on "${scope.taskTitle}"`,
    });
  }
  return { ok: true, version };
}

// ---------------------------------------------------------------------------
// The team side

export type TeamTask = { id: string; title: string; client_id: string; project_id: string | null; status: string };

/** A signed-in teammate who can see this task, and the task. Refuses a task in
 *  the trash, a private task and the Personal client: a document is for sharing,
 *  and neither of those may ever be shared. */
export async function teamDocAccess(req: NextRequest, taskId: string): Promise<{ ok: true; user: AuthedUser; task: TeamTask } | { ok: false; res: NextResponse }> {
  const user = await requireUser(req);
  if (!user) return { ok: false, res: json({ error: "Unauthorized" }, 401) };
  if (!(await callerCanSeeTask(req, taskId))) return { ok: false, res: json({ error: "Not found" }, 404) };
  const { data: task } = await supabaseAdmin.from("tasks")
    .select("id, title, client_id, project_id, status, is_private, deleted_at").eq("id", taskId).maybeSingle();
  if (!task || task.deleted_at) return { ok: false, res: json({ error: "Not found" }, 404) };
  if (task.is_private || task.client_id === PERSONAL_CLIENT_ID) {
    return { ok: false, res: json({ error: "A private task can't have a client document." }, 400) };
  }
  return { ok: true, user, task: task as TeamTask };
}

/** The teammate's name for the version history, falling back to their email. */
export async function memberLabel(user: AuthedUser): Promise<string> {
  const { data } = await supabaseAdmin.from("profiles").select("name").eq("id", user.id).maybeSingle();
  return ((data?.name as string | null) ?? "").trim() || user.email;
}

export const docUrl = (origin: string, rawToken: string) => `${origin}/doc/${rawToken}`;

/** Whether the document has a live link, and its URL when it can be copied.
 *  A live link with no ciphertext (made without TOKEN_ENC_KEY) works but cannot
 *  be shown again; the team makes a new one instead. */
export async function linkState(documentId: string, origin: string): Promise<{ live: boolean; url: string | null }> {
  const { data } = await supabaseAdmin.from("task_document_links")
    .select("token_hash, token_enc, revoked_at").eq("document_id", documentId).maybeSingle();
  const live = !!data?.token_hash && !data.revoked_at;
  const raw = live ? decryptToken(data?.token_enc as string | null) : null;
  return { live, url: raw ? docUrl(origin, raw) : null };
}

/** A brand new link for the document, replacing any old one, bound to the task's
 *  client as it is right now. Returns the URL, shown to the teammate once. */
export async function mintDocLink(documentId: string, task: TeamTask, user: AuthedUser, origin: string): Promise<string> {
  const { raw, hash, enc } = mintToken("doc_");
  const { error } = await supabaseAdmin.from("task_document_links").upsert({
    document_id: documentId, token_hash: hash, token_enc: enc,
    bound_task_id: task.id, bound_client_id: task.client_id,
    created_by: user.memberId, created_at: new Date().toISOString(), revoked_at: null, expires_at: null,
  }, { onConflict: "document_id" });
  if (error) throw new Error(error.message);
  return docUrl(origin, raw);
}

/** Switch the link off for good. The token is deleted, so it can never work
 *  again; switching back on always makes a new link. */
export async function revokeDocLink(documentId: string): Promise<void> {
  await supabaseAdmin.from("task_document_links")
    .update({ token_hash: null, token_enc: null, revoked_at: new Date().toISOString() })
    .eq("document_id", documentId);
}

/** The team sends the current working copy as a new version. */
export async function teamSend(documentId: string, baseVersion: number, user: AuthedUser): Promise<PublishOutcome> {
  const { data: doc } = await supabaseAdmin.from("task_documents").select("body").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false, status: 404, error: "Not found" };
  const html = sanitizeDocHtml(doc.body as string);
  if (!htmlToText(html).trim()) return { ok: false, status: 400, error: "Write the document before sending it." };
  let version: number;
  try {
    version = await publishVersion(documentId, baseVersion, "sent", html, user.memberId, await memberLabel(user));
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "Could not send." };
  }
  if (version === -1) return { ok: false, status: 409, error: "The client sent a newer version. Review it before sending again.", current: await latestPublished(documentId) };
  if (version === -2) return { ok: false, status: 409, error: "This document is approved. Reopen it to send changes." };
  if (version < 0) return { ok: false, status: 404, error: "Not found" };
  await shareTeamFiles(documentId);
  return { ok: true, version };
}

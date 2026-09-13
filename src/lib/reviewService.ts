// SERVER ONLY. A task's review documents (the client document, the image review and
// the HTML review) changed by an actor rather than a request. The team routes build
// the actor from the signed in teammate (teamActor); Claude over MCP acts as its own
// member (mcpReviewServices.ts). So every rule lives here once: one live review per
// task and kind, the approval lock, versions, the 30 day restore and sending.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { liveDocument, linkState, mintDocLink, setWorkingFile, teamSend, type ReviewActor, type TeamTask } from "./taskDocumentServer";
import { docVersionFile, recordCheckpoint, removeVersionFile, sharedVersionFiles } from "./taskDocumentFiles";
import { sanitizeDocHtml, DOC_MAX_HTML_CHARS } from "./docHtml";
import { filePurpose, kindWhat, noDocumentYet, type FileKind, type ReviewKind } from "./reviewKinds";

type Row = Record<string, unknown>;
export type ReviewOutcome<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; current?: unknown };

export const REVIEW_STAGES = ["draft", "with_client", "client_submitted", "approved", "completed"] as const;
const RESTORE_DAYS = 30;
const COLUMNS = "id, approved_at, body, updated_by, created_at";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const stampOf = (actor: ReviewActor) => ({ updated_by: actor.memberId, updated_at: new Date().toISOString() });
const locked = (kind: ReviewKind) => `This ${kindWhat(kind)} is approved. Reopen it to make changes.`;

async function update(documentId: string, patch: Row): Promise<ReviewOutcome<{ document: Row }>> {
  const { data, error } = await supabaseAdmin.from("task_documents").update(patch).eq("id", documentId).select("*").single();
  return error ? fail(400, error.message) : { ok: true, document: data as Row };
}

/** The task's review of a kind, made if there is none. Two made at once: one live
 *  review per task and kind, so the second insert fails and gets the first. */
export async function createReview(task: TeamTask, kind: ReviewKind, actor: ReviewActor): Promise<ReviewOutcome<{ document: Row; created: boolean }>> {
  const existing = await liveDocument(task.id, kind, "*");
  if (existing) return { ok: true, document: existing, created: false };
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("task_documents")
    .insert({ id: "tdoc_" + randomUUID(), task_id: task.id, kind, created_by: actor.memberId, updated_by: actor.memberId, created_at: now, updated_at: now })
    .select("*").single();
  if (!error) return { ok: true, document: data as Row, created: true };
  const winner = await liveDocument(task.id, kind, "*");
  return winner ? { ok: true, document: winner, created: false } : fail(400, error.message);
}

/** The client approved, and the team wants to change it anyway. */
export async function reopenReview(taskId: string, kind: ReviewKind, actor: ReviewActor): Promise<ReviewOutcome<{ document: Row }>> {
  const doc = await liveDocument(taskId, kind);
  if (!doc) return fail(404, noDocumentYet(kind));
  return update(doc.id, { approved_at: null, approved_version: null, status: "draft", ...stampOf(actor) });
}

/** Pick a stage by hand. Completed locks it for the team and closes it for the
 *  client; any stage but Approved clears a client approval's lock, like Reopen.
 *  Sends and client actions still move the stage on their own. */
export async function setReviewStage(taskId: string, kind: ReviewKind, actor: ReviewActor, stage: unknown): Promise<ReviewOutcome<{ document: Row }>> {
  if (!(REVIEW_STAGES as readonly unknown[]).includes(stage)) return fail(400, "Unknown stage.");
  const doc = await liveDocument(taskId, kind);
  if (!doc) return fail(404, noDocumentYet(kind));
  const unlock = stage === "approved" ? {} : { approved_at: null, approved_version: null };
  return update(doc.id, { status: stage, ...unlock, ...stampOf(actor) });
}

/** Allowed on an approved review too: the name is the team's label, not part of
 *  what the client approved. Empty means "use the task's title". */
export async function renameReview(taskId: string, kind: ReviewKind, actor: ReviewActor, rawTitle: string): Promise<ReviewOutcome<{ document: Row }>> {
  const doc = await liveDocument(taskId, kind);
  if (!doc) return fail(404, noDocumentYet(kind));
  return update(doc.id, { title: rawTitle.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 200), ...stampOf(actor) });
}

/** The client document's working copy: new text, or an earlier version or saved
 *  draft brought back. Cleaned on the way in; a Save draft click or a restore is
 *  always kept in the history, typing every ten minutes (recordCheckpoint). */
export async function writeDocBody(
  taskId: string, actor: ReviewActor,
  input: { body?: unknown; restoreVersion?: unknown; restoreCheckpoint?: unknown; checkpoint?: unknown },
): Promise<ReviewOutcome<{ document: Row }>> {
  const doc = await liveDocument(taskId, "doc", COLUMNS);
  if (!doc) return fail(404, noDocumentYet("doc"));
  if (doc.approved_at) return fail(409, locked("doc"));
  let body: string;
  if (typeof input.restoreVersion === "number") {
    const { data: v } = await supabaseAdmin.from("task_document_versions")
      .select("body").eq("document_id", doc.id).eq("version", input.restoreVersion).maybeSingle();
    if (!v) return fail(404, "That version no longer exists.");
    body = sanitizeDocHtml(v.body as string);
  } else if (typeof input.restoreCheckpoint === "string") {
    const { data: c } = await supabaseAdmin.from("task_document_checkpoints")
      .select("body").eq("document_id", doc.id).eq("id", input.restoreCheckpoint).maybeSingle();
    if (!c) return fail(404, "That saved draft no longer exists.");
    body = sanitizeDocHtml(c.body as string);
  } else if (typeof input.body === "string") {
    body = sanitizeDocHtml(input.body);
  } else {
    return fail(400, "Invalid request.");
  }
  if (body.length > DOC_MAX_HTML_CHARS) return fail(413, "This document is too long.");

  // approved_at in the filter closes the gap between the check above and this
  // write: a client approving in between makes this update match nothing.
  const { data, error } = await supabaseAdmin.from("task_documents")
    // Unchanged text (a Save draft click with no edits) leaves "something to send" alone.
    .update({ body, ...(body !== doc.body ? { draft_dirty: true } : {}), ...stampOf(actor) })
    .eq("id", doc.id).is("approved_at", null).select("*").maybeSingle();
  if (error) return fail(400, error.message);
  if (!data) return fail(409, locked("doc"));
  await recordCheckpoint(
    { documentId: doc.id, body: (doc.body as string) ?? "", updatedBy: (doc.updated_by as string | null) ?? null, createdAt: doc.created_at as string },
    { id: actor.id, label: actor.label },
    body,
    input.checkpoint === true || typeof input.restoreVersion === "number" || typeof input.restoreCheckpoint === "string",
  ).catch(() => { /* the save itself landed; a missed history entry must not fail it */ });
  return { ok: true, document: data as Row };
}

/** An image or HTML review's working copy is the version file to send next: an
 *  uploaded file, or "Use this version" (a client's page included). */
export async function pickReviewVersion(
  taskId: string, kind: FileKind, actor: ReviewActor, input: { file?: unknown; restoreVersion?: unknown },
): Promise<ReviewOutcome<{ document: Row }>> {
  const doc = await liveDocument(taskId, kind, COLUMNS);
  if (!doc) return fail(404, noDocumentYet(kind));
  if (doc.approved_at) return fail(409, locked(kind));
  let fileId = input.file;
  if (typeof input.restoreVersion === "number") {
    const { data: v } = await supabaseAdmin.from("task_document_versions")
      .select("body").eq("document_id", doc.id).eq("version", input.restoreVersion).maybeSingle();
    if (!v) return fail(404, "That version no longer exists.");
    fileId = v.body;
  }
  const file = await docVersionFile(doc.id, fileId, filePurpose(kind), false);
  if (!file) return fail(400, kind === "image" ? "Upload the image first." : "That version is no longer on the review.");
  try {
    const data = await setWorkingFile(doc.id, file.id, (doc.body as string) ?? "", stampOf(actor));
    return data ? { ok: true, document: data } : fail(409, locked(kind));
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "Could not save.");
  }
}

/** Take a wrong version off (Derek, 2026-09-12). When it was the version under
 *  review, the review goes back to the newest one the client can still see, or to
 *  none at all, with nothing left to send. */
export async function removeReviewVersion(taskId: string, kind: FileKind, actor: ReviewActor, fileId: unknown): Promise<ReviewOutcome<{ document: Row }>> {
  const doc = await liveDocument(taskId, kind, COLUMNS);
  if (!doc) return fail(404, noDocumentYet(kind));
  if (doc.approved_at) return fail(409, locked(kind));
  const removed = await removeVersionFile(doc.id, fileId, filePurpose(kind), { id: actor.id, label: await actor.label() });
  if (!removed.ok) return fail(removed.status, removed.error);
  const newest = (await sharedVersionFiles(doc.id)).at(-1)?.fileId ?? "";
  const moveOff = doc.body === removed.id ? { body: newest, draft_dirty: false } : {};
  return update(doc.id, { ...moveOff, ...stampOf(actor) });
}

/** Move the review to the task's deleted documents (Derek, 2026-09-11). The
 *  client's link stops opening, nothing else is removed, restoreReview brings it
 *  all back, and the daily purge removes it for good after 30 days. */
export async function deleteReview(taskId: string, kind: ReviewKind, actor: ReviewActor): Promise<ReviewOutcome<{ deleted: boolean }>> {
  const doc = await liveDocument(taskId, kind);
  if (!doc) return { ok: true, deleted: false };
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("task_documents")
    .update({ deleted_at: now, deleted_by: actor.memberId, updated_by: actor.memberId, updated_at: now }).eq("id", doc.id);
  return error ? fail(400, error.message) : { ok: true, deleted: true };
}

/** Bring back a review deleted in the last 30 days, with its versions, drafts,
 *  files, comments and the same client link. Without an id, the newest one of the
 *  kind. A task has one live review of each kind, so this waits until the current
 *  one is deleted. */
export async function restoreReview(taskId: string, kind: ReviewKind, actor: ReviewActor, documentId: string | null): Promise<ReviewOutcome<{ document: Row }>> {
  const what = { doc: "a document", image: "an image review", page: "an HTML review" }[kind];
  const taken = `This task already has ${what}. Delete that one first, then restore this one.`;
  if (await liveDocument(taskId, kind)) return fail(409, taken);
  const cutoff = new Date(Date.now() - RESTORE_DAYS * 86_400_000).toISOString();
  let id = documentId;
  if (!id) {
    const { data: newest } = await supabaseAdmin.from("task_documents")
      .select("id").eq("task_id", taskId).eq("kind", kind).gt("deleted_at", cutoff)
      .order("deleted_at", { ascending: false }).limit(1).maybeSingle();
    if (!newest) return fail(404, `There is no deleted ${kindWhat(kind)} to restore from the last ${RESTORE_DAYS} days.`);
    id = newest.id as string;
  }
  const { data, error } = await supabaseAdmin.from("task_documents")
    .update({ deleted_at: null, deleted_by: null, updated_by: actor.memberId, updated_at: new Date().toISOString() })
    .eq("id", id).eq("task_id", taskId).eq("kind", kind).gt("deleted_at", cutoff)
    .select("*").maybeSingle();
  // A review restored or made at the same moment trips the one live review rule.
  if (error) return fail(409, taken);
  if (!data) return fail(404, "That document can no longer be restored.");
  return { ok: true, document: data as Row };
}

/** Send for review: the working copy becomes the next version the client sees, and
 *  the first send turns on the client's private link. Turning a link on is admin
 *  only, checked before publishing, so a send that can't reach the client never
 *  leaves a version behind. Moving the task to Waiting is the caller's step. */
export async function sendReview(
  task: TeamTask, kind: ReviewKind, actor: ReviewActor, baseVersion: number, origin: string,
): Promise<ReviewOutcome<{ version: number; url: string | null; documentId: string }>> {
  const doc = await liveDocument(task.id, kind);
  if (!doc) return fail(404, noDocumentYet(kind));
  const link = await linkState(doc.id, origin);
  if (!link.live && !actor.admin) return fail(403, "Ask an admin to send this the first time. That turns on the client's link.");
  const outcome = await teamSend(doc.id, baseVersion, actor);
  if (!outcome.ok) return { ok: false, status: outcome.status, error: outcome.error, current: outcome.current ?? null };
  const url = link.live ? link.url : await mintDocLink(doc.id, task, actor, origin);
  return { ok: true, version: outcome.version, url, documentId: doc.id };
}

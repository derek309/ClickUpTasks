// SERVER ONLY. A task's review documents (the client document, the image review and
// the HTML review) changed by an actor rather than a request. The team routes build
// the actor from the signed in teammate (teamActor); Claude over MCP acts as its own
// member (mcpReviewServices.ts). So every rule lives here once: one live review per
// task and kind, the approval lock, versions, the 30 day restore and sending.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { appendTaskEvent, liveDocument, linkState, mintDocLink, setWorkingFile, teamSend, type ReviewActor, type TeamTask } from "./taskDocumentServer";
import { reviewApprovedByTeamEvent } from "./data";
import { docVersionFile, recordCheckpoint, removeVersionFile, sharedVersionFiles } from "./taskDocumentFiles";
import { sanitizeDocHtml, DOC_MAX_HTML_CHARS } from "./docHtml";
import { filePurpose, kindNoun, kindWhat, noDocumentYet, type FileKind, type ReviewKind } from "./reviewKinds";
import { nameReviewIfDefault } from "./reviewAutoName";
import { cleanImageSet, formatImageSet, parseImageSet, setFiles } from "./imageSet";

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
 *  client; any stage but Approved clears an approval's lock, like Reopen.
 *  Sends and client actions still move the stage on their own.
 *
 *  Approved here is the team closing a review out on the client's say so, so it
 *  approves it properly: it records when, which version, and who, rather than
 *  only moving the label. It used to set the status alone, which left the client's
 *  page locked and thanking them while the team's side stayed open (Derek,
 *  2026-09-17). approved_by is what keeps this honest: the client's own approval
 *  leaves it null, so nobody is told they clicked a button they never clicked. */
export async function setReviewStage(taskId: string, kind: ReviewKind, actor: ReviewActor, stage: unknown): Promise<ReviewOutcome<{ document: Row }>> {
  if (!(REVIEW_STAGES as readonly unknown[]).includes(stage)) return fail(400, "Unknown stage.");
  const doc = await liveDocument(taskId, kind, "id, approved_at, version");
  if (!doc) return fail(404, noDocumentYet(kind));
  const approving = stage === "approved" && !doc.approved_at;
  const lock = stage === "approved"
    // Already approved (the client got there first): keep their approval as it is.
    ? (doc.approved_at ? {} : { approved_at: new Date().toISOString(), approved_version: (doc.version as number) ?? null, approved_by: actor.memberId })
    : { approved_at: null, approved_version: null, approved_by: null };
  const done = await update(doc.id, { status: stage, ...lock, ...stampOf(actor) });
  // On the task's record, like the client's own approval is, so it can be found
  // afterwards: the Finished feed reads these lines, and a team approval used to
  // leave none. Only on the approval itself, not on a re-pick of Approved.
  if (done.ok && approving && actor.memberId) {
    await appendTaskEvent(taskId, reviewApprovedByTeamEvent(kindNoun(kind), (doc.version as number) ?? 0), actor.memberId);
  }
  return done;
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
  // Its first real words give a document still called "New document" a name.
  const named = await nameReviewIfDefault(data as Row, { kind: "doc", html: body });
  return { ok: true, document: named ?? (data as Row) };
}

/** An image or HTML review's working copy is the version to send next: an uploaded
 *  file, "Use this version" (a client's page included), or a set of up to 10 files
 *  with their labels (imageSet.ts): an image review's postcard front and back
 *  (Derek, 2026-09-14), an HTML review's two emails (Derek, 2026-09-16). */
export async function pickReviewVersion(
  taskId: string, kind: FileKind, actor: ReviewActor, input: { file?: unknown; images?: unknown; restoreVersion?: unknown },
): Promise<ReviewOutcome<{ document: Row }>> {
  const doc = await liveDocument(taskId, kind, COLUMNS);
  if (!doc) return fail(404, noDocumentYet(kind));
  if (doc.approved_at) return fail(409, locked(kind));
  let body: string;
  if (typeof input.restoreVersion === "number") {
    const { data: v } = await supabaseAdmin.from("task_document_versions")
      .select("body").eq("document_id", doc.id).eq("version", input.restoreVersion).maybeSingle();
    if (!v) return fail(404, "That version no longer exists.");
    body = v.body as string;
  } else if (input.images !== undefined) {
    const items = cleanImageSet(input.images);
    if (!items) return fail(400, `A version holds 1 to 10 different ${kind === "page" ? "pages" : "images"}.`);
    body = formatImageSet(items);
  } else {
    // One file, or a set passed back as its body ("Use this version" over MCP), cleaned like a new one.
    const items = typeof input.file === "string" ? cleanImageSet(parseImageSet(input.file)) : null;
    body = items ? formatImageSet(items) : "";
  }
  const ids = setFiles(body);
  const files = await Promise.all(ids.map((id) => docVersionFile(doc.id, id, filePurpose(kind), false)));
  const first = files[0];
  if (!first || files.some((f) => !f)) {
    const missing = { image: "Upload the image first.", video: "Upload the video first." }[kind as string]
      ?? "That page is no longer on the review.";
    return fail(400, missing);
  }
  try {
    const data = await setWorkingFile(doc.id, body, (doc.body as string) ?? "", stampOf(actor));
    if (!data) return fail(409, locked(kind));
    // Its first image, page or video gives a review still called "New image
    // review" a name. A video is named from its file name (reviewAutoName.ts).
    const named = await nameReviewIfDefault(data, { kind, path: first.path, fileName: first.name });
    return { ok: true, document: named ?? data };
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "Could not save.");
  }
}

/** Take a wrong version off (Derek, 2026-09-12). target is the version's body: a
 *  file id, or a set of images. Only the images no other version (or the working
 *  copy) uses go, with their pins, so a front carried into later versions stays.
 *  When the working copy lost an image, the review goes back to the newest version
 *  the client can still see, or to none at all, with nothing left to send. */
export async function removeReviewVersion(taskId: string, kind: FileKind, actor: ReviewActor, target: unknown): Promise<ReviewOutcome<{ document: Row }>> {
  const doc = await liveDocument(taskId, kind, COLUMNS);
  if (!doc) return fail(404, noDocumentYet(kind));
  if (doc.approved_at) return fail(409, locked(kind));
  const targetFiles = setFiles(target);
  if (!targetFiles.length) return fail(404, "That version is already gone.");
  const { data: versions } = await supabaseAdmin.from("task_document_versions").select("body").eq("document_id", doc.id);
  const others = new Set([...(versions ?? []).map((v) => v.body as string), (doc.body as string) ?? ""]
    .filter((body) => body && body !== target).flatMap(setFiles));
  const going = targetFiles.filter((id) => !others.has(id));
  if (!going.length) return fail(400, `This version only reuses ${kind === "page" ? "pages" : "images"} from other versions, so there is nothing to take off.`);
  const who = { id: actor.id, label: await actor.label() };
  for (const id of going) {
    const removed = await removeVersionFile(doc.id, id, filePurpose(kind), who);
    if (!removed.ok) return fail(removed.status, removed.error);
  }
  const newest = (await sharedVersionFiles(doc.id)).at(-1)?.body ?? "";
  const moveOff = setFiles(doc.body).some((id) => going.includes(id)) ? { body: newest, draft_dirty: false } : {};
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
  const what = { doc: "a document", image: "an image review", page: "an HTML review", video: "a video review" }[kind];
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

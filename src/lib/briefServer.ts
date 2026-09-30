// SERVER ONLY. Project instructions on a task (supabase/task-briefs.sql): the
// team writes them, shares one read only link with an outside person (a Fiverr
// designer), and that person can send their files back through it. Files sent
// back stay on the task until the team puts them in the image review, where the
// client sees nothing until the team presses Send.
//
// Two doors, like the client document (taskDocumentServer.ts), and nothing
// shared with it: the link is a brf_ token, its own table, and it opens only
// the instructions. The outside page never gets the client's contact details,
// the task's other work, comments or anything that acts as the client.
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "./supabaseAdmin";
import { TASK_FILES_BUCKET } from "./db";
import { hashToken, mintToken, decryptToken } from "./tokenCrypto";
import { PERSONAL_CLIENT_ID } from "./data";
import { sanitizeDocHtml, DOC_MAX_HTML_CHARS } from "./docHtml";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "./waitingNotify";
import { appendTaskEvent, teamDocAccess, type ReviewActor, type TeamTask } from "./taskDocumentServer";
import type { AuthedUser } from "./serverAuth";
import { UPLOAD_OBJECT_NAME, adoptImageFile, checkStoredFile } from "./taskDocumentFiles";
import { createReview, pickReviewVersion, type ReviewOutcome } from "./reviewService";
import { frontFirst, MAX_SET_IMAGES, type ImageSetItem } from "./imageSet";
import { BRIEF_TOKEN_PATTERN, BRIEF_TITLE, cleanDue, cleanLinkDays, cleanOutsideName, templateHtml } from "./brief";
import {
  cleanFileName, extOf, isDesignFileName, isPreviewableImage, isShareableFileName, maxUploadBytes, sharedFileKind, storageSafeName, type SharedFileKind,
} from "./uploadTypes";

export const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
/** Every reason a link does not open looks the same from outside. */
export const briefNotFound = () => json({ error: "Not found" }, 404);

type Row = Record<string, unknown>;
type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Files one set of instructions can hold, the team's and the ones sent back. */
export const MAX_BRIEF_FILES = 60;
/** Files sent back ring the owner at most this often. */
const OUTSIDE_NOTIFY_COOLDOWN_MS = 15 * 60_000;

export const briefFolder = (briefId: string) => `brief/${briefId}/`;
export const briefUrl = (origin: string, raw: string) => `${origin}/brief/${raw}`;

// ---------------------------------------------------------------------------
// The team side

/** A signed in teammate who can see the task, and the task. The same gate as the
 *  client document: never a private task or the Personal client. */
export const teamBriefAccess = teamDocAccess;

export async function liveBrief(taskId: string): Promise<Row | null> {
  const { data } = await supabaseAdmin.from("task_briefs").select("*").eq("task_id", taskId).maybeSingle();
  return (data as Row | null) ?? null;
}

const stampOf = (actor: Pick<ReviewActor, "memberId">) => ({ updated_by: actor.memberId, updated_at: new Date().toISOString() });

/** The task's instructions, made from a template if there are none. Two made at
 *  once: the unique index refuses the second, which then gets the first. */
export async function createBrief(task: TeamTask, actor: ReviewActor, template: unknown): Promise<ReviewOutcome<{ brief: Row }>> {
  const existing = await liveBrief(task.id);
  if (existing) return { ok: true, brief: existing };
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("task_briefs").insert({
    id: "tbr_" + randomUUID(), task_id: task.id, body: sanitizeDocHtml(templateHtml(template)),
    created_by: actor.memberId, updated_by: actor.memberId, created_at: now, updated_at: now,
  }).select("*").single();
  if (!error) return { ok: true, brief: data as Row };
  const winner = await liveBrief(task.id);
  return winner ? { ok: true, brief: winner } : fail(400, error.message);
}

/** Saves what changed: the text, the name, the due date, and the two switches. */
export async function saveBrief(taskId: string, actor: ReviewActor, input: Row): Promise<ReviewOutcome<{ brief: Row }>> {
  const brief = await liveBrief(taskId);
  if (!brief) return fail(404, "There are no project instructions on this task yet.");
  const patch: Row = {};
  if (typeof input.body === "string") {
    const body = sanitizeDocHtml(input.body);
    if (body.length > DOC_MAX_HTML_CHARS) return fail(413, "These instructions are too long.");
    patch.body = body;
  }
  if (typeof input.title === "string") patch.title = input.title.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 200);
  if (input.due !== undefined) {
    const due = cleanDue(input.due);
    if (due === undefined) return fail(400, "Pick a real date.");
    patch.due_on = due;
  }
  if (typeof input.showBusiness === "boolean") patch.show_business = input.showBusiness;
  if (typeof input.uploadsOpen === "boolean") patch.uploads_open = input.uploadsOpen;
  if (!Object.keys(patch).length) return fail(400, "Nothing to save.");
  const { data, error } = await supabaseAdmin.from("task_briefs").update({ ...patch, ...stampOf(actor) }).eq("id", brief.id as string).select("*").single();
  return error ? fail(400, error.message) : { ok: true, brief: data as Row };
}

/** Every stored object in the folder, including uploads never confirmed. */
export async function deleteBriefStorage(briefId: string): Promise<void> {
  const storage = supabaseAdmin.storage.from(TASK_FILES_BUCKET);
  const folder = briefFolder(briefId);
  const { data } = await storage.list(folder.slice(0, -1), { limit: 1000 });
  const paths = (data ?? []).filter((o) => o.name).map((o) => `${folder}${o.name}`);
  if (paths.length) await storage.remove(paths);
}

/** Deletes the instructions for good: the link stops, the files go. Nothing on
 *  the client's side ever pointed at them. */
export async function deleteBrief(taskId: string): Promise<void> {
  const brief = await liveBrief(taskId);
  if (!brief) return;
  await deleteBriefStorage(brief.id as string);
  await supabaseAdmin.from("task_briefs").delete().eq("id", brief.id as string);
}

export type BriefLinkState = { live: boolean; url: string | null; expiresAt: string | null };

/** Whether the link works right now, its URL when it can be shown, and when it stops. */
export async function briefLinkState(briefId: string, origin: string): Promise<BriefLinkState> {
  const { data } = await supabaseAdmin.from("task_brief_links")
    .select("token_hash, token_enc, revoked_at, expires_at").eq("brief_id", briefId).maybeSingle();
  const expiresAt = (data?.expires_at as string | null) ?? null;
  const live = !!data?.token_hash && !data.revoked_at && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
  const raw = live ? decryptToken(data?.token_enc as string | null) : null;
  return { live, url: raw ? briefUrl(origin, raw) : null, expiresAt: live ? expiresAt : null };
}

const expiryFrom = (days: unknown) => new Date(Date.now() + cleanLinkDays(days) * 86_400_000).toISOString();

/** A brand new link, replacing any old one, working for the days picked. */
export async function mintBriefLink(briefId: string, taskId: string, actor: Pick<ReviewActor, "memberId">, origin: string, days: unknown): Promise<BriefLinkState> {
  const { raw, hash, enc } = mintToken("brf_");
  const expiresAt = expiryFrom(days);
  const { error } = await supabaseAdmin.from("task_brief_links").upsert({
    brief_id: briefId, token_hash: hash, token_enc: enc, bound_task_id: taskId,
    created_by: actor.memberId, created_at: new Date().toISOString(), revoked_at: null, expires_at: expiresAt,
  }, { onConflict: "brief_id" });
  if (error) throw new Error(error.message);
  return { live: true, url: briefUrl(origin, raw), expiresAt };
}

/** The same link, working for the days picked from now. */
export async function extendBriefLink(briefId: string, days: unknown): Promise<boolean> {
  const { data } = await supabaseAdmin.from("task_brief_links").update({ expires_at: expiryFrom(days) })
    .eq("brief_id", briefId).not("token_hash", "is", null).is("revoked_at", null).select("brief_id");
  return !!data?.length;
}

/** Switch the link off for good. The token is deleted, so it never works again. */
export async function revokeBriefLink(briefId: string): Promise<void> {
  await supabaseAdmin.from("task_brief_links")
    .update({ token_hash: null, token_enc: null, revoked_at: new Date().toISOString() }).eq("brief_id", briefId);
}

// ---------------------------------------------------------------------------
// The outside side

export type BriefScope = {
  briefId: string;
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  assigneeId: string | null;
  clientId: string;
  clientName: string;
  assignedTo: string[];
  title: string;
  body: string;
  dueOn: string | null;
  showBusiness: boolean;
  uploadsOpen: boolean;
  /** When this link was made. The page lists only files sent back since, so a
   *  second person on a new link never sees the first one's work. */
  linkCreatedAt: string;
};

/** What a link opens, or null for ANY reason it should not: a bad format, a link
 *  switched off or expired, a task in the trash, private or on the Personal
 *  client, a client in the trash, or instructions no longer on that task. */
export async function resolveBriefToken(token: string): Promise<BriefScope | null> {
  if (!BRIEF_TOKEN_PATTERN.test(token)) return null;
  const { data: link } = await supabaseAdmin.from("task_brief_links")
    .select("brief_id, bound_task_id, revoked_at, expires_at, created_at").eq("token_hash", hashToken(token)).maybeSingle();
  if (!link || link.revoked_at) return null;
  if (!link.expires_at || new Date(link.expires_at as string).getTime() <= Date.now()) return null;

  const [{ data: brief }, { data: task }] = await Promise.all([
    supabaseAdmin.from("task_briefs").select("*").eq("id", link.brief_id as string).maybeSingle(),
    supabaseAdmin.from("tasks").select("id, title, assignee_id, project_id, client_id, is_private, deleted_at").eq("id", link.bound_task_id as string).maybeSingle(),
  ]);
  if (!brief || !task || brief.task_id !== task.id) return null;
  if (task.is_private || task.deleted_at || task.client_id === PERSONAL_CLIENT_ID) return null;
  const { data: client } = await supabaseAdmin.from("clients").select("id, name, assigned_to, deleted_at").eq("id", task.client_id as string).maybeSingle();
  if (!client || client.deleted_at) return null;

  return {
    briefId: brief.id as string,
    taskId: task.id as string,
    taskTitle: task.title as string,
    projectId: (task.project_id as string | null) ?? null,
    assigneeId: (task.assignee_id as string | null) ?? null,
    clientId: client.id as string,
    clientName: client.name as string,
    assignedTo: (client.assigned_to as string[] | null) ?? [],
    title: ((brief.title as string | null) ?? "").trim(),
    body: sanitizeDocHtml((brief.body as string | null) ?? ""),
    dueOn: (brief.due_on as string | null) ?? null,
    showBusiness: brief.show_business !== false,
    uploadsOpen: brief.uploads_open !== false,
    linkCreatedAt: link.created_at as string,
  };
}

/** What the outside page shows as its name: the typed one, else a plain label.
 *  Never the task's title, which is the team's own wording about the client. */
export const outsideTitle = (scope: Pick<BriefScope, "title">) => scope.title || BRIEF_TITLE;

// ---------------------------------------------------------------------------
// Files

export type BriefFile = { id: string; name: string; size: number; kind: SharedFileKind; addedBy: string; createdAt: string };

/** The files the outside page lists: the team's, or the ones sent back. No paths leave here. */
export async function briefFiles(briefId: string, fromOutside: boolean, since?: string): Promise<BriefFile[]> {
  let q = supabaseAdmin.from("task_brief_files")
    .select("id, name, size_bytes, kind, added_by_label, created_at")
    .eq("brief_id", briefId).eq("from_outside", fromOutside).is("removed_at", null);
  if (since) q = q.gte("created_at", since);
  const { data } = await q.order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string, name: r.name as string, size: Number(r.size_bytes ?? 0), kind: r.kind as SharedFileKind,
    addedBy: (r.added_by_label as string | null) ?? "", createdAt: r.created_at as string,
  }));
}

function isBriefPath(briefId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const folder = briefFolder(briefId);
  return path.startsWith(folder) && UPLOAD_OBJECT_NAME.test(path.slice(folder.length));
}

/** A one time upload link for a new file in the folder. The team adds files the
 *  shareable way; the outside person may also send design files, and bigger. */
export async function startBriefUpload(briefId: string, rawName: unknown, rawSize: unknown, outside: boolean): Promise<{ ok: true; path: string; uploadUrl: string } | Fail> {
  const name = typeof rawName === "string" ? cleanFileName(rawName) : "";
  if (!name || !(outside ? isDesignFileName(name) : isShareableFileName(name))) {
    return fail(400, outside ? "Send a PDF, an image, a ZIP or a design file." : "Add a photo, PDF, document, spreadsheet, slides or a video.");
  }
  const cap = maxUploadBytes(outside ? "design" : "file");
  if (typeof rawSize !== "number" || !Number.isFinite(rawSize) || rawSize <= 0) return fail(400, "Invalid file.");
  if (rawSize > cap) return fail(413, outside ? "Each file must be under 200 MB." : "Each file must be under 25 MB.");
  const { count } = await supabaseAdmin.from("task_brief_files").select("id", { count: "exact", head: true }).eq("brief_id", briefId).is("removed_at", null);
  if ((count ?? 0) >= MAX_BRIEF_FILES) return fail(400, "This has all the files it can hold.");
  const path = `${briefFolder(briefId)}${randomUUID()}-${storageSafeName(name)}`;
  const { data, error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail(500, "Could not start the upload. Please try again.");
  return { ok: true, path, uploadUrl: data.signedUrl };
}

/** Record a file that finished uploading: in this folder, really there, under the
 *  cap and not a type a browser would run. Anything else is deleted. */
export async function finishBriefUpload(
  briefId: string, rawPath: unknown, rawName: unknown, actor: { id: string | null; label: string }, outside: boolean,
): Promise<{ ok: true; fileId: string; name: string } | Fail> {
  const name = typeof rawName === "string" ? cleanFileName(rawName) : "";
  const allowed = outside ? isDesignFileName(name) : isShareableFileName(name);
  if (!name || !allowed || !isBriefPath(briefId, rawPath) || extOf(rawPath) !== extOf(name)) return fail(400, "Invalid file.");
  const { data: known } = await supabaseAdmin.from("task_brief_files").select("id").eq("path", rawPath).limit(1).maybeSingle();
  if (known) return fail(409, "That file is already here.");
  const stored = await checkStoredFile(rawPath, outside ? "design" : "file");
  if (!stored.ok) return stored;
  const fileId = "tbf_" + randomUUID();
  const { error } = await supabaseAdmin.from("task_brief_files").insert({
    id: fileId, brief_id: briefId, path: rawPath, name, size_bytes: stored.size, kind: sharedFileKind(name),
    from_outside: outside, added_by: actor.id, added_by_label: actor.label, created_at: new Date().toISOString(),
  });
  if (error) return fail(409, "That file is already here.");
  return { ok: true, fileId, name };
}

/** The team takes a file off. The row stays, marked removed, and storage lets it go. */
export async function removeBriefFile(briefId: string, fileId: unknown): Promise<{ ok: true; name: string } | Fail> {
  if (typeof fileId !== "string") return fail(400, "Invalid request.");
  const { data: f } = await supabaseAdmin.from("task_brief_files")
    .select("id, path, name, removed_at").eq("id", fileId).eq("brief_id", briefId).maybeSingle();
  if (!f || f.removed_at) return fail(404, "That file is already gone.");
  await supabaseAdmin.from("task_brief_files").update({ removed_at: new Date().toISOString() }).eq("id", f.id as string);
  await supabaseAdmin.storage.from(TASK_FILES_BUCKET).remove([f.path as string]);
  return { ok: true, name: f.name as string };
}

/** A five minute link to one of the TEAM's files, for the outside page. Files sent
 *  back are never handed out through the link, so two people sharing it never
 *  see each other's work. */
export async function outsideFileUrl(briefId: string, fileId: string, download: boolean): Promise<string | null> {
  const { data: f } = await supabaseAdmin.from("task_brief_files")
    .select("path, name").eq("id", fileId).eq("brief_id", briefId).eq("from_outside", false).is("removed_at", null).maybeSingle();
  if (!f) return null;
  const { data } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET)
    .createSignedUrl(f.path as string, 300, download ? { download: f.name as string } : undefined);
  return data?.signedUrl ?? null;
}

/** A file came back: a line on the task, and the owner rung by bell and email at
 *  most every 15 minutes, so a batch of ten is one ring. */
export async function noteOutsideFile(scope: BriefScope, who: string, fileName: string): Promise<void> {
  await appendTaskEvent(scope.taskId, `${who} sent ${fileName} on the project instructions`, "outside");
  // Touching the task is what refreshes an open drawer live (logClientDocEvent does the same).
  await supabaseAdmin.from("tasks").update({ updated_by: null }).eq("id", scope.taskId);
  const since = new Date(Date.now() - OUTSIDE_NOTIFY_COOLDOWN_MS).toISOString();
  const { data: claimed } = await supabaseAdmin.from("task_briefs").update({ last_outside_notified_at: new Date().toISOString() })
    .eq("id", scope.briefId).or(`last_outside_notified_at.is.null,last_outside_notified_at.lt."${since}"`).select("id");
  if (!claimed?.length) return;
  const recipient = scope.assigneeId ?? await resolveNotifyRecipient(scope.assignedTo);
  if (!recipient) return;
  await notifyTeamOfClientActivity({
    notifyRecipient: recipient, clientId: scope.clientId, taskId: scope.taskId, projectId: scope.projectId,
    clientName: scope.clientName, taskTitle: scope.taskTitle,
    notifText: `${who} sent files on the project instructions for "${scope.taskTitle}"`,
    subject: `${who} sent files for "${scope.taskTitle}"`,
  });
}

export const outsideName = (raw: unknown) => cleanOutsideName(raw) || "Someone outside";

// ---------------------------------------------------------------------------
// Into the image review

/** Put images sent back into the task's image review as its working copy, the
 *  version to send next, made if there is none. The client sees nothing until
 *  the team presses Send. Two images read as Front and Back (a file named
 *  "front" first). Only JPG, PNG, WebP and GIF: an image review draws images. */
export async function moveToImageReview(task: TeamTask, briefId: string, rawIds: unknown, actor: ReviewActor): Promise<ReviewOutcome<{ document: Row; moved: number }>> {
  const ids = Array.isArray(rawIds) ? rawIds.filter((x): x is string => typeof x === "string").slice(0, MAX_SET_IMAGES) : [];
  if (!ids.length) return fail(400, "Pick the images to put in the review.");
  const { data: rows } = await supabaseAdmin.from("task_brief_files")
    .select("id, path, name, size_bytes").eq("brief_id", briefId).in("id", ids).is("removed_at", null);
  const images = frontFirst((rows ?? []).map((r) => ({ id: r.id as string, path: r.path as string, name: r.name as string, size: Number(r.size_bytes ?? 0) }))
    .filter((f) => isPreviewableImage(f.name)));
  if (!images.length) return fail(400, "An image review takes JPG, PNG, WebP or GIF images. Download the other files instead.");

  const review = await createReview(task, "image", actor);
  if (!review.ok) return review;
  if (review.document.approved_at) return fail(409, "The image review is approved. Reopen it first.");
  const reviewId = review.document.id as string;
  const who = { id: actor.id, label: await actor.label() };
  const items: ImageSetItem[] = [];
  for (const f of images) {
    const adopted = await adoptImageFile(reviewId, f.path, f.name, f.size, who);
    if (!adopted.ok) return adopted;
    items.push({ file: adopted.fileId, label: "" });
  }
  // A new version replaces the working copy whole, like uploading a new set.
  const picked = await pickReviewVersion(task.id, "image", actor, { images: items });
  if (!picked.ok) return picked;
  await supabaseAdmin.from("task_brief_files").update({ moved_at: new Date().toISOString() }).in("id", images.map((f) => f.id));
  if (actor.memberId) {
    await appendTaskEvent(task.id, `put ${images.length === 1 ? images[0].name : `${images.length} images`} from the project instructions in the image review`, actor.memberId);
  }
  return { ok: true, document: picked.document, moved: images.length };
}

/** For a route: the teammate, the task and its instructions, or the reason not. */
export async function teamBrief(req: NextRequest, taskId: string): Promise<
  { ok: true; user: AuthedUser; task: TeamTask; brief: Row } | { ok: false; res: NextResponse }
> {
  const access = await teamBriefAccess(req, taskId);
  if (!access.ok) return access;
  const brief = await liveBrief(taskId);
  if (!brief) return { ok: false, res: json({ error: "There are no project instructions on this task yet." }, 404) };
  return { ...access, brief };
}

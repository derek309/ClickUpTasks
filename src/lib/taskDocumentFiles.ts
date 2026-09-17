// SERVER ONLY. Files on a client review document, and the team's saved drafts
// between sends. See supabase/task-document-files.sql.
//
// Files live in the private task-files bucket under doc/<documentId>/, and that
// folder is the boundary: a path from outside it is never recorded or signed.
// Everyone uploads straight to storage through a one time upload link (a Vercel
// request body stops near 4.5MB and files may be 25MB), then asks for the file to
// be recorded, which is when its real size and type are checked.
//
// Image and web page reviews keep their versions here too, as "version files"
// (purpose image or page, supabase/task-image-reviews.sql and
// task-page-reviews.sql). They are not in the Files list. The client opens an
// image only once it was published, and a page file never opens as a link at
// all: it is stored as plain text and only ever shown through the sandboxed frame.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { TASK_FILES_BUCKET } from "./db";
import { cleanPin, publishedFiles, type ReviewPin } from "./reviewPins";
import type { FileKind } from "./reviewKinds";
import { imageLabel, parseImageSet, pinImageLabel, setFiles, type SetKind } from "./imageSet";
import type { ImageType } from "./safeFetch";
import {
  MAX_SHARED_FILE_BYTES, cleanFileName, extOf, isActiveContentType, isPreviewableImage, isReviewVideo,
  isShareableFileName, maxUploadBytes, sharedFileKind, storageSafeName, type SharedFileKind,
} from "./uploadTypes";

/** Which default names a version file's set uses, from its stored purpose. An
 *  unknown purpose falls back to an image review's names, as every set did before
 *  there was more than one kind. */
const setKindOf = (purpose: unknown): SetKind =>
  (purpose === "page" || purpose === "video" ? purpose : "image");

export const MAX_DOC_FILES = 50;
/** Versions a web page review can hold; each paste or edit is one. */
export const MAX_PAGE_FILES = 100;
/** Images an image review can hold across its versions (a version can hold 10). */
export const MAX_IMAGE_FILES = 100;
/** Videos a video review can hold across its versions. Far lower than the others:
 *  each one is up to 500MB, so this is the storage ceiling for one review. */
export const MAX_VIDEO_FILES = 20;

/** Whether the document has room for one more file of this purpose: Files and an
 *  image review's images each have their own cap, so a postcard's versions never
 *  crowd out the files. */
async function roomFor(documentId: string, purpose: UploadPurpose): Promise<Fail | null> {
  const { count } = await supabaseAdmin.from("task_document_files")
    .select("id", { count: "exact", head: true }).eq("document_id", documentId).eq("purpose", purpose).is("removed_at", null);
  if (purpose === "image") return (count ?? 0) >= MAX_IMAGE_FILES ? fail(400, `An image review can hold ${MAX_IMAGE_FILES} images. Remove an old version to add more.`) : null;
  if (purpose === "video") return (count ?? 0) >= MAX_VIDEO_FILES ? fail(400, `A video review can hold ${MAX_VIDEO_FILES} videos. Remove an old version to add more.`) : null;
  return (count ?? 0) >= MAX_DOC_FILES ? fail(400, `A document can hold ${MAX_DOC_FILES} files. Remove one to add another.`) : null;
}
/** While someone keeps typing, their draft is kept in the history this often. */
export const CHECKPOINT_EVERY_MS = 10 * 60_000;

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Who added or removed a file, or saved a draft. A null id is the client. */
export type DocActor = { id: string | null; label: string };
/** "file": everything in the Files list. image and page: a review's version files. */
export type FilePurpose = "file" | FileKind;
/** What the upload link may add: a file, an image review's image, or a video
 *  review's video. A page never comes through it (storePageFile below). */
export type UploadPurpose = "file" | "image" | "video";
const IMAGE_ONLY = "Upload a JPG, PNG, WebP or GIF image.";
const VIDEO_ONLY = "Upload an MP4, MOV, WebM or M4V video.";
/** Whether this purpose's file must be a playable video, an image, or anything shareable. */
const wrongType = (purpose: UploadPurpose, name: string): string | null =>
  (purpose === "image" && !isPreviewableImage(name) ? IMAGE_ONLY
    : purpose === "video" && !isReviewVideo(name) ? VIDEO_ONLY
      : null);

export const docFileFolder = (documentId: string) => `doc/${documentId}/`;

/** How an upload is named inside its folder: a random id, then the safe file name. */
export const UPLOAD_OBJECT_NAME = /^[0-9a-f-]{36}-[\w.-]+$/;

/** A path this document may use: a file directly inside its own folder, named
 *  the way startDocUpload names it. */
export function isDocFilePath(documentId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const folder = docFileFolder(documentId);
  return path.startsWith(folder) && UPLOAD_OBJECT_NAME.test(path.slice(folder.length));
}

/** What actually landed in storage at `path` after a direct upload: it must exist,
 *  be under the cap and not carry a type a browser would run. Anything else is
 *  deleted. Shared by the document's files and the client portal's uploads. */
export async function checkStoredFile(path: string, purpose: UploadPurpose = "file"): Promise<{ ok: true; size: number } | Fail> {
  const storage = supabaseAdmin.storage.from(TASK_FILES_BUCKET);
  const { data: info, error } = await storage.info(path);
  if (error || !info) return fail(400, "The upload didn't finish. Please try again.");
  const meta = ((info as { metadata?: { size?: number; mimetype?: string } }).metadata) ?? {};
  const size = Number(info.size ?? meta.size ?? 0);
  const type = String(info.contentType ?? meta.mimetype ?? "");
  if (!size || size > maxUploadBytes(purpose) || isActiveContentType(type)) {
    await storage.remove([path]);
    return fail(400, "That file can't be added.");
  }
  return { ok: true, size };
}

export function checkFileName(raw: unknown): { ok: true; name: string } | Fail {
  if (typeof raw !== "string" || !raw.trim()) return fail(400, "Missing file name.");
  const name = cleanFileName(raw);
  if (!isShareableFileName(name)) {
    return fail(400, "That file type can't be added. Add a photo, PDF, document, spreadsheet, slides or a video.");
  }
  return { ok: true, name };
}

export function checkFileSize(raw: unknown, purpose: UploadPurpose = "file"): Fail | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return fail(400, "Invalid file.");
  if (raw > maxUploadBytes(purpose)) {
    return fail(413, purpose === "video" ? "Each video must be under 500 MB." : "Each file must be under 25 MB.");
  }
  return null;
}

/** A one time upload link for a new file in the document's folder. */
export async function startDocUpload(documentId: string, rawName: unknown, rawSize: unknown, purpose: UploadPurpose = "file"): Promise<{ ok: true; path: string; uploadUrl: string } | Fail> {
  const named = checkFileName(rawName);
  if (!named.ok) return named;
  const wrong = wrongType(purpose, named.name);
  if (wrong) return fail(400, wrong);
  const sized = checkFileSize(rawSize, purpose);
  if (sized) return sized;
  const full = await roomFor(documentId, purpose);
  if (full) return full;

  const path = `${docFileFolder(documentId)}${randomUUID()}-${storageSafeName(named.name)}`;
  const { data, error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail(500, "Could not start the upload. Please try again.");
  return { ok: true, path, uploadUrl: data.signedUrl };
}

/** Record a file that finished uploading. The object must be in this document's
 *  folder, exist, be under the cap, not carry a type a browser would run, and not
 *  be an object the document already has on record (a page version, say);
 *  otherwise nothing is recorded. The client sees it at once, whoever added it
 *  (Derek, 2026-09-11: the client link "is not showing the files that have already
 *  been attached"), except an image review's image, which waits until it is sent. */
export async function finishDocUpload(documentId: string, rawPath: unknown, rawName: unknown, actor: DocActor, purpose: UploadPurpose = "file"): Promise<{ ok: true; fileId: string; name: string } | Fail> {
  const named = checkFileName(rawName);
  if (!named.ok) return named;
  if (!isDocFilePath(documentId, rawPath) || extOf(rawPath) !== extOf(named.name)) return fail(400, "Invalid file.");
  const { data: known } = await supabaseAdmin.from("task_document_files").select("id").eq("path", rawPath).limit(1).maybeSingle();
  if (known) return fail(409, "That file is already on the document.");
  const wrong = wrongType(purpose, named.name);
  if (wrong) {
    await supabaseAdmin.storage.from(TASK_FILES_BUCKET).remove([rawPath]);
    return fail(400, wrong);
  }

  const stored = await checkStoredFile(rawPath, purpose);
  if (!stored.ok) return stored;
  const size = stored.size;

  const now = new Date().toISOString();
  const fileId = "tdf_" + randomUUID();
  const { error: insertError } = await supabaseAdmin.from("task_document_files").insert({
    id: fileId, document_id: documentId, path: rawPath, name: named.name, size_bytes: size,
    kind: sharedFileKind(named.name), purpose, added_by: actor.id, added_by_label: actor.label,
    created_at: now, shared_at: now,
  });
  if (insertError) return fail(409, "That file is already on the document.");
  return { ok: true, fileId, name: named.name };
}

/** Take a file off the document and delete it from storage. The row stays, so
 *  the history can still say who removed it. A client may only remove files a
 *  client added, and a version file only goes through removeVersionFile. */
export async function removeDocFile(documentId: string, fileId: unknown, actor: DocActor, clientFilesOnly: boolean): Promise<{ ok: true; name: string } | Fail> {
  if (typeof fileId !== "string") return fail(400, "Invalid request.");
  const { data: f } = await supabaseAdmin.from("task_document_files")
    .select("id, path, name, added_by, removed_at, purpose").eq("id", fileId).eq("document_id", documentId).maybeSingle();
  if (!f || f.removed_at) return fail(404, "That file is already gone.");
  if (f.purpose !== "file") return fail(400, "A version stays with its pins. Upload a new version instead.");
  if (clientFilesOnly && f.added_by !== null) return fail(403, "You can remove the files you added.");
  await supabaseAdmin.from("task_document_files")
    .update({ removed_at: new Date().toISOString(), removed_by: actor.id, removed_by_label: actor.label }).eq("id", f.id as string);
  await supabaseAdmin.storage.from(TASK_FILES_BUCKET).remove([f.path as string]);
  return { ok: true, name: f.name as string };
}

/** Every stored object in the document's folder, including uploads that were
 *  started and never confirmed. Used when the document itself is deleted. */
export async function deleteDocStorage(documentId: string): Promise<void> {
  const storage = supabaseAdmin.storage.from(TASK_FILES_BUCKET);
  const folder = docFileFolder(documentId);
  const { data } = await storage.list(folder.slice(0, -1), { limit: 1000 });
  const paths = (data ?? []).filter((o) => o.name).map((o) => `${folder}${o.name}`);
  if (paths.length) await storage.remove(paths);
}

export type SharedDocFile = { id: string; name: string; size: number; kind: SharedFileKind; addedBy: string; fromClient: boolean; createdAt: string };

/** The files the client can see: every file not removed. No paths leave here. */
export async function sharedDocFiles(documentId: string): Promise<SharedDocFile[]> {
  const { data } = await supabaseAdmin.from("task_document_files")
    .select("id, name, size_bytes, kind, added_by, added_by_label, created_at")
    .eq("document_id", documentId).eq("purpose", "file").is("removed_at", null)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string, name: r.name as string, size: Number(r.size_bytes ?? 0), kind: r.kind as SharedFileKind,
    addedBy: (r.added_by_label as string | null) ?? "", fromClient: r.added_by === null, createdAt: r.created_at as string,
  }));
}

/** The bodies the client has been shown, newest first. */
async function publishedBodies(documentId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("task_document_versions")
    .select("version, body").eq("document_id", documentId).order("version", { ascending: false });
  return (data ?? []).map((v) => v.body as string);
}

/** Whether this file was ever published to the client, by the team or by them, on
 *  its own or as one of a version's images (imageSet.ts). */
async function wasPublished(documentId: string, fileId: string): Promise<boolean> {
  return (await publishedBodies(documentId)).some((body) => setFiles(body).includes(fileId));
}

/** What tells a pin's image or page apart ("Back", "Page 2"), when its version
 *  holds more than one. The file's own purpose says which default names apply. */
export async function pinImageName(documentId: string, fileId: string): Promise<string | null> {
  const [bodies, { data: f }] = await Promise.all([
    publishedBodies(documentId),
    supabaseAdmin.from("task_document_files").select("purpose").eq("id", fileId).eq("document_id", documentId).maybeSingle(),
  ]);
  return pinImageLabel(bodies, fileId, setKindOf(f?.purpose));
}

/** How long a link to a stored file lasts: long enough to open it, short enough
 *  that a copied link is no use later. Every page asks again rather than holding one. */
const FILE_URL_TTL = 300;
/** A video's link lasts far longer, because it is not opened once: the player
 *  holds it for the whole watch and seeking asks storage for byte ranges against
 *  it, so it has to outlast the video itself. */
const VIDEO_URL_TTL = 6 * 3600;

/** A short lived link to one shared file, saved rather than shown when asked.
 *  An image review's image and a video review's video open only once published; a
 *  page never opens this way, only in the sandboxed frame. */
export async function sharedDocFileUrl(documentId: string, fileId: string, download: boolean): Promise<string | null> {
  const { data: f } = await supabaseAdmin.from("task_document_files")
    .select("path, name, purpose").eq("id", fileId).eq("document_id", documentId)
    .is("removed_at", null).maybeSingle();
  if (!f || f.purpose === "page") return null;
  const version = f.purpose === "image" || f.purpose === "video";
  if (version && !(await wasPublished(documentId, fileId))) return null;
  const ttl = f.purpose === "video" ? VIDEO_URL_TTL : FILE_URL_TTL;
  const { data } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET)
    .createSignedUrl(f.path as string, ttl, download ? { download: f.name as string } : undefined);
  return data?.signedUrl ?? null;
}

/** A link the client's player streams a video review's video from, or null when
 *  the file is not a live video version (or, with publishedOnly, was never sent).
 *  Storage serves the byte ranges seeking asks for, so this link goes to the
 *  player and the app is not in the way of the watching. */
export async function docVideoUrl(documentId: string, fileId: unknown, publishedOnly: boolean): Promise<string | null> {
  const file = await docVersionFile(documentId, fileId, "video", publishedOnly);
  if (!file) return null;
  const { data } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUrl(file.path, VIDEO_URL_TTL);
  return data?.signedUrl ?? null;
}

export type VersionFile = { id: string; name: string; path: string; purpose: FileKind };

/** One of a review's version files (an image review's image, a web page review's
 *  page, a video review's video) that is still on the review, or null. purpose null takes either kind.
 *  publishedOnly is the client's side, which may only use files it was shown. */
export async function docVersionFile(documentId: string, fileId: unknown, purpose: FileKind | null, publishedOnly: boolean): Promise<VersionFile | null> {
  if (typeof fileId !== "string") return null;
  const query = supabaseAdmin.from("task_document_files")
    .select("id, name, path, purpose").eq("id", fileId).eq("document_id", documentId).is("removed_at", null);
  const { data: f } = await (purpose ? query.eq("purpose", purpose) : query.in("purpose", ["image", "page", "video"])).maybeSingle();
  if (!f || (publishedOnly && !(await wasPublished(documentId, fileId)))) return null;
  return { id: f.id as string, name: f.name as string, path: f.path as string, purpose: f.purpose as FileKind };
}

/** A version the client was shown and can still see. number is its version, counted
 *  over every body ever published, so a removed version leaves a gap and nothing
 *  renumbers. body names it; images are the files it holds, in order, labelled (the
 *  images of an image review, the pages of an HTML review), and fileId and name are
 *  its first file's. fromClient: the client made it (a page they reworded). */
export type SharedVersionFile = {
  body: string; fileId: string; name: string; number: number; fromClient: boolean;
  images: { fileId: string; name: string; label: string }[];
};

/** The versions the client can see, oldest first. The last one is under review. A
 *  version with any image taken off is gone from the list. */
export async function sharedVersionFiles(documentId: string): Promise<SharedVersionFile[]> {
  const { data: versions } = await supabaseAdmin.from("task_document_versions")
    .select("version, body").eq("document_id", documentId);
  const bodies = publishedFiles((versions ?? []) as { version: number; body: string }[]);
  const ids = [...new Set(bodies.flatMap(setFiles))];
  if (!ids.length) return [];
  const { data: files } = await supabaseAdmin.from("task_document_files").select("id, name, removed_at, added_by, purpose").in("id", ids);
  const live = new Map((files ?? []).filter((f) => !f.removed_at).map((f) => [f.id as string, f]));
  return bodies.flatMap((body, i) => {
    const items = parseImageSet(body);
    if (!items.length || items.some((item) => !live.has(item.file))) return [];
    // A version holds one kind of file, so its first says which default names apply.
    const kind = setKindOf(live.get(items[0].file)!.purpose);
    const images = items.map((item, n) => ({ fileId: item.file, name: live.get(item.file)!.name as string, label: imageLabel(items, n, kind) }));
    return [{
      body, fileId: images[0].fileId, name: images[0].name, number: i + 1, images,
      fromClient: items.some((item) => live.get(item.file)!.added_by === null),
    }];
  });
}

/** Take a wrong version off an image or web page review (Derek, 2026-09-12: "a way
 *  to delete the image in case it was the wrong one"). Its pins go with it; the
 *  file row stays, marked removed, so the history still says who removed it. The
 *  caller moves the review off it when it was the version under review. */
export async function removeVersionFile(documentId: string, fileId: unknown, purpose: FileKind, actor: DocActor): Promise<{ ok: true; id: string; name: string } | Fail> {
  const file = await docVersionFile(documentId, fileId, purpose, false);
  if (!file) return fail(404, "That version is already gone.");
  const { error } = await supabaseAdmin.from("task_document_comments").delete().eq("document_id", documentId).eq("pin_file_id", file.id);
  if (error) return fail(500, "Could not remove that version. Please try again.");
  await supabaseAdmin.from("task_document_files")
    .update({ removed_at: new Date().toISOString(), removed_by: actor.id, removed_by_label: actor.label }).eq("id", file.id);
  await supabaseAdmin.storage.from(TASK_FILES_BUCKET).remove([file.path]);
  return { ok: true, id: file.id, name: file.name };
}

/** The name a page version is listed under: the uploaded file's, else "Pasted code.html". */
function pageFileName(raw: unknown): string {
  const name = typeof raw === "string" ? cleanFileName(raw).trim() : "";
  const base = name || "Pasted code";
  return /\.html?$/i.test(base) ? base : `${base}.html`;
}

/** Keep a web page review's HTML as a new version file. Stored as plain text, so
 *  the object never renders as a page if its storage link is ever opened. The
 *  caller checks the size (pageHtml.ts) first. */
export async function storePageFile(documentId: string, html: string, rawName: unknown, actor: DocActor): Promise<{ ok: true; fileId: string } | Fail> {
  const { count } = await supabaseAdmin.from("task_document_files")
    .select("id", { count: "exact", head: true }).eq("document_id", documentId).eq("purpose", "page");
  if ((count ?? 0) >= MAX_PAGE_FILES) return fail(400, `An HTML review can hold ${MAX_PAGE_FILES} versions. Start a new review to add more.`);

  const path = `${docFileFolder(documentId)}${randomUUID()}-page.txt`;
  const bytes = Buffer.from(html, "utf8");
  const storage = supabaseAdmin.storage.from(TASK_FILES_BUCKET);
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: "text/plain; charset=utf-8", upsert: false });
  if (uploadError) return fail(500, "Could not save the page. Please try again.");

  const now = new Date().toISOString();
  const fileId = "tdf_" + randomUUID();
  const { error } = await supabaseAdmin.from("task_document_files").insert({
    id: fileId, document_id: documentId, path, name: pageFileName(rawName), size_bytes: bytes.length,
    kind: "doc", purpose: "page", added_by: actor.id, added_by_label: actor.label, created_at: now, shared_at: now,
  });
  if (error) {
    await storage.remove([path]);
    return fail(500, "Could not save the page. Please try again.");
  }
  return { ok: true, fileId };
}

/** Keep an image fetched on the server (Claude adding an image review version from a
 *  link) as a new version file, with a browser upload's rules: a real image type,
 *  already read from its first bytes (safeFetch.ts), under the cap, and the
 *  document's file limit. The caller makes it the working copy. */
export async function storeImageFile(
  documentId: string, bytes: Buffer, rawName: unknown, image: { contentType: ImageType; extension: string }, actor: DocActor,
): Promise<{ ok: true; fileId: string; name: string } | Fail> {
  if (!bytes.length || bytes.length > MAX_SHARED_FILE_BYTES) return fail(413, "Each file must be under 25 MB.");
  const full = await roomFor(documentId, "image");
  if (full) return full;

  const base = typeof rawName === "string" ? cleanFileName(rawName).replace(/\.[^.]*$/, "").trim() : "";
  const name = `${base || "Image"}.${image.extension}`;
  const path = `${docFileFolder(documentId)}${randomUUID()}-${storageSafeName(name)}`;
  const storage = supabaseAdmin.storage.from(TASK_FILES_BUCKET);
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: image.contentType, upsert: false });
  if (uploadError) return fail(500, "Could not save the image. Please try again.");

  const now = new Date().toISOString();
  const fileId = "tdf_" + randomUUID();
  const { error } = await supabaseAdmin.from("task_document_files").insert({
    id: fileId, document_id: documentId, path, name, size_bytes: bytes.length,
    kind: sharedFileKind(name), purpose: "image", added_by: actor.id, added_by_label: actor.label, created_at: now, shared_at: now,
  });
  if (error) {
    await storage.remove([path]);
    return fail(500, "Could not save the image. Please try again.");
  }
  return { ok: true, fileId, name };
}

/** A web page review's HTML, or null when the file is not a live page version (or,
 *  with publishedOnly, was never published). */
export async function readPageFile(documentId: string, fileId: unknown, publishedOnly: boolean): Promise<string | null> {
  const file = await docVersionFile(documentId, fileId, "page", publishedOnly);
  if (!file) return null;
  const { data } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).download(file.path);
  return data ? await data.text() : null;
}

/** Undo a version file made for a publish that did not go through. */
export async function discardVersionFile(documentId: string, fileId: string): Promise<void> {
  const { data: f } = await supabaseAdmin.from("task_document_files").select("path").eq("id", fileId).eq("document_id", documentId).maybeSingle();
  if (!f) return;
  await supabaseAdmin.from("task_document_files").delete().eq("id", fileId);
  await supabaseAdmin.storage.from(TASK_FILES_BUCKET).remove([f.path as string]);
}

// ---------------------------------------------------------------------------
// Comments: one thread the team and the client both see.

export const MAX_COMMENT_CHARS = 4000;
/** A numbered pin on one of a review's version files. */
export type DocPin = ReviewPin & { number: number };
export type DocComment = {
  id: string; body: string; authorLabel: string; fromClient: boolean; createdAt: string;
  editedAt: string | null; completedAt: string | null; completedBy: string | null;
  /** The words in the document this comment is about, or null for the whole document. */
  quote: string | null;
  /** The spot on an image or page this comment is about. */
  pin: DocPin | null;
  /** A file added with the comment; it is in the Files list too. */
  attachmentFileId: string | null;
};
const COMMENT_COLUMNS = "id, body, author_id, author_label, created_at, edited_at, completed_at, completed_by_label, quote, pin_file_id, pin_x, pin_y, pin_number, pin_node, pin_node_x, pin_node_y, pin_width, attachment_file_id";

const MAX_QUOTE_CHARS = 500;
/** The words a comment is about, as selected in the document: plain text, one
 *  space between words, line breaks kept between paragraphs. Null for none. */
export function cleanQuote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const quote = raw.replace(/\r\n?/g, "\n").split("\n")
    // Whitespace (tabs included) becomes one space first, then any other control characters go.
    .map((line) => line.replace(/\s+/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim())
    .filter(Boolean).join("\n");
  return quote ? quote.slice(0, MAX_QUOTE_CHARS) : null;
}

/** Plain text only: line breaks stay, other control characters go, and long
 *  runs of blank lines fold to one. Null when empty or too long. */
export function cleanCommentBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return body && body.length <= MAX_COMMENT_CHARS ? body : null;
}

const toComment = (r: Record<string, unknown>): DocComment => ({
  id: r.id as string, body: r.body as string, authorLabel: (r.author_label as string | null) ?? "",
  fromClient: r.author_id === null, createdAt: r.created_at as string,
  editedAt: (r.edited_at as string | null) ?? null,
  completedAt: (r.completed_at as string | null) ?? null,
  completedBy: (r.completed_by_label as string | null) ?? null,
  quote: (r.quote as string | null) ?? null,
  pin: r.pin_file_id && r.pin_number
    ? {
      fileId: r.pin_file_id as string, x: Number(r.pin_x), y: Number(r.pin_y), number: Number(r.pin_number),
      anchor: r.pin_node != null
        ? { node: Number(r.pin_node), nx: Number(r.pin_node_x), ny: Number(r.pin_node_y), width: Number(r.pin_width) }
        : null,
    }
    : null,
  attachmentFileId: (r.attachment_file_id as string | null) ?? null,
});

/** A file on the document that a comment may carry. */
async function attachableFile(documentId: string, fileId: unknown): Promise<string | null> {
  if (typeof fileId !== "string") return null;
  const { data } = await supabaseAdmin.from("task_document_files")
    .select("id").eq("id", fileId).eq("document_id", documentId).eq("purpose", "file").is("removed_at", null).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** The next number on a version file: one past the highest pin still on it. */
async function nextPinNumber(documentId: string, fileId: string): Promise<number> {
  const { data } = await supabaseAdmin.from("task_document_comments")
    .select("pin_number").eq("document_id", documentId).eq("pin_file_id", fileId)
    .order("pin_number", { ascending: false }).limit(1).maybeSingle();
  return Number(data?.pin_number ?? 0) + 1;
}

export type CommentExtras = {
  /** The words selected in the document, when the comment is about them. */
  quote?: unknown;
  /** A spot on a version file: { fileId, x, y } and, on a page, an anchor. */
  pin?: unknown;
  /** A file already added to the document, carried by this comment. */
  attachmentFileId?: unknown;
  /** The client's side: a pin only on a version they were shown. */
  clientSide?: boolean;
};

/** A comment needs words, or a file when it carries one (Derek, 2026-09-12: "add a
 *  comment or upload a file"). A pin gets the next number on its version file; its
 *  anchor is kept only on a page, the one kind that has elements to anchor to. */
export async function postDocComment(documentId: string, rawBody: unknown, actor: DocActor, extras: CommentExtras = {}): Promise<{ ok: true; comment: DocComment } | Fail> {
  if (typeof rawBody === "string" && rawBody.trim().length > MAX_COMMENT_CHARS) return fail(413, "A comment can be up to 4,000 characters.");
  const body = cleanCommentBody(rawBody);
  const attachment = extras.attachmentFileId == null ? null : await attachableFile(documentId, extras.attachmentFileId);
  if (extras.attachmentFileId != null && !attachment) return fail(400, "That file is no longer on the document.");
  if (!body && !attachment) return fail(400, "Write a comment first.");

  let pin: ReviewPin | null = null;
  if (extras.pin != null) {
    pin = cleanPin(extras.pin);
    const file = pin ? await docVersionFile(documentId, pin.fileId, null, !!extras.clientSide) : null;
    if (!pin || !file) return fail(400, "That version is no longer on the review.");
    if (file.purpose !== "page") pin = { ...pin, anchor: null };
  }

  const base = {
    document_id: documentId, body: body ?? "", author_id: actor.id, author_label: actor.label,
    quote: pin ? null : cleanQuote(extras.quote), attachment_file_id: attachment,
    pin_file_id: pin?.fileId ?? null, pin_x: pin?.x ?? null, pin_y: pin?.y ?? null,
    pin_node: pin?.anchor?.node ?? null, pin_node_x: pin?.anchor?.nx ?? null, pin_node_y: pin?.anchor?.ny ?? null, pin_width: pin?.anchor?.width ?? null,
  };
  for (let attempt = 1; ; attempt++) {
    const row = { ...base, id: "tdm_" + randomUUID(), created_at: new Date().toISOString(), pin_number: pin ? await nextPinNumber(documentId, pin.fileId) : null };
    const { error } = await supabaseAdmin.from("task_document_comments").insert(row);
    if (!error) return { ok: true, comment: toComment(row) };
    // 23505: someone dropped a pin on this version at the same moment and took the
    // number (supabase/task-image-reviews.sql), so take the next one.
    if (!pin || error.code !== "23505" || attempt === 5) return fail(500, "Could not post the comment. Please try again.");
  }
}

/** The thread, oldest first. */
export async function docComments(documentId: string): Promise<DocComment[]> {
  const { data } = await supabaseAdmin.from("task_document_comments")
    .select(COMMENT_COLUMNS)
    .eq("document_id", documentId).order("created_at", { ascending: true }).limit(300);
  return (data ?? []).map(toComment);
}

async function findComment(documentId: string, commentId: unknown) {
  if (typeof commentId !== "string") return null;
  const { data } = await supabaseAdmin.from("task_document_comments")
    .select("id, author_id").eq("id", commentId).eq("document_id", documentId).maybeSingle();
  return data;
}

/** Edit a comment's text (its author only) and tick it done or open again
 *  (anyone in the thread), like a checklist item. */
export async function editDocComment(documentId: string, commentId: unknown, change: { body?: unknown; done?: unknown }, actor: DocActor): Promise<{ ok: true; comment: DocComment } | Fail> {
  const found = await findComment(documentId, commentId);
  if (!found) return fail(404, "That comment is gone.");
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (change.body !== undefined) {
    if (found.author_id !== actor.id) return fail(403, "You can edit the comments you wrote.");
    const body = cleanCommentBody(change.body);
    if (!body) return fail(400, "Write a comment first.");
    patch.body = body;
    patch.edited_at = now;
  }
  if (typeof change.done === "boolean") {
    patch.completed_at = change.done ? now : null;
    patch.completed_by_label = change.done ? actor.label : null;
  }
  if (!Object.keys(patch).length) return fail(400, "Invalid request.");
  const { data, error } = await supabaseAdmin.from("task_document_comments")
    .update(patch).eq("id", found.id as string).select(COMMENT_COLUMNS).single();
  if (error || !data) return fail(500, "Could not update the comment. Please try again.");
  return { ok: true, comment: toComment(data) };
}

/** Delete a comment: its author, or any teammate when anyTeammate is set. */
export async function deleteDocComment(documentId: string, commentId: unknown, actor: DocActor, anyTeammate: boolean): Promise<{ ok: true } | Fail> {
  const found = await findComment(documentId, commentId);
  if (!found) return fail(404, "That comment is gone.");
  if (!anyTeammate && found.author_id !== actor.id) return fail(403, "You can delete the comments you wrote.");
  const { error } = await supabaseAdmin.from("task_document_comments").delete().eq("id", found.id as string);
  return error ? fail(500, "Could not delete the comment. Please try again.") : { ok: true };
}

// ---------------------------------------------------------------------------
// Saved drafts

/** Whether a teammate's save goes in the history. Nothing empty or unchanged;
 *  otherwise a Save draft click, or ten minutes since the last entry. */
export function shouldCheckpoint(o: { body: string; latestBody: string | null; since: string; explicit: boolean }, now = Date.now()): boolean {
  if (!o.body.trim() || o.body === o.latestBody) return false;
  return o.explicit || now - new Date(o.since).getTime() >= CHECKPOINT_EVERY_MS;
}

async function memberName(memberId: string): Promise<string> {
  const { data } = await supabaseAdmin.from("profiles").select("name").eq("member_id", memberId).maybeSingle();
  return ((data?.name as string | null) ?? "").trim() || "A teammate";
}

/** After a teammate's save: keep it in the history when shouldCheckpoint says
 *  so. When a different teammate picks the draft up, first keep where the last
 *  one left it under THEIR name, so nobody's work is credited to the next person. */
export async function recordCheckpoint(
  before: { documentId: string; body: string; updatedBy: string | null; createdAt: string },
  author: { id: string; label: () => Promise<string> },
  body: string,
  explicit: boolean,
): Promise<void> {
  const { data: latest } = await supabaseAdmin.from("task_document_checkpoints")
    .select("body, created_at").eq("document_id", before.documentId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  let latestBody = (latest?.body as string | undefined) ?? null;
  let since = (latest?.created_at as string | undefined) ?? before.createdAt;
  const rows: { body: string; author_id: string; author_label: string }[] = [];

  if (before.updatedBy && before.updatedBy !== author.id && before.body.trim() && before.body !== latestBody) {
    rows.push({ body: before.body, author_id: before.updatedBy, author_label: await memberName(before.updatedBy) });
    latestBody = before.body;
    since = new Date().toISOString();
  }
  if (shouldCheckpoint({ body, latestBody, since, explicit })) {
    rows.push({ body, author_id: author.id, author_label: await author.label() });
  }
  if (!rows.length) return;
  const start = Date.now();
  await supabaseAdmin.from("task_document_checkpoints").insert(rows.map((r, i) => ({
    id: "tdc_" + randomUUID(), document_id: before.documentId, created_at: new Date(start + i).toISOString(), ...r,
  })));
}

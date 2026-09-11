// SERVER ONLY. Files on a client review document, and the team's saved drafts
// between sends. See supabase/task-document-files.sql.
//
// Files live in the private task-files bucket under doc/<documentId>/, and that
// folder is the boundary: a path from outside it is never recorded or signed.
// Everyone uploads straight to storage through a one time upload link (a Vercel
// request body stops near 4.5MB and files may be 25MB), then asks for the file to
// be recorded, which is when its real size and type are checked.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { TASK_FILES_BUCKET } from "./db";
import {
  MAX_SHARED_FILE_BYTES, cleanFileName, extOf, isActiveContentType, isShareableFileName,
  sharedFileKind, storageSafeName, type SharedFileKind,
} from "./uploadTypes";

export const MAX_DOC_FILES = 50;
/** While someone keeps typing, their draft is kept in the history this often. */
export const CHECKPOINT_EVERY_MS = 10 * 60_000;

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Who added or removed a file, or saved a draft. A null id is the client. */
export type DocActor = { id: string | null; label: string };

export const docFileFolder = (documentId: string) => `doc/${documentId}/`;

/** A path this document may use: a file directly inside its own folder, named
 *  the way startDocUpload names it. */
export function isDocFilePath(documentId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const folder = docFileFolder(documentId);
  return path.startsWith(folder) && /^[0-9a-f-]{36}-[\w.-]+$/.test(path.slice(folder.length));
}

export function checkFileName(raw: unknown): { ok: true; name: string } | Fail {
  if (typeof raw !== "string" || !raw.trim()) return fail(400, "Missing file name.");
  const name = cleanFileName(raw);
  if (!isShareableFileName(name)) {
    return fail(400, "That file type can't be added. Add a photo, PDF, document, spreadsheet, slides or a video.");
  }
  return { ok: true, name };
}

export function checkFileSize(raw: unknown): Fail | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return fail(400, "Invalid file.");
  if (raw > MAX_SHARED_FILE_BYTES) return fail(413, "Each file must be under 25 MB.");
  return null;
}

/** A one time upload link for a new file in the document's folder. */
export async function startDocUpload(documentId: string, rawName: unknown, rawSize: unknown): Promise<{ ok: true; path: string; uploadUrl: string } | Fail> {
  const named = checkFileName(rawName);
  if (!named.ok) return named;
  const sized = checkFileSize(rawSize);
  if (sized) return sized;
  const { count } = await supabaseAdmin.from("task_document_files")
    .select("id", { count: "exact", head: true }).eq("document_id", documentId).is("removed_at", null);
  if ((count ?? 0) >= MAX_DOC_FILES) return fail(400, `A document can hold ${MAX_DOC_FILES} files. Remove one to add another.`);

  const path = `${docFileFolder(documentId)}${randomUUID()}-${storageSafeName(named.name)}`;
  const { data, error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail(500, "Could not start the upload. Please try again.");
  return { ok: true, path, uploadUrl: data.signedUrl };
}

/** Record a file that finished uploading. The object must be in this document's
 *  folder, exist, be under the cap and not carry a type a browser would run;
 *  otherwise it is deleted and nothing is recorded. */
export async function finishDocUpload(documentId: string, rawPath: unknown, rawName: unknown, actor: DocActor, sharedNow: boolean): Promise<{ ok: true; fileId: string; name: string } | Fail> {
  const named = checkFileName(rawName);
  if (!named.ok) return named;
  if (!isDocFilePath(documentId, rawPath) || extOf(rawPath) !== extOf(named.name)) return fail(400, "Invalid file.");

  const storage = supabaseAdmin.storage.from(TASK_FILES_BUCKET);
  const { data: info, error } = await storage.info(rawPath);
  if (error || !info) return fail(400, "The upload didn't finish. Please try again.");
  const meta = ((info as { metadata?: { size?: number; mimetype?: string } }).metadata) ?? {};
  const size = Number(info.size ?? meta.size ?? 0);
  const type = String(info.contentType ?? meta.mimetype ?? "");
  if (!size || size > MAX_SHARED_FILE_BYTES || isActiveContentType(type)) {
    await storage.remove([rawPath]);
    return fail(400, "That file can't be added.");
  }

  const now = new Date().toISOString();
  const fileId = "tdf_" + randomUUID();
  const { error: insertError } = await supabaseAdmin.from("task_document_files").insert({
    id: fileId, document_id: documentId, path: rawPath, name: named.name, size_bytes: size,
    kind: sharedFileKind(named.name), added_by: actor.id, added_by_label: actor.label,
    created_at: now, shared_at: sharedNow ? now : null,
  });
  if (insertError) return fail(409, "That file is already on the document.");
  return { ok: true, fileId, name: named.name };
}

/** Take a file off the document and delete it from storage. The row stays, so
 *  the history can still say who removed it. A client may only remove files a
 *  client added. */
export async function removeDocFile(documentId: string, fileId: unknown, actor: DocActor, clientFilesOnly: boolean): Promise<{ ok: true; name: string } | Fail> {
  if (typeof fileId !== "string") return fail(400, "Invalid request.");
  const { data: f } = await supabaseAdmin.from("task_document_files")
    .select("id, path, name, added_by, removed_at").eq("id", fileId).eq("document_id", documentId).maybeSingle();
  if (!f || f.removed_at) return fail(404, "That file is already gone.");
  if (clientFilesOnly && f.added_by !== null) return fail(403, "You can remove the files you added.");
  await supabaseAdmin.from("task_document_files")
    .update({ removed_at: new Date().toISOString(), removed_by: actor.id, removed_by_label: actor.label }).eq("id", f.id as string);
  await supabaseAdmin.storage.from(TASK_FILES_BUCKET).remove([f.path as string]);
  return { ok: true, name: f.name as string };
}

/** A send shares the team's new files along with the text. */
export async function shareTeamFiles(documentId: string): Promise<void> {
  await supabaseAdmin.from("task_document_files").update({ shared_at: new Date().toISOString() })
    .eq("document_id", documentId).is("shared_at", null).is("removed_at", null);
}

export type SharedDocFile = { id: string; name: string; size: number; kind: SharedFileKind; addedBy: string; fromClient: boolean; createdAt: string };

/** The files the client can see: shared and not removed. No paths leave here. */
export async function sharedDocFiles(documentId: string): Promise<SharedDocFile[]> {
  const { data } = await supabaseAdmin.from("task_document_files")
    .select("id, name, size_bytes, kind, added_by, added_by_label, created_at")
    .eq("document_id", documentId).is("removed_at", null).not("shared_at", "is", null)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string, name: r.name as string, size: Number(r.size_bytes ?? 0), kind: r.kind as SharedFileKind,
    addedBy: (r.added_by_label as string | null) ?? "", fromClient: r.added_by === null, createdAt: r.created_at as string,
  }));
}

/** A short lived link to one shared file, saved rather than shown when asked. */
export async function sharedDocFileUrl(documentId: string, fileId: string, download: boolean): Promise<string | null> {
  const { data: f } = await supabaseAdmin.from("task_document_files")
    .select("path, name").eq("id", fileId).eq("document_id", documentId)
    .is("removed_at", null).not("shared_at", "is", null).maybeSingle();
  if (!f) return null;
  const { data } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET)
    .createSignedUrl(f.path as string, 300, download ? { download: f.name as string } : undefined);
  return data?.signedUrl ?? null;
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

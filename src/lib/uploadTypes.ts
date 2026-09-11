// The files a client can see or send: the client portal's uploads and the files
// on a client review document. No imports, so the public pages can use it.
//
// Nothing that runs when its link is opened directly (html, svg, xml, js). These
// files sit behind links a client opens, and some of them came from a person with
// no account at all.

export const SHAREABLE_FILE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", // images
  "pdf", "doc", "docx", "txt", "rtf", "pages", // documents
  "xls", "xlsx", "csv", "numbers", // sheets
  "ppt", "pptx", "key", // slides
  "mp4", "mov", "webm", "m4v", // short clips
]);

/** 25MB, the same cap as task attachments and the task-files bucket. */
export const MAX_SHARED_FILE_BYTES = 25 * 1024 * 1024;

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export const isShareableFileName = (name: string) => SHAREABLE_FILE_EXT.has(extOf(name));

export type SharedFileKind = "image" | "pdf" | "sheet" | "video" | "doc";

export function sharedFileKind(name: string): SharedFileKind {
  const ext = extOf(name);
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  return "doc";
}

/** Storage keeps the content type the uploader declared. A browser runs these. */
export const isActiveContentType = (type: string) => /html|svg|xml|javascript|ecmascript/i.test(type);

/** The name shown in lists and used for a download: no control characters or
 *  quotes (it ends up in a Content-Disposition header), and not endless. */
export const cleanFileName = (name: string) =>
  name.replace(/[\u0000-\u001f\u007f"\\]/g, "").trim().slice(0, 200) || "file";

/** The name inside a storage path: letters, digits, dot, dash and underscore. */
export const storageSafeName = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(-120);

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

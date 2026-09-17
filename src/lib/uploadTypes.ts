// The files a client can see or send: the client portal's uploads and the files
// on a client review document. No imports, so the public pages can use it.
//
// Nothing that runs when its link is opened directly (html, svg, xml, js). These
// files sit behind links a client opens, and some of them came from a person with
// no account at all.

const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);

export const SHAREABLE_FILE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", // images
  "pdf", "doc", "docx", "txt", "rtf", "pages", // documents
  "xls", "xlsx", "csv", "numbers", // sheets
  "ppt", "pptx", "key", // slides
  ...VIDEO_EXT, // clips, and a video review's video
]);

/** 25MB, the same cap as task attachments and the task-files bucket. */
export const MAX_SHARED_FILE_BYTES = 25 * 1024 * 1024;

/** A video review's video has its own cap, because 25MB is a few seconds of it.
 *  A 720p review copy runs about 15MB a minute, so 500MB is over half an hour
 *  (docs/video-review-plan.md). Masters stay on Derek's Mac. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** Past this, the team is warned before it goes up: at 720p nothing Derek sends a
 *  client is this big, so it is a master picked by mistake, which costs storage
 *  and costs the client their data watching it. */
export const VIDEO_WARN_BYTES = 200 * 1024 * 1024;


export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export const isShareableFileName = (name: string) => SHAREABLE_FILE_EXT.has(extOf(name));

/** The cap on one upload. Only a video review's video gets the bigger one. */
export const maxUploadBytes = (purpose: "file" | "image" | "video") =>
  (purpose === "video" ? MAX_VIDEO_BYTES : MAX_SHARED_FILE_BYTES);

/** A file a video review can hold: the extensions every browser can play back. */
export const isReviewVideo = (name: string) => VIDEO_EXT.has(extOf(name));

export type SharedFileKind = "image" | "pdf" | "sheet" | "video" | "doc";

export function sharedFileKind(name: string): SharedFileKind {
  const ext = extOf(name);
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  if (VIDEO_EXT.has(ext)) return "video";
  return "doc";
}

const PREVIEW_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
/** Images every browser can draw, so they get a thumbnail and open in the
 *  lightbox. HEIC and the rest open by name instead. */
export const isPreviewableImage = (name: string) => PREVIEW_EXT.has(extOf(name));

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
  const mb = bytes / 1024 / 1024;
  // A tenth of a megabyte tells you something about a PDF and nothing about a
  // video, so sizes in the hundreds are whole numbers.
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

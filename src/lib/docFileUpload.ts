// BROWSER. Sending a file to the app without passing it through a Vercel function
// (a request body stops near 4.5MB and files may be 25MB): ask the server for a one
// time upload link, send the file straight to storage, then ask the server to
// check and record it. Used by the client review document (the team's drawer and
// the client's /doc page) and the client portal's uploads (/waiting/[token]). See
// src/lib/taskDocumentFiles.ts for the checks on the other side.
import { formatFileSize, isReviewVideo, maxUploadBytes, isShareableFileName } from "./uploadTypes";

/** Posts one JSON payload to the caller's upload route and returns the response. */
export type DocFileApi = (payload: Record<string, unknown>) => Promise<Response>;

/** Storage refusing the file for its size, which is worth telling apart from any
 *  other failure: trying again never fixes it, and it is not the app's own cap
 *  (that was checked before the upload started). It is the limit the Supabase
 *  project allows for one upload, under Storage then Settings. */
const OVER_LIMIT = /EntityTooLarge|exceeded the maximum allowed size/i;

/** Sends the file straight to storage. This is the one place the app still uses
 *  XMLHttpRequest rather than fetch: fetch cannot report how far an upload has
 *  got, and a video is big enough that watching a still spinner for minutes is
 *  not good enough. Resolves null when it worked, else what to tell the person. */
function putToUploadUrl(uploadUrl: string, file: File, onProgress?: (share: number) => void): Promise<{ error: string; overLimit: boolean } | null> {
  return new Promise((resolve) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(null); return; }
      const overLimit = xhr.status === 413 || OVER_LIMIT.test(xhr.responseText ?? "");
      resolve(overLimit
        ? { error: `${file.name} is ${formatFileSize(file.size)}, over the size limit for one upload.`, overLimit: true }
        : { error: `Could not upload ${file.name}. Please try again.`, overLimit: false });
    };
    xhr.onerror = () => resolve({ error: `Could not upload ${file.name}. Check your connection and try again.`, overLimit: false });
    xhr.send(body);
  });
}

/** One file, start to confirm. On success, the confirm response's JSON; otherwise
 *  a message that can be shown to the person as it is. purpose "video" is a video
 *  review's video, which has its own, much larger cap (uploadTypes.ts). */
export async function uploadSharedFile(file: File, api: DocFileApi, purpose: "file" | "image" | "video" = "file", onProgress?: (share: number) => void): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; overLimit?: boolean }> {
  if (purpose === "video" && !isReviewVideo(file.name)) return { ok: false, error: `${file.name} can't be added. Add an MP4, MOV, WebM or M4V video.` };
  if (!isShareableFileName(file.name)) return { ok: false, error: `${file.name} can't be added. Add a photo, PDF, document, spreadsheet, slides or a video.` };
  const cap = maxUploadBytes(purpose);
  if (file.size > cap) return { ok: false, error: `${file.name} is ${formatFileSize(file.size)}, over the ${formatFileSize(cap)} limit.` };
  try {
    const start = await api({ action: "start", name: file.name, size: file.size });
    const s = await start.json().catch(() => ({}));
    if (!start.ok) return { ok: false, error: (s.error as string) ?? `Could not add ${file.name}.` };
    const put = await putToUploadUrl(s.uploadUrl as string, file, onProgress);
    if (put) return { ok: false, error: put.error, overLimit: put.overLimit };
    const done = await api({ action: "confirm", path: s.path, name: file.name });
    const d = await done.json().catch(() => ({}));
    if (!done.ok) return { ok: false, error: (d.error as string) ?? `Could not add ${file.name}.` };
    return { ok: true, result: d };
  } catch {
    return { ok: false, error: `Could not upload ${file.name}. Check your connection and try again.` };
  }
}

/** Adds the files one at a time. Returns a message for the first one that could
 *  not be added (the ones before it are in), or null when all of them made it. */
export async function addDocFiles(files: File[], api: DocFileApi, onAdded?: () => void): Promise<string | null> {
  for (const file of files) {
    const r = await uploadSharedFile(file, api);
    if (!r.ok) return r.error;
    onAdded?.();
  }
  return null;
}

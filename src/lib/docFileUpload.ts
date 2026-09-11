// BROWSER. Adding files to a client review document, the same way for the team's
// drawer and the client's /doc page: ask the server for a one time upload link,
// send the file straight to storage, then ask the server to record it. See
// src/lib/taskDocumentFiles.ts for the checks on the other side.
import { MAX_SHARED_FILE_BYTES, isShareableFileName } from "./uploadTypes";

/** Posts one JSON payload to the caller's files route and returns the response. */
export type DocFileApi = (payload: Record<string, unknown>) => Promise<Response>;

async function putToUploadUrl(uploadUrl: string, file: File): Promise<boolean> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  try {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      body,
      headers: { "x-upsert": "false", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Adds the files one at a time. Returns a message for the first one that could
 *  not be added (the ones before it are in), or null when all of them made it. */
export async function addDocFiles(files: File[], api: DocFileApi, onAdded?: () => void): Promise<string | null> {
  for (const file of files) {
    if (!isShareableFileName(file.name)) return `${file.name} can't be added. Add a photo, PDF, document, spreadsheet, slides or a video.`;
    if (file.size > MAX_SHARED_FILE_BYTES) return `${file.name} is over 25 MB.`;
    const start = await api({ action: "start", name: file.name, size: file.size });
    const s = await start.json().catch(() => ({}));
    if (!start.ok) return (s.error as string) ?? `Could not add ${file.name}.`;
    if (!(await putToUploadUrl(s.uploadUrl as string, file))) return `Could not upload ${file.name}. Please try again.`;
    const done = await api({ action: "confirm", path: s.path, name: file.name });
    const d = await done.json().catch(() => ({}));
    if (!done.ok) return (d.error as string) ?? `Could not add ${file.name}.`;
    onAdded?.();
  }
  return null;
}

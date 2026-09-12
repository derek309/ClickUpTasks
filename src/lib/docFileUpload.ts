// BROWSER. Sending a file to the app without passing it through a Vercel function
// (a request body stops near 4.5MB and files may be 25MB): ask the server for a one
// time upload link, send the file straight to storage, then ask the server to
// check and record it. Used by the client review document (the team's drawer and
// the client's /doc page) and the client portal's uploads (/waiting/[token]). See
// src/lib/taskDocumentFiles.ts for the checks on the other side.
import { MAX_SHARED_FILE_BYTES, isShareableFileName } from "./uploadTypes";

/** Posts one JSON payload to the caller's upload route and returns the response. */
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

/** One file, start to confirm. On success, the confirm response's JSON; otherwise
 *  a message that can be shown to the person as it is. */
export async function uploadSharedFile(file: File, api: DocFileApi): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  if (!isShareableFileName(file.name)) return { ok: false, error: `${file.name} can't be added. Add a photo, PDF, document, spreadsheet, slides or a video.` };
  if (file.size > MAX_SHARED_FILE_BYTES) return { ok: false, error: `${file.name} is over 25 MB.` };
  try {
    const start = await api({ action: "start", name: file.name, size: file.size });
    const s = await start.json().catch(() => ({}));
    if (!start.ok) return { ok: false, error: (s.error as string) ?? `Could not add ${file.name}.` };
    if (!(await putToUploadUrl(s.uploadUrl as string, file))) return { ok: false, error: `Could not upload ${file.name}. Please try again.` };
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

// Server-only: the daily sweep that clears a video review's file 30 days after
// the review was approved (docs/video-review-plan.md, slice 4). Fired by
// /api/cron/purge-video (see vercel.json).
//
// This is the app's first retention rule that is not about trash. Nothing is
// deleted because someone asked for it to go: video is simply the first thing
// stored here big enough that keeping every copy forever costs real money, and
// an approved video has done its job.
//
// What goes and what stays is the whole point. The bytes go. The review, its
// versions, its comments, its history and the file's own row all stay, so the
// page can still say what was reviewed and what was said about it. cleared_at
// marks the row, deliberately not removed_at, which would mean the version was
// taken off the review and would hide it from the client's list along with the
// context for its comments.
import { supabaseAdmin } from "./supabaseAdmin";
import { TASK_FILES_BUCKET } from "./db";

/** Days after approval that a video's file is cleared. */
export const VIDEO_KEEP_DAYS = 30;
/** Files per run. A sweep that falls behind catches up the next day rather than
 *  running long enough to be cut off halfway. */
const BATCH = 200;

export type VideoPurgeResult = {
  /** Files whose bytes were deleted and whose row was marked cleared. */
  cleared: number;
  /** Bytes those files were taking up. */
  bytesFreed: number;
  errors: string[];
};

/** Clear every video whose review was approved longer ago than the window. A
 *  review that was never approved is never cleared: the clock starts at
 *  approval, so an abandoned review keeps its video until someone deletes it. */
export async function purgeApprovedVideos(now = new Date()): Promise<VideoPurgeResult> {
  const errors: string[] = [];
  const cutoff = new Date(now.getTime() - VIDEO_KEEP_DAYS * 86_400_000).toISOString();

  const { data: docs, error: docError } = await supabaseAdmin.from("task_documents")
    .select("id").eq("kind", "video").is("deleted_at", null).not("approved_at", "is", null).lt("approved_at", cutoff);
  if (docError) return { cleared: 0, bytesFreed: 0, errors: [`documents: ${docError.message}`] };
  const ids = (docs ?? []).map((d) => d.id as string);
  if (!ids.length) return { cleared: 0, bytesFreed: 0, errors };

  const { data: files, error: fileError } = await supabaseAdmin.from("task_document_files")
    .select("id, path, size_bytes").in("document_id", ids)
    .eq("purpose", "video").is("cleared_at", null).is("removed_at", null).limit(BATCH);
  if (fileError) return { cleared: 0, bytesFreed: 0, errors: [`files: ${fileError.message}`] };
  const rows = files ?? [];
  if (!rows.length) return { cleared: 0, bytesFreed: 0, errors };

  // Storage first, then the rows. That order can only ever leave a file deleted
  // whose row does not say so yet, which the next run puts right; the other way
  // round would leave a row claiming the video is gone while it is still stored
  // and still being paid for.
  const { error: removeError } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).remove(rows.map((f) => f.path as string));
  if (removeError) return { cleared: 0, bytesFreed: 0, errors: [`storage: ${removeError.message}`] };

  const { error: markError } = await supabaseAdmin.from("task_document_files")
    .update({ cleared_at: now.toISOString() }).in("id", rows.map((f) => f.id as string));
  if (markError) errors.push(`marking cleared: ${markError.message}`);

  return { cleared: rows.length, bytesFreed: rows.reduce((sum, f) => sum + Number(f.size_bytes ?? 0), 0), errors };
}

/** How much video is stored right now: what the purge exists to hold down. */
export async function storedVideoBytes(): Promise<{ files: number; bytes: number }> {
  const { data } = await supabaseAdmin.from("task_document_files")
    .select("size_bytes").eq("purpose", "video").is("cleared_at", null).is("removed_at", null);
  const rows = data ?? [];
  return { files: rows.length, bytes: rows.reduce((sum, f) => sum + Number(f.size_bytes ?? 0), 0) };
}

// How much video is stored right now: the number the 30 day purge exists to
// hold down (supabase/task-video-purge.sql). Asked by the settings screen with
// the signed in client and by the purge cron with the service role, so it takes
// the client rather than importing one.
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

/** Cleared and removed videos are not counted, because neither is taking up
 *  space any more. Paged, because a single read stops at 1,000 rows and would
 *  under report past that. null when a read failed. */
export async function sumStoredVideo(client: SupabaseClient, onError?: (error: unknown) => void): Promise<{ files: number; bytes: number } | null> {
  let files = 0, bytes = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from("task_document_files")
      .select("size_bytes").eq("purpose", "video").is("cleared_at", null).is("removed_at", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) { onError?.(error); return null; }
    const rows = (data ?? []) as { size_bytes: number | null }[];
    files += rows.length;
    bytes += rows.reduce((sum, r) => sum + Number(r.size_bytes ?? 0), 0);
    if (rows.length < PAGE) return { files, bytes };
  }
}

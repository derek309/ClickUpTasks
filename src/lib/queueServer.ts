// Server only: a queue list's Now check (mcp/queue.mjs) after a change made
// away from the app (a step ticked by Claude or the server, a client approving
// on their portal, GoHighLevel closing a task). The app does the same check
// after its own edits (useTaskEdits followQueue). Quiet, and harmless, on a
// database without the queue columns (supabase/task-queues.sql): the reads
// fail and nothing is written.
import { supabaseAdmin } from "./supabaseAdmin";
import { CLAUDE_ID, formatDue } from "./data";
import { QUEUE_TASK_COLS, bottomPlaceStore, promoteQueueStore, queuePatchRow, queueTaskFromRow, type QPatch, type QueueStore } from "../../mcp/queue.mjs";

export const adminQueueStore: QueueStore = {
  async queue(projectId) {
    const { data, error } = await supabaseAdmin.from("projects").select("queue").eq("id", projectId).maybeSingle();
    if (error) throw error;
    return (data as { queue?: unknown } | null)?.queue ?? null;
  },
  async tasks(projectId) {
    const { data, error } = await supabaseAdmin.from("tasks").select(QUEUE_TASK_COLS).eq("project_id", projectId).is("deleted_at", null).neq("status", "done");
    if (error) return null;
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(queueTaskFromRow);
  },
  async write(p: QPatch) {
    // updated_by null so the change shows live for everyone, as other server writes do.
    await supabaseAdmin.from("tasks").update({ ...queuePatchRow(p), updated_by: null }).eq("id", p.id);
    if (p.due) {
      const comment = { id: "cm_" + crypto.randomUUID(), authorId: CLAUDE_ID, at: new Date().toISOString(), kind: "event" as const, body: `came up next in the queue, due ${formatDue(p.due)}` };
      await supabaseAdmin.rpc("append_comment", { task_id: p.id, comment });
      await supabaseAdmin.from("tasks").update({ updated_by: null }).eq("id", p.id);
    }
  },
};

/** The Now check for the list a task is on. */
export async function promoteQueueForTask(taskId: string, projectId?: string | null): Promise<QPatch[]> {
  let pid = projectId;
  if (pid === undefined) {
    const { data } = await supabaseAdmin.from("tasks").select("project_id").eq("id", taskId).maybeSingle();
    pid = (data as { project_id?: string | null } | null)?.project_id ?? null;
  }
  return promoteQueueStore(adminQueueStore, pid);
}

/** A repeat's next copy on a queue list: the end of the line, no date (the
 *  date it would have had is saved). The row unchanged when the list has no
 *  queue, so the copy never names a queue column on a database without them. */
export async function queueRepeatCopy<T extends Record<string, unknown>>(row: T): Promise<T> {
  const place = await bottomPlaceStore(adminQueueStore, row.project_id as string | null);
  // No queue: the copy carries none of the old one's place or saved date.
  if (place == null) return "queue_pos" in row ? { ...row, queue_pos: null, queue_saved_due: null } : row;
  const pinned = row.deadline === true;
  return { ...row, queue_pos: place, ...(pinned ? {} : { due: null, queue_saved_due: row.due ?? null }) };
}

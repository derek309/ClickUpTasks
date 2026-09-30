// Server only: what a client's answer does to the follow up on a task.
//
// A follow up can wait on the client ("Done when Brian approves it", "Done when
// Brian writes back"). The drawer finishes it when it sees the answer, but only
// while someone has that task open, so an approval at 9pm left the follow up
// open and its date still days away until somebody happened to look. The
// routes where the answer actually arrives call this, so the task is right
// whether or not anyone is watching.
import { supabaseAdmin } from "./supabaseAdmin";
import { todayPacific } from "./data";

/** `what` is the watch the answer satisfies, as stored in
 *  task_actions.next_step_watch: "reply", or "approved:<kind>". */
export async function clientAnsweredOnTask(taskId: string | null, what: string): Promise<void> {
  if (!taskId) return;
  // The open follow up is the newest step not yet ticked (data.ts openNextStep).
  const { data: steps } = await supabaseAdmin
    .from("task_actions").select("id, next_step_watch").eq("task_id", taskId)
    .not("next_step", "is", null).is("next_step_done_at", null)
    .order("at", { ascending: false }).limit(1);
  const open = steps?.[0] as { id: string; next_step_watch: string | null } | undefined;
  if (open?.next_step_watch === what) {
    await supabaseAdmin.from("task_actions").update({ next_step_done_at: new Date().toISOString() }).eq("id", open.id);
  }
  // A follow up date in the future hides the task until then (data.ts
  // isSnoozed), and the client has just spoken. Today, not cleared: the list's
  // Follow up column is where people look for what needs them now.
  const today = todayPacific();
  await supabaseAdmin.from("tasks").update({ follow_up_at: today, updated_by: null }).eq("id", taskId).gt("follow_up_at", today);
}

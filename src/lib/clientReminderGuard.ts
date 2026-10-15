// SERVER-ONLY: a reminder to a client about a step that is no longer their
// turn never goes (Derek, 2026-10-15: Jack Flynn booked through the link, his
// wait was finished, and "We need you to book a Meeting" was still set to go
// at 8 AM). Two guards, one rule (clientRequests.reminderStillWanted):
//   - just before a reminder is sent (the 15 minute sender, Approve in
//     Reminders, Send in the Inbox), its task is read again;
//   - when a step finishes on the server (their reply, their portal answer,
//     their booking, a step ticked over the MCP), the task's queued and
//     approved reminders are canceled at once, not at the next run.
// A step ticked in the app is caught by the 15 minute sender's sweep.
import { supabaseAdmin } from "./supabaseAdmin";
import { REVIEW_STATUS } from "./portalReminders";
import { CLIENT_REMINDER_PREFIXES, NO_LONGER_WAITING, parseReminderId, reminderStillWanted } from "./clientRequests";
import type { Subtask } from "./data";

type TaskState = { id: string; status: string; deleted_at: string | null; subtasks: Subtask[] | null };
const WAITING = [REVIEW_STATUS, "pending"];

/** The tasks, or null when they could not be read (then nothing is canceled). */
async function tasksById(ids: string[]): Promise<Map<string, TaskState> | null> {
  const out = new Map<string, TaskState>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin.from("tasks").select("id, status, deleted_at, subtasks").in("id", ids.slice(i, i + 200));
    if (error) return null;
    for (const t of (data ?? []) as TaskState[]) out.set(t.id, t);
  }
  return out;
}

/** Whether this reminder row should still go, read from its task now. A row
 *  about no one step, or with no task, is left to go. */
export async function reminderRowStillWanted(row: { id: string; task_id: string | null }): Promise<boolean> {
  if (!parseReminderId(row.id).stepId || !row.task_id) return true;
  const tasks = await tasksById([row.task_id]);
  return !tasks || reminderStillWanted(row.id, tasks.get(row.task_id) ?? null);
}

/** Marks a row canceled, only while it is still waiting or claimed by us. */
export async function cancelReminderRow(id: string, from: string[] = [...WAITING, "sending"]): Promise<boolean> {
  const { data } = await supabaseAdmin.from("scheduled_messages").update({ status: "canceled", error: NO_LONGER_WAITING }).eq("id", id).in("status", from).select("id");
  return !!data?.length;
}

/** Cancels every queued (pending) or waiting for review client reminder
 *  whose step is no longer the client's turn: one task's, or all of them.
 *  How many it canceled. */
export async function cancelStaleClientReminders(o: { taskId?: string | null } = {}): Promise<number> {
  let q = supabaseAdmin.from("scheduled_messages").select("id, task_id")
    .in("status", WAITING).or(CLIENT_REMINDER_PREFIXES.map((p) => `id.like.${p}%`).join(","));
  if (o.taskId) q = q.eq("task_id", o.taskId);
  const { data, error } = await q.limit(1000);
  if (error) return 0;
  const rows = ((data ?? []) as { id: string; task_id: string | null }[]).filter((r) => r.task_id && parseReminderId(r.id).stepId);
  if (!rows.length) return 0;
  const tasks = await tasksById([...new Set(rows.map((r) => r.task_id as string))]);
  if (!tasks) return 0;
  let canceled = 0;
  for (const r of rows) {
    if (reminderStillWanted(r.id, tasks.get(r.task_id as string) ?? null)) continue;
    if (await cancelReminderRow(r.id, WAITING)) canceled++;
  }
  return canceled;
}

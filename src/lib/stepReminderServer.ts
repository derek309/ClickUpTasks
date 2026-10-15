// SERVER-ONLY: the reminders set on steps from After this (Derek, 2026-10-15),
// run by the weekday 8 AM job (cron/portal-reminders) before its client
// counts email. A step reminds only while it is the current step of an open
// task.
//   A teammate's turn: a bell notification and a phone push, the business day
//   before it is due or the morning it is due.
//   The client's turn is lib/clientRequestsServer now (Derek and Justin,
//   2026-10-15): one request a client at a time, on by default, for review.
// It never sets a follow up date.
import { supabaseAdmin } from "./supabaseAdmin";
import { currentStep, toPacificDate, type Subtask } from "./data";
import { clientReminderIdFilter } from "./clientRequests";
import { stepReminderTurn, teammateStepReminderDue } from "./stepReminders";
import { sendPush } from "./push";
import { buildPushPayload, pushLink } from "./pushPayload";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type StepReminderTally = { steps: number; teammateNotified: number; notToday: number };

/** The Pacific date of the newest reminder of any kind sent or queued to this client. */
export async function lastReminderDay(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("scheduled_messages").select("scheduled_at")
    .or(clientReminderIdFilter()).eq("client_id", clientId)
    .order("scheduled_at", { ascending: false }).limit(1);
  return data?.[0]?.scheduled_at ? toPacificDate(data[0].scheduled_at as string) : null;
}

export async function runStepReminders(o: { today: string; nowMs: number; dry: boolean }): Promise<{ tally: StepReminderTally; previews: { to: string; subject: string; kind: "teammate" }[] }> {
  const tally: StepReminderTally = { steps: 0, teammateNotified: 0, notToday: 0 };
  const previews: { to: string; subject: string; kind: "teammate" }[] = [];
  // Open tasks with a reminder on any step (read only; nothing here writes a task).
  const { data: rows, error } = await supabaseAdmin.from("tasks").select("id, title, client_id, assignee_id, is_private, hidden_from_client, subtasks")
    .neq("status", "done").is("deleted_at", null).contains("subtasks", [{ remind: {} }]).limit(2000);
  if (error) return { tally, previews };
  for (const t of (rows ?? []) as any[]) {
    const cur = currentStep((t.subtasks ?? []) as Subtask[]);
    // The client's turn: lib/clientRequestsServer (runClientRequests).
    if (!cur || stepReminderTurn(cur, t.assignee_id ?? null) !== "teammate") continue;
    tally.steps++;
    if (!teammateStepReminderDue(cur.remind, { today: o.today, due: cur.due ?? null })) { tally.notToday++; continue; }
    const who = cur.assigneeId!;
    const text = `Reminder: "${cur.title}" on "${t.title}" is ${cur.remind && "at" in cur.remind && cur.remind.at === "morning" ? "due today" : "due tomorrow"}`;
    if (o.dry) { previews.push({ to: who, subject: text, kind: "teammate" }); continue; }
    // One per step per day: the id says which, so a second run rings nothing.
    const id = `n_sr_${cur.id}_${o.today}`;
    const { data: made } = await supabaseAdmin.from("notifications").upsert({
      id, recipient_id: who, text, task_id: t.id, actor_id: null, client_id: t.client_id, project_id: null,
      at: new Date(o.nowMs).toISOString(), read: false, kind: "activity",
    }, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (made?.length) {
      tally.teammateNotified++;
      await sendPush([who], buildPushPayload({ title: "Reminder", body: text, url: pushLink({ taskId: t.id, clientId: t.client_id }), tag: `remind-${cur.id}` }));
    }
  }
  return { tally, previews };
}

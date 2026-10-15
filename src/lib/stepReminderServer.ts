// SERVER-ONLY: the reminders set on steps from After this (Derek, 2026-10-15),
// run by the weekday 8 AM job (cron/portal-reminders) before its client
// counts email. Off unless picked on the step (Subtask.remind); a step
// reminds only while it is the current step of an open task.
//   The client's turn: a short email about that one item (portalReminders
//   stepReminderEmail) with the portal link to it, queued through
//   scheduled_messages like the counts email, for review or sending itself by
//   the client's own setting (clients.reminders.auto), and at most one
//   reminder of any kind per client per day.
//   A teammate's turn: a bell notification and a phone push, the business day
//   before it is due or the morning it is due.
// It never sets a follow up date.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { resolveContact } from "./sendMessageServer";
import { resolveNotifyRecipient } from "./waitingNotify";
import { APP_URL } from "./appUrl";
import { draftLinkAsButton } from "./draftLink";
import { currentStep, toPacificDate, type Subtask } from "./data";
import { PORTAL_REMINDER_PREFIX, REVIEW_STATUS, STEP_REMINDER_LINK_LABEL, STEP_REMINDER_PREFIX, stepReminderEmail } from "./portalReminders";
import { reminderQueueStatus } from "./reminderSchedule";
import { clientStepReminderDue, stepAsk, stepReminderTurn, teammateStepReminderDue } from "./stepReminders";
import { sendPush } from "./push";
import { buildPushPayload, pushLink } from "./pushPayload";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type StepReminderTally = { steps: number; clientQueued: number; teammateNotified: number; notToday: number; alreadyToday: number; waitingReview: number; noEmail: number; noSender: number };

/** The Pacific date of the newest reminder of any kind sent or queued to this client. */
export async function lastReminderDay(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("scheduled_messages").select("scheduled_at")
    .or(`id.like.${PORTAL_REMINDER_PREFIX}%,id.like.${STEP_REMINDER_PREFIX}%`).eq("client_id", clientId)
    .order("scheduled_at", { ascending: false }).limit(1);
  return data?.[0]?.scheduled_at ? toPacificDate(data[0].scheduled_at as string) : null;
}

export async function runStepReminders(o: { today: string; nowMs: number; dry: boolean }): Promise<{ tally: StepReminderTally; previews: { to: string; subject: string; kind: "client" | "teammate" }[] }> {
  const tally: StepReminderTally = { steps: 0, clientQueued: 0, teammateNotified: 0, notToday: 0, alreadyToday: 0, waitingReview: 0, noEmail: 0, noSender: 0 };
  const previews: { to: string; subject: string; kind: "client" | "teammate" }[] = [];
  // Open tasks with a reminder on any step (read only; nothing here writes a task).
  const { data: rows, error } = await supabaseAdmin.from("tasks").select("id, title, client_id, assignee_id, is_private, hidden_from_client, subtasks")
    .neq("status", "done").is("deleted_at", null).contains("subtasks", [{ remind: {} }]).limit(2000);
  if (error) return { tally, previews };
  for (const t of (rows ?? []) as any[]) {
    const subtasks = (t.subtasks ?? []) as Subtask[];
    const cur = currentStep(subtasks);
    const turn = cur ? stepReminderTurn(cur, t.assignee_id ?? null) : null;
    if (!cur || !turn) continue;
    tally.steps++;
    if (turn === "teammate") {
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
      continue;
    }
    // The client's turn: shared tasks of a real client only.
    const clientId = t.client_id as string;
    if (!clientId?.startsWith("cl_") || clientId === "cl_workspace" || t.is_private || t.hidden_from_client) continue;
    const lastDay = await lastReminderDay(clientId);
    if (lastDay && lastDay >= o.today) { tally.alreadyToday++; continue; }
    const { data: forStep } = await supabaseAdmin.from("scheduled_messages").select("id").like("id", `${STEP_REMINDER_PREFIX}${cur.id}_%`).limit(1);
    const started = cur.startedAt ? toPacificDate(cur.startedAt) : null;
    if (!clientStepReminderDue(cur.remind, { today: o.today, checkIn: cur.due ?? null, started, lastToClient: lastDay, sentForStep: !!forStep?.length })) { tally.notToday++; continue; }
    // A reminder to them still waiting for review: not a second one.
    const { data: open } = await supabaseAdmin.from("scheduled_messages").select("id")
      .or(`id.like.${PORTAL_REMINDER_PREFIX}%,id.like.${STEP_REMINDER_PREFIX}%`).eq("client_id", clientId).eq("status", REVIEW_STATUS).limit(1);
    if (open?.length) { tally.waitingReview++; continue; }
    const { data: client } = await supabaseAdmin.from("clients").select("id, name, share_token, assigned_to, reminders, deleted_at").eq("id", clientId).maybeSingle();
    if (!client || client.deleted_at) continue;
    const contact = await resolveContact(clientId);
    if (!contact?.email) { tally.noEmail++; continue; }
    const owner = (t.assignee_id as string | null) ?? await resolveNotifyRecipient(client.assigned_to as string[] | null);
    if (!owner) { tally.noSender++; continue; }
    const { data: person } = await supabaseAdmin.from("contacts").select("name").eq("id", contact.id).maybeSingle();
    const raw = String((person as any)?.name ?? "").trim().split(/\s+/)[0] || "";
    const first = raw ? raw[0].toUpperCase() + raw.slice(1) : null;
    // The portal, opened on this task. No token yet: one is made, as the counts email does.
    let token = client.share_token as string | null;
    if (!token && !o.dry) {
      token = randomUUID().replace(/-/g, "");
      await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", clientId);
    }
    const link = { url: `${APP_URL}/waiting/${token ?? "<made when sent>"}?task=${encodeURIComponent(t.id)}`, label: STEP_REMINDER_LINK_LABEL };
    const email = stepReminderEmail({ firstName: first, ask: stepAsk(cur, first ?? String(client.name ?? ""), t.title ?? ""), taskTitle: t.title ?? "", link });
    if (o.dry) { previews.push({ to: contact.email, subject: email.subject, kind: "client" }); continue; }
    const status = reminderQueueStatus(client.reminders ?? null, REVIEW_STATUS);
    const { error: qErr } = await supabaseAdmin.from("scheduled_messages").insert({
      id: `${STEP_REMINDER_PREFIX}${cur.id}_${randomUUID()}`, client_id: clientId, task_id: t.id, channel: "email",
      subject: email.subject, body: draftLinkAsButton(email.body, link), scheduled_at: new Date(o.nowMs).toISOString(), status, created_by: owner,
    });
    if (!qErr) tally.clientQueued++;
  }
  return { tally, previews };
}

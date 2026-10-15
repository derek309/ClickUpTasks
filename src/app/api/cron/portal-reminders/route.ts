import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { resolveNotifyRecipient } from "@/lib/waitingNotify";
import { buildPortalReminder } from "@/lib/portalReminderServer";
import { todayPacific } from "@/lib/data";
import { isReminderHour, PORTAL_REMINDER_PREFIX, REVIEW_STATUS } from "@/lib/portalReminders";
import { lastReminderDay, runStepReminders } from "@/lib/stepReminderServer";
import { runClientRequests } from "@/lib/clientRequestsServer";
import { clientReminderIdFilter } from "@/lib/clientRequests";
import { isReminderDay, reminderQueueStatus, reminderSettings } from "@/lib/reminderSchedule";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The client reminder at 8 AM (Derek, 2026-10-05: "remind them what we need
// from them"). Each client with something waiting on them gets one email
// from the person who looks after them: how many things we need, by list, and
// a button to their client portal (the same words as Remind on the client
// page). Queued through scheduled_messages like the review reminders, so it
// retries, signs as the sender and lands in the conversation. Clients with
// nothing waiting on them get nothing.
//
// When, per client (Derek, 2026-10-14), set on the client page's waiting
// card and saved in clients.reminders (lib/reminderSchedule): Mondays, every
// few business days, picked weekdays, or off; and either waiting in the
// Inbox, "Reminder emails going out", until someone sends it (the default,
// as since 2026-10-07), or sent on its own by the 15 minute sender. Nothing
// chosen is Mondays, for review. The old weekday "follow up due" emails are
// gone: the Monday only cron had made them dead since 2026-10-07, and the
// client's schedule is what decides the day now.
//
// vercel.json runs it at 15:00 and 16:00 UTC Monday to Friday; it only acts
// in the one that is 8 AM in California. An admin can POST ?dry=1 to see who
// would get one today without queuing anything, and ?force=1 to run outside
// the hour (each client's schedule still decides).
//
// The client request reminders go first (Derek and Justin, 2026-10-15,
// lib/clientRequestsServer): each client's top request, asked, reminded,
// due or late, or one summary when 5 or more are late, all for review; and
// the expected dates of tasks waiting on a late one move. Then a teammate's
// step reminders (lib/stepReminderServer). The counts email below shares the
// one a day per client guard, so a client never gets both on one day; it is
// off unless a client's schedule is picked (since 2026-10-15).

export const maxDuration = 60;
export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const nowMs = Date.now();
  if (!dry && !force && !isReminderHour(nowMs)) return NextResponse.json({ ok: true, skipped: "not 8 AM on a weekday in California" });
  const today = todayPacific();
  const requests = await runClientRequests({ today, nowMs, dry, mode: "morning" });
  const steps = await runStepReminders({ today, nowMs, dry });

  // Open, shared tasks waiting on a client: who gets an email at all.
  const { data: waiting, error } = await supabaseAdmin.from("tasks").select("client_id")
    .eq("waiting_on_client", true).neq("status", "done").eq("is_private", false).eq("hidden_from_client", false).is("deleted_at", null).like("client_id", "cl_%").limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const clientIds = [...new Set(((waiting ?? []) as any[]).map((x) => x.client_id as string))].filter((id) => id !== "cl_workspace");

  // Each one's schedule. Before supabase/client-reminders.sql has run the
  // column isn't there: everyone gets the default, off since 2026-10-15.
  const settings = new Map<string, unknown>();
  let settingsMissing = false;
  if (clientIds.length) {
    const { data: rows, error: sErr } = await supabaseAdmin.from("clients").select("id, reminders").in("id", clientIds);
    if (sErr) settingsMissing = true;
    for (const r of (rows ?? []) as any[]) settings.set(r.id as string, r.reminders ?? null);
  }

  const tally = { clients: clientIds.length, queued: 0, sentOnTheirOwn: 0, notToday: 0, off: 0, alreadyToday: 0, waitingReview: 0, nothingSent: 0, noEmail: 0, noSender: 0 };
  const previews: { client: string; to: string; subject: string; goes: "on its own" | "for review" }[] = [];
  for (const clientId of clientIds) {
    const setting = settings.get(clientId) ?? null;
    if (reminderSettings(setting).schedule === "off") { tally.off++; continue; }
    // The newest reminder sent or queued for them, whatever became of it.
    // A step reminder counts too: one a day per client, whichever kind.
    const lastDay = await lastReminderDay(clientId);
    // One a day at most.
    if (lastDay && lastDay >= today) { tally.alreadyToday++; continue; }
    if (!isReminderDay(setting, today, lastDay)) { tally.notToday++; continue; }
    // The last one still waiting for review: not a second one (audit 2026-10-07).
    const { data: open } = await supabaseAdmin.from("scheduled_messages").select("id").or(clientReminderIdFilter()).eq("client_id", clientId).eq("status", REVIEW_STATUS).limit(1);
    if (open?.length) { tally.waitingReview++; continue; }
    // The same builder Refresh uses in the Inbox (lib/portalReminderServer).
    const built = await buildPortalReminder(clientId, { dry });
    if (!built.ok) { if (built.reason === "no_email") tally.noEmail++; else if (built.reason === "nothing") tally.nothingSent++; continue; }
    const owner = await resolveNotifyRecipient(built.assignedTo);
    if (!owner) { tally.noSender++; continue; }
    const status = reminderQueueStatus(setting, REVIEW_STATUS);
    if (dry) { previews.push({ client: built.clientName, to: built.to, subject: built.email.subject, goes: status === REVIEW_STATUS ? "for review" : "on its own" }); continue; }
    // "pending" now: the 15 minute sender (cron/send-scheduled) sends it on its next run.
    const { error: qErr } = await supabaseAdmin.from("scheduled_messages").insert({
      id: PORTAL_REMINDER_PREFIX + randomUUID(), client_id: clientId, task_id: null, channel: "email",
      subject: built.email.subject, body: built.email.body, scheduled_at: new Date(nowMs).toISOString(), status, created_by: owner,
    });
    if (!qErr) { tally.queued++; if (status !== REVIEW_STATUS) tally.sentOnTheirOwn++; }
  }
  const out = { ok: true, dry, today, ...(settingsMissing ? { settingsMissing } : {}), ...tally, requests: requests.tally, stepReminders: steps.tally, ...(dry ? { previews, requestPreviews: requests.previews, stepPreviews: steps.previews } : {}) };
  console.log("[cron/portal-reminders]", JSON.stringify({ ...out, previews: undefined, requestPreviews: undefined, stepPreviews: undefined }));
  return NextResponse.json(out);
}

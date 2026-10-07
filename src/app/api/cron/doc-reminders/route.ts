import { NextRequest, NextResponse } from "next/server";
import { REVIEW_STATUS } from "@/lib/portalReminders";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { linkState } from "@/lib/taskDocumentServer";
import { resolveNotifyRecipient } from "@/lib/waitingNotify";
import { resolveContact } from "@/lib/sendMessageServer";
import { draftLinkAsButton, draftLinkHtml, escapeHtml } from "@/lib/draftLink";
import { APP_URL } from "@/lib/appUrl";
import { isBusinessDay, reminderDue, MAX_REMINDERS, REMINDER_MESSAGE_PREFIX } from "@/lib/reviewReminders";

// Every business morning, a review that is with the client and unanswered gets
// a reminder email (supabase/review-reminders.sql). The rules are all in
// reviewReminders.ts: every N business days, three at most in a round, a round
// starting at each send or Restart and stopping when the client answers.
//
// It used to stage a draft on the task for a person to send, once, after three
// days (Derek, 2026-09-11). Derek, 2026-09-21, wanted it to actually go out,
// every business day, and stop after three. The send goes through the scheduled
// message queue rather than a sender of its own: that queue already retries a
// Gmail or GoHighLevel hiccup, signs the email as its author, and puts it in
// the task's conversation like anything else that was sent.
//
// Each reminder is sent as the task's owner. They did not click Send on it, so
// the bell after the last one of a round says it went in their name.
//
// Same cron auth as the others. Scheduled in vercel.json for 15:00 UTC, which is
// 8 AM in California in summer and 7 AM in winter.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date().toISOString();
  // A cron that fires on a Saturday in UTC can still be Friday in California,
  // and the other way round, so this asks the same question the rules do.
  if (!isBusinessDay(now)) return NextResponse.json({ ok: true, skipped: "not a business day" });

  const { data: docs, error } = await supabaseAdmin.from("task_documents")
    .select("id, task_id, title, kind, reminder_every_days, reminder_round_at, reminders_sent, last_reminder_at")
    .is("deleted_at", null).is("approved_at", null).eq("status", "with_client").gt("reminder_every_days", 0)
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const tally = { checked: (docs ?? []).length, sent: 0, noContact: 0, unsure: 0 };
  // Each review's newest version and its task, two queries for the whole run
  // rather than two per review.
  const docIds = (docs ?? []).map((d) => d.id as string);
  const [{ data: versions }, { data: tasks }] = await Promise.all([
    docIds.length
      ? supabaseAdmin.from("task_document_versions").select("document_id, kind, created_at, version").in("document_id", docIds).order("version", { ascending: false })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    docIds.length
      ? supabaseAdmin.from("tasks").select("id, title, status, is_private, deleted_at, assignee_id, client_id, project_id").in("id", [...new Set((docs ?? []).map((d) => d.task_id as string))])
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const latestOf = new Map<string, Record<string, unknown>>();
  for (const v of versions ?? []) if (!latestOf.has(v.document_id as string)) latestOf.set(v.document_id as string, v);
  const taskOf = new Map((tasks ?? []).map((t) => [t.id as string, t]));

  for (const doc of docs ?? []) {
    // Only a review the team sent and the client has not answered: once they
    // submit changes, the newest version is theirs, not a send.
    const latest = latestOf.get(doc.id as string);
    if (!latest || latest.kind !== "sent") continue;

    const task = taskOf.get(doc.task_id as string);
    if (!task || task.deleted_at || task.is_private || task.status === "done") continue;

    const clientRepliedAt = await lastClientWord(task.id as string, doc.id as string);
    if (clientRepliedAt === undefined) { tally.unsure += 1; continue; }
    const decision = reminderDue({
      sentAt: latest.created_at as string,
      roundAt: (doc.reminder_round_at as string | null) ?? null,
      lastReminderAt: (doc.last_reminder_at as string | null) ?? null,
      remindersSent: Number(doc.reminders_sent ?? 0),
      everyDays: Number(doc.reminder_every_days ?? 0),
      clientRepliedAt,
      now,
    });
    if (!decision.due) continue;

    const link = await linkState(doc.id as string, APP_URL);
    if (!link.live || !link.url) continue;
    // Checked here rather than left to the send queue, which would try three
    // times and then tell the author it failed, every morning. An email address
    // specifically: resolveContact finds a contact with no email just as happily,
    // and a reminder is an email.
    const contact = await resolveContact(task.client_id as string);
    if (!contact?.email) { tally.noContact += 1; continue; }

    let owner = task.assignee_id as string | null;
    if (!owner) {
      const { data: client } = await supabaseAdmin.from("clients").select("assigned_to").eq("id", task.client_id).maybeSingle();
      owner = await resolveNotifyRecipient(client?.assigned_to as string[] | null);
    }
    if (!owner) continue;

    const name = ((doc.title as string | null) ?? "").trim() || (task.title as string);
    const button = { url: link.url, label: `Open "${name}" to review` };
    const body = draftLinkAsButton(
      `<p>Hi,</p><p>Just checking in on "${escapeHtml(name)}". When you have a moment, take a look, send any changes you would like or approve it.</p>${draftLinkHtml(button)}<p>Thanks!</p>`,
      button,
    );
    // Claim the reminder before queueing it: the update only matches while the
    // row still holds what this run read, so a second run at the same time (an
    // admin pressing the route while the cron runs) matches nothing and queues
    // nothing.
    const count = decision.sentThisRound + 1;
    const previous = { reminders_sent: Number(doc.reminders_sent ?? 0), last_reminder_at: (doc.last_reminder_at as string | null) ?? null };
    const claim = supabaseAdmin.from("task_documents").update({ reminders_sent: count, last_reminder_at: now })
      .eq("id", doc.id).eq("reminders_sent", previous.reminders_sent);
    const { data: claimed } = await (previous.last_reminder_at ? claim.eq("last_reminder_at", previous.last_reminder_at) : claim.is("last_reminder_at", null)).select("id");
    if (!claimed?.length) continue;

    const { error: queueError } = await supabaseAdmin.from("scheduled_messages").insert({
      id: REMINDER_MESSAGE_PREFIX + randomUUID(), client_id: task.client_id, task_id: task.id, channel: "email",
      // Read first in the Inbox, "Reminder emails going out" (Derek, 2026-10-07).
      subject: `Checking in: ${name}`, body, scheduled_at: now, status: REVIEW_STATUS, created_by: owner,
    });
    if (queueError) {
      // Nothing was queued, so hand the claim back; tomorrow tries again.
      await supabaseAdmin.from("task_documents").update(previous).eq("id", doc.id).eq("last_reminder_at", now);
      continue;
    }
    tally.sent += 1;

    // The last of a round: say so, and say it went in their name, because they
    // never clicked Send on any of these.
    if (count >= MAX_REMINDERS) {
      await supabaseAdmin.from("notifications").insert({
        id: "n_" + randomUUID(), recipient_id: owner,
        text: `${MAX_REMINDERS} reminders have gone to the client about "${name}", in your name, and it is still not approved. Restart the reminders on the review if you want another round.`,
        task_id: task.id, actor_id: null, client_id: task.client_id, project_id: task.project_id,
        at: now, read: false, kind: "activity",
      });
    }
  }
  return NextResponse.json({ ok: true, ...tally });
}

/** The last time the client said anything about this: a message on the task, or
 *  a comment on the review itself. Either means someone is looking at it.
 *  undefined when it could not be found out, which the caller treats as a reason
 *  not to send: not knowing whether they answered is not the same as knowing
 *  they did not, and the costly mistake here is nagging someone who replied. */
async function lastClientWord(taskId: string, documentId: string): Promise<string | null | undefined> {
  const [messages, comments] = await Promise.all([
    supabaseAdmin.from("messages").select("created_at").eq("task_id", taskId).eq("direction", "inbound")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("task_document_comments").select("created_at").eq("document_id", documentId).is("author_id", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (messages.error || comments.error) return undefined;
  const times = [messages.data?.created_at as string | undefined, comments.data?.created_at as string | undefined]
    .filter((t): t is string => !!t);
  return times.length ? times.sort().at(-1)! : null;
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { sendScheduledMessageNow } from "@/lib/sendMessageServer";

// Fires due scheduled sends (supabase/scheduled-messages.sql). Runs for
// Vercel's cron or an admin session, see cronAuth.ts.
//
// Every 15 minutes (see vercel.json), so "in 1 hour" means about an hour. It
// ran once a day for a while on the belief that the Vercel plan only allowed
// daily schedules; the account is on Pro, which does not, and a message
// scheduled for the afternoon was sitting until the following day.

export const maxDuration = 60;

// A run lasts at most a minute, so a row still at sending an hour after it was
// due was cut off mid send by an earlier run.
const STUCK_AFTER_MS = 60 * 60 * 1000;

// A send that fails goes back in the queue instead of straight to failed: most
// failures here are Gmail or GoHighLevel being briefly unavailable, and the
// author finding out tomorrow that nothing went is worse than trying again.
// Three tries, then it is a real failure and they are told.
const MAX_SEND_ATTEMPTS = 3;

type AuthorRow = { client_id: string; task_id: string | null; channel: string; created_by: string };

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

// A bell for whoever scheduled the message. A failed send used to change its
// status and tell nobody, and the composer only lists pending messages.
async function tellAuthor(row: AuthorRow, what: string): Promise<void> {
  const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", row.client_id).maybeSingle();
  const kind = row.channel === "sms" ? "text" : "email";
  const { error } = await supabaseAdmin.from("notifications").insert({
    id: "n_" + randomUUID(), recipient_id: row.created_by,
    text: `Your scheduled ${kind} to ${client?.name ?? "a client"} ${what}`,
    task_id: row.task_id, actor_id: null, client_id: row.client_id, project_id: null,
    at: new Date().toISOString(), read: false, kind: "activity",
  });
  if (error) console.error("[send-scheduled] failure bell not saved:", error.message);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });

  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rows an earlier run claimed and never finished. Nobody can tell from here
  // whether the message went out, so it is marked failed (it no longer looks
  // queued) and the author is told to check before sending again.
  const { data: stuck } = await supabaseAdmin
    .from("scheduled_messages")
    .update({ status: "failed", error: "Stopped partway through sending. It may or may not have gone out." })
    .eq("status", "sending").lt("scheduled_at", new Date(Date.now() - STUCK_AFTER_MS).toISOString())
    .select("client_id, task_id, channel, created_by");
  for (const row of stuck ?? []) await tellAuthor(row, "stopped partway through sending. Check the client's messages before sending it again.");

  // The attempts column arrives with supabase/2026-09-review.sql. Until that
  // has been run this route still sends, it just does not retry, so the deploy
  // and the migration do not have to land in the same minute.
  const { error: noAttemptsColumn } = await supabaseAdmin.from("scheduled_messages").select("attempts").limit(1);
  const canRetry = !noAttemptsColumn;

  const { data: due, error } = await supabaseAdmin
    .from("scheduled_messages")
    .select("id, client_id, task_id, channel, subject, body, cc, bcc, from_email, attachments, created_by, reply_to_message_id")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  let sent = 0, failed = 0, retried = 0;
  for (const row of due ?? []) {
    // Claim the row before sending. Only one run can move it from pending to
    // sending, so an overlapping manual run, or a message canceled after the
    // read above, is never sent. A run cut off mid send leaves the row at
    // sending rather than pending, so tomorrow's run does not send it again.
    const { data: claimed } = await supabaseAdmin
      .from("scheduled_messages").update({ status: "sending" })
      .eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    const result = await sendScheduledMessageNow({
      id: row.id, clientId: row.client_id, taskId: row.task_id, channel: row.channel,
      subject: row.subject, body: row.body ?? "", cc: row.cc ?? [], bcc: row.bcc ?? [],
      fromEmail: row.from_email, attachments: row.attachments ?? [], createdBy: row.created_by,
      replyToMessageId: row.reply_to_message_id,
    });
    if (result.ok) {
      sent++;
      await supabaseAdmin.from("scheduled_messages").update({ status: "sent", sent_message_id: result.messageId }).eq("id", row.id);
    } else {
      // Read on the failure path only, which is the rare one, so the ordinary
      // run still asks for one fixed set of columns.
      const { data: before } = canRetry
        ? await supabaseAdmin.from("scheduled_messages").select("attempts").eq("id", row.id).maybeSingle()
        : { data: null };
      const attempts = ((before?.attempts as number | undefined) ?? 0) + 1;
      const tryAgain = canRetry && attempts < MAX_SEND_ATTEMPTS;
      await supabaseAdmin.from("scheduled_messages")
        .update({ status: tryAgain ? "pending" : "failed", error: result.error, ...(canRetry ? { attempts } : {}) })
        .eq("id", row.id);
      // Back to pending with a due time already in the past, so the next run
      // picks it up. Only a message that is really not going tells its author.
      if (tryAgain) { retried++; } else { failed++; await tellAuthor(row, `didn't send: ${result.error}`); }
    }
  }
  return NextResponse.json({ ok: true, sent, failed, retried, stuck: stuck?.length ?? 0, checked: (due ?? []).length });
}

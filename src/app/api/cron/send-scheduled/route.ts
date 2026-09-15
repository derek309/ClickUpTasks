import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { sendScheduledMessageNow } from "@/lib/sendMessageServer";

// Fires due scheduled sends (supabase/scheduled-messages.sql). Runs for
// Vercel's cron or an admin session, see cronAuth.ts.
//
// Runs once daily (16:00 UTC, see vercel.json) rather than the originally
// designed every-15-minutes — Vercel's Hobby plan only allows daily cron
// schedules. A message scheduled for e.g. "in 1 hour" may sit until the
// next day's run rather than firing close to its requested time; upgrading
// to Vercel Pro would remove this constraint if tighter timing matters later.

export const maxDuration = 60;

// A run lasts at most a minute, so a row still at sending an hour after it was
// due was cut off mid send by an earlier run.
const STUCK_AFTER_MS = 60 * 60 * 1000;

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

  const { data: due, error } = await supabaseAdmin
    .from("scheduled_messages")
    .select("id, client_id, task_id, channel, subject, body, cc, bcc, from_email, attachments, created_by, reply_to_message_id")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  let sent = 0, failed = 0;
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
      failed++;
      await supabaseAdmin.from("scheduled_messages").update({ status: "failed", error: result.error }).eq("id", row.id);
      await tellAuthor(row, `didn't send: ${result.error}`);
    }
  }
  return NextResponse.json({ ok: true, sent, failed, stuck: stuck?.length ?? 0, checked: (due ?? []).length });
}

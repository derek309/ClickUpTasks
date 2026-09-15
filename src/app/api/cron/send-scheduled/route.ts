import { NextRequest, NextResponse } from "next/server";
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

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });

  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    }
  }
  return NextResponse.json({ ok: true, sent, failed, checked: (due ?? []).length });
}

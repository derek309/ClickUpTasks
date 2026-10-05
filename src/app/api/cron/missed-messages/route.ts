import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";
import { APP_URL } from "@/lib/appUrl";
import { waitingOn, reminderEmail, TOO_OLD_MS, type DmRow } from "@/lib/missedMessages";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The "waiting on you" email for direct messages (Derek, 2026-10-05). Sending
// a message no longer emails anyone: the Inbox shows it. A message left
// unanswered for 2 hours gets one email, from the person who wrote it, with
// the words in it. Every 15 minutes (vercel.json), for Vercel's cron or an
// admin. Needs supabase/dm-reminders.sql.

export const maxDuration = 60;

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!googleConfigured) return NextResponse.json({ ok: true, skipped: "Gmail sending is not configured." });

  const now = Date.now();
  const { data, error } = await supabaseAdmin.from("dm_messages")
    .select("id, conversation_id, author_id, recipient_id, body, created_at, reminded_at")
    .gte("created_at", new Date(now - TOO_OLD_MS).toISOString()).order("created_at", { ascending: true }).limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = waitingOn((data ?? []) as DmRow[], now);
  const ids = [...new Set(due.flatMap((d) => [d.recipientId, d.authorId]))];
  const { data: people } = ids.length
    ? await supabaseAdmin.from("profiles").select("member_id, name, email, email_notify_dm").in("member_id", ids)
    : { data: [] as any[] };
  const byMember = new Map(((people ?? []) as any[]).map((p) => [p.member_id as string, p]));

  let sent = 0, skipped = 0;
  const errors: string[] = [];
  for (const d of due) {
    const to = byMember.get(d.recipientId), from = byMember.get(d.authorId);
    // Marked either way, so a person who turned these off is not looked at again.
    const mark = () => supabaseAdmin.from("dm_messages").update({ reminded_at: new Date().toISOString() }).in("id", d.messages.map((m) => m.id));
    if (!to?.email || !from?.email || to.email_notify_dm === false) { skipped++; await mark(); continue; }
    const { subject, body } = reminderEmail({ authorName: (from.name as string) || "A teammate", messages: d.messages, url: `${APP_URL}/?view=mail` });
    try {
      await sendGmailAs(from.email as string, { to: to.email as string, fromName: (from.name as string) || undefined, subject, body });
      await mark();
      sent++;
    } catch (e) {
      errors.push(`${d.conversationId}: ${e instanceof Error ? e.message : "send failed"}`);
    }
  }
  const out = { ok: true, waiting: due.length, sent, skipped, ...(errors.length ? { errors: errors.slice(0, 5) } : {}) };
  console.log("[cron/missed-messages]", JSON.stringify(out));
  return NextResponse.json(out);
}

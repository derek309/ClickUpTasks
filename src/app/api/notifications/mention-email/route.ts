import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";

// Best-effort email companion to the in-app @mention notification (see
// Cockpit.tsx's addComment): the in-app bell already fired before this is
// called, so any failure here (missing config, no Workspace address, send
// error) degrades silently — the caller doesn't surface it to the user.
// Sent AS the mentioner (their own @clickuplocal.com address) via the same
// domain-wide-delegation path ../google/send uses for client email.

const SEND_DOMAIN = "clickuplocal.com";
const APP_URL = "https://clickuptasks.vercel.app";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace sending is not configured." }, { status: 501 });
  if (!caller.email.toLowerCase().endsWith(`@${SEND_DOMAIN}`))
    return NextResponse.json({ error: "Your account isn't a Google Workspace sender." }, { status: 501 });

  const b = await req.json().catch(() => ({}));
  const { recipientMemberId, taskId, taskTitle, commentBody } = b as {
    recipientMemberId?: string; taskId?: string; taskTitle?: string; commentBody?: string;
  };
  if (!recipientMemberId || !taskId || !commentBody?.trim())
    return NextResponse.json({ error: "Missing recipientMemberId, taskId, or commentBody." }, { status: 400 });

  const [{ data: recipient }, { data: sender }] = await Promise.all([
    supabaseAdmin.from("profiles").select("email, name, email_notify_message").eq("member_id", recipientMemberId).maybeSingle(),
    supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle(),
  ]);
  if (!recipient?.email) return NextResponse.json({ error: "Recipient has no email on file." }, { status: 404 });
  if (recipient.email.toLowerCase() === caller.email.toLowerCase())
    return NextResponse.json({ ok: true, skipped: "self-mention" });
  if (recipient.email_notify_message === false) return NextResponse.json({ ok: true, skipped: "opted-out" });

  const senderName = (sender?.name as string | null)?.trim() || undefined;
  const title = (taskTitle || "a task").trim();
  const link = `${APP_URL}/?task=${encodeURIComponent(taskId)}`;
  const quoted = commentBody.trim().slice(0, 1000);

  // HTML, with the message itself and a real reply button (Derek: "I want it
  // to email him the message and a button to reply and take him to the task
  // to respond"). Table-based with inline styles and no flexbox, because
  // Outlook and the Gmail app strip or ignore modern layout CSS. The button
  // is a padded anchor rather than a <button>, which mail clients drop.
  // The footer steers people away from replying by mail (Derek: "I would
  // rather it say do NOT reply directly, click Reply in ClickUpTasks"). A
  // direct reply currently just lands in the mentioner's inbox and never
  // reaches the task, so an answer typed there is invisible to everyone else.
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const who = esc(senderName ?? "Someone");
  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1f1f1f;max-width:560px">
  <p style="margin:0 0 4px"><strong>${who}</strong> mentioned you on</p>
  <p style="margin:0 0 16px;font-size:18px;font-weight:600">${esc(title)}</p>
  <blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid #1b3a5c;background:#f4f7fb;white-space:pre-wrap">${esc(quoted)}</blockquote>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="border-radius:6px;background:#1b3a5c">
    <a href="${link}" style="display:inline-block;padding:12px 22px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none">Reply in ClickUpTasks</a>
  </td></tr></table>
  <p style="margin:0;font-size:14px;color:#5f6368">Please do not reply to this email. Use the button above so your answer lands on the task where the whole team can see it.</p>
</div>`.trim();

  try {
    const { id } = await sendGmailAs(caller.email, {
      to: recipient.email,
      subject: `${senderName ?? "Someone"} mentioned you in "${title}"`.slice(0, 200),
      fromName: senderName,
      isHtml: true,
      body: html,
    });
    return NextResponse.json({ ok: true, gmailMessageId: id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail send failed." }, { status: 502 });
  }
}

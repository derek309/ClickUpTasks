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
    supabaseAdmin.from("profiles").select("email, name").eq("member_id", recipientMemberId).maybeSingle(),
    supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle(),
  ]);
  if (!recipient?.email) return NextResponse.json({ error: "Recipient has no email on file." }, { status: 404 });
  if (recipient.email.toLowerCase() === caller.email.toLowerCase())
    return NextResponse.json({ ok: true, skipped: "self-mention" });

  const senderName = (sender?.name as string | null)?.trim() || undefined;
  const title = (taskTitle || "a task").trim();
  const link = `${APP_URL}/?task=${encodeURIComponent(taskId)}`;
  const quoted = commentBody.trim().slice(0, 1000);

  try {
    const { id } = await sendGmailAs(caller.email, {
      to: recipient.email,
      subject: `${senderName ?? "Someone"} mentioned you in "${title}"`.slice(0, 200),
      fromName: senderName,
      body: `${senderName ?? "Someone"} mentioned you in a comment on "${title}":\n\n"${quoted}"\n\nView the task: ${link}`,
    });
    return NextResponse.json({ ok: true, gmailMessageId: id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail send failed." }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";

// Generic best-effort email companion to ANY in-app notification (see
// Cockpit.tsx's notify()) — the in-app bell already fired before this is
// called, so any failure here (missing config, no Workspace address, send
// error) degrades silently, same as mention-email. Sent AS the actor (their
// own @clickuplocal.com address) via the same domain-wide-delegation path.
// Not used for task-comment mentions — those keep the richer, quoted-comment
// email from mention-email/route.ts.

const SEND_DOMAIN = "clickuplocal.com";
const APP_URL = "https://clickuptasks.vercel.app";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace sending is not configured." }, { status: 501 });
  if (!caller.email.toLowerCase().endsWith(`@${SEND_DOMAIN}`))
    return NextResponse.json({ error: "Your account isn't a Google Workspace sender." }, { status: 501 });

  const b = await req.json().catch(() => ({}));
  const { recipientMemberId, subject, link } = b as { recipientMemberId?: string; subject?: string; link?: string };
  if (!recipientMemberId || !subject?.trim())
    return NextResponse.json({ error: "Missing recipientMemberId or subject." }, { status: 400 });

  const { data: recipient } = await supabaseAdmin.from("profiles").select("email").eq("member_id", recipientMemberId).maybeSingle();
  if (!recipient?.email) return NextResponse.json({ error: "Recipient has no email on file." }, { status: 404 });
  if (recipient.email.toLowerCase() === caller.email.toLowerCase())
    return NextResponse.json({ ok: true, skipped: "self-notify" });

  const url = link ? `${APP_URL}/${link}` : APP_URL;

  try {
    const { id } = await sendGmailAs(caller.email, {
      to: recipient.email,
      subject: subject.trim().slice(0, 200),
      body: `${subject.trim()}\n\nView in ClickUpTasks: ${url}`,
    });
    return NextResponse.json({ ok: true, gmailMessageId: id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail send failed." }, { status: 502 });
  }
}

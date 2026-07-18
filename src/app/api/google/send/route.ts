import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Send a client email through Google Workspace (Gmail API) AS the teammate who
// clicked send — the reliable per-person "from" path, since GHL's Conversations
// API ignores per-user senders. Same permission model as ../ghl/message: the
// caller can only ever impersonate their OWN @clickuplocal.com address, gated by
// requireUser + the per-client can_message roster. Returns 501 when Google isn't
// configured so the client falls back to the GHL sender instead of failing.

const SEND_DOMAIN = "clickuplocal.com";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace sending is not configured." }, { status: 501 });

  const b = await req.json().catch(() => ({} as any));
  const { clientId, toEmail, subject, body, cc, bcc } = b as {
    clientId?: string;
    toEmail?: string;
    subject?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
  };

  if (!clientId || !toEmail?.trim() || !body?.trim())
    return NextResponse.json({ error: "Missing clientId, toEmail, or body." }, { status: 400 });

  // The caller can only send as themselves, and only if they're a Workspace user
  // on the sending domain — the security boundary on domain-wide delegation (the
  // service account CAN impersonate anyone, so we never let the recipient/body
  // choose the sender). A non-domain account (or missing email) 501s → GHL fallback.
  if (!caller.email || !caller.email.toLowerCase().endsWith(`@${SEND_DOMAIN}`))
    return NextResponse.json({ error: "Your account isn't a Google Workspace sender." }, { status: 501 });

  // Same two-layer gate as ../ghl/message: global can_send_messages AND this
  // client's can_message roster. Admins pass implicitly.
  if (caller.role !== "admin") {
    if (!caller.canSendMessages) return NextResponse.json({ error: "You don't have permission to send messages. Ask an admin to enable it for you." }, { status: 403 });
    const { data: clientRow } = await supabaseAdmin.from("clients").select("can_message").eq("id", clientId).maybeSingle();
    const allowed = ((clientRow?.can_message as string[] | null) ?? []).includes(caller.memberId ?? "");
    if (!allowed) return NextResponse.json({ error: "You don't have permission to message this client. Ask an admin to enable it for you." }, { status: 403 });
  }

  const ccList = cc?.filter((e) => e?.trim());
  const bccList = bcc?.filter((e) => e?.trim());

  // Display name for the From header ("Derek Fox <derek@…>").
  const { data: prof } = await supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle();
  const fromName = (prof?.name as string | null)?.trim() || undefined;

  try {
    const { id, threadId } = await sendGmailAs(caller.email, {
      to: toEmail.trim(),
      cc: ccList?.length ? ccList : undefined,
      bcc: bccList?.length ? bccList : undefined,
      subject: (subject || "").slice(0, 200),
      body,
      fromName,
    });
    return NextResponse.json({ ok: true, gmailMessageId: id, gmailThreadId: threadId, from: caller.email });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail send failed." }, { status: 502 });
  }
}

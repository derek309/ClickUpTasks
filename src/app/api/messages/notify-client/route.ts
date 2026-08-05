import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";
import { PERSONAL_CLIENT_ID } from "@/lib/data";

const APP_URL = "https://clickuptasks.vercel.app";
const SEND_DOMAIN = "clickuplocal.com";
// One notification per client per window, no matter how many of their tasks
// got a reply in that time — see supabase/client-chat-notify-cooldown.sql
// for why this has to be per-client rather than per-task.
const COOLDOWN_MS = 20 * 60 * 1000;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Best-effort "you have a new message" nudge for a chat-channel reply — the
// reply itself is just a `messages` row (see Cockpit.tsx's sendMessage,
// channel: "chat" branch), nothing the client sees outside the app unless
// told to look. Unlike the internal self-notify emails elsewhere in this
// app, this recipient is a real external client and this sender is a real
// team member's own address — a reply to THIS email is a normal, working
// reply, not a dead end, so no "do not reply" warning belongs here.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!googleConfigured) return NextResponse.json({ ok: true, skipped: "not-configured" });

  const b = await req.json().catch(() => null) as { clientId?: string; taskId?: string } | null;
  const { clientId, taskId } = b ?? {};
  if (!clientId || !taskId) return NextResponse.json({ error: "Missing clientId or taskId." }, { status: 400 });
  // Never mint a share token for the "personal" pseudo-client — every
  // teammate's private tasks carry that client_id, and the waiting page
  // selects by client_id, so one token would publish all of them. Refused
  // here as well as in the UI (Cockpit's getClientShareUrl) because this
  // route mints with the service role regardless of the caller's rights.
  if (clientId === PERSONAL_CLIENT_ID) return NextResponse.json({ error: "Personal tasks can't be shared." }, { status: 403 });

  if (caller.role !== "admin") {
    if (!caller.canSendMessages) return NextResponse.json({ error: "You don't have permission to send messages." }, { status: 403 });
    const { data: clientRow } = await supabaseAdmin.from("clients").select("can_message").eq("id", clientId).maybeSingle();
    const allowed = ((clientRow?.can_message as string[] | null) ?? []).includes(caller.memberId ?? "");
    if (!allowed) return NextResponse.json({ error: "You don't have permission to message this client." }, { status: 403 });
  }

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, share_token, last_chat_notified_at, linked_contact_id").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lastAt = client.last_chat_notified_at ? new Date(client.last_chat_notified_at as string).getTime() : 0;
  if (Date.now() - lastAt < COOLDOWN_MS) return NextResponse.json({ ok: true, skipped: "cooldown" });

  const contactId = (client.linked_contact_id as string | null) || (clientId.startsWith("cl_") ? clientId.slice(3) : null);
  const { data: contact } = contactId ? await supabaseAdmin.from("contacts").select("email").eq("id", contactId).maybeSingle() : { data: null };
  const clientEmail = (contact?.email as string | null)?.trim();
  if (!clientEmail) return NextResponse.json({ ok: true, skipped: "no-email" });

  // Mint a share token if this client has never had one — same lazy
  // creation Cockpit.tsx's copyClientShareLink does, just server-side (this
  // route always has permission to write it, regardless of the caller's
  // own admin status, since it's the one persisting it).
  const token = (client.share_token as string | null) ?? randomUUID().replace(/-/g, "");
  if (!client.share_token) await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", clientId);

  // No ?task= — multiple of the client's tasks may have new activity by the
  // time this cooldown allows a send, so this points at their whole list
  // rather than just the one that happened to trigger it.
  const link = `${APP_URL}/waiting/${token}`;
  const { data: callerProfile } = await supabaseAdmin.from("profiles").select("name").eq("member_id", caller.memberId ?? "").maybeSingle();
  const senderName = ((callerProfile?.name as string | null) ?? "").trim();
  const html = [
    `<p style="margin:0">${escapeHtml(senderName || "The team")} sent you a new message on ${escapeHtml(client.name as string)}'s account.</p>`,
    `<p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#1b3a5c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">View and reply</a></p>`,
  ].join("");

  try {
    if (caller.email.toLowerCase().endsWith(`@${SEND_DOMAIN}`)) {
      await sendGmailAs(caller.email, {
        to: clientEmail,
        subject: `New message on your ${(client.name as string).trim()} account`.slice(0, 200),
        body: html, isHtml: true, fromName: senderName || undefined,
      });
      await supabaseAdmin.from("clients").update({ last_chat_notified_at: new Date().toISOString() }).eq("id", clientId);
    }
  } catch { /* the chat message itself already sent; this nudge is best-effort */ }

  return NextResponse.json({ ok: true, taskId });
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { contactHome } from "@/lib/ghlPerson";
import { isRealGhlId } from "@/lib/ghlMatch";
import { looksLikeHtml, plainTextToHtml, htmlToText } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Add an email GoHighLevel has no copy of to the contact's conversation there
// (Derek, 2026-10-07: Justin answered Russell from Gmail before Russell was a
// contact, so the GoHighLevel BCC never ran and nothing logged it).
//
// Only GoHighLevel's "add an inbound message" endpoint, which records a message
// and never sends one (it takes direction for an outbound email too). The
// usual /conversations/messages would email the person again.
// GoHighLevel's docs list conversationProviderId as required; it is sent when
// GHL_CONVERSATION_PROVIDER_ID is set, and GoHighLevel's own error comes back
// to the screen when it refuses.
const API = "https://services.leadconnectorhq.com";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { messageId } = (await req.json().catch(() => ({}))) as { messageId?: string };
  if (!messageId) return NextResponse.json({ error: "Which email?" }, { status: 400 });

  const { data: m } = await supabaseAdmin.from("messages")
    .select("id, channel, direction, subject, body, cc, created_at, contact_id, created_by, mailbox_member_id, peer_address, ghl_message_id, rfc822_message_id, gmail_message_id")
    .eq("id", messageId).maybeSingle();
  if (!m) return NextResponse.json({ error: "That email is gone." }, { status: 404 });
  const mine = !!caller.memberId && (m.created_by === caller.memberId || m.mailbox_member_id === caller.memberId);
  if (caller.role !== "admin" && !mine) return NextResponse.json({ error: "That email isn't yours." }, { status: 403 });
  if (m.channel !== "email") return NextResponse.json({ error: "Only emails can be added this way." }, { status: 400 });
  if (isRealGhlId(m.ghl_message_id)) return NextResponse.json({ ok: true, already: true });

  const { data: contact } = m.contact_id ? await supabaseAdmin.from("contacts").select("name, email, ghl_contact_id").eq("id", m.contact_id).maybeSingle() : { data: null };
  if (!contact?.ghl_contact_id) return NextResponse.json({ error: "Save them as a contact first, then add this." }, { status: 400 });
  const home = await contactHome(contact.ghl_contact_id as string);
  if (!home) return NextResponse.json({ error: "GoHighLevel couldn't find their contact." }, { status: 502 });
  const headers = { Authorization: `Bearer ${home.token}`, Version: "2021-04-15", Accept: "application/json", "Content-Type": "application/json" };

  // Their conversation in GoHighLevel, made if they have none yet.
  let conversationId: string | null = null;
  const found = await fetch(`${API}/conversations/search?locationId=${encodeURIComponent(home.locationId)}&contactId=${encodeURIComponent(contact.ghl_contact_id as string)}&limit=1`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (found?.ok) conversationId = ((await found.json().catch(() => null))?.conversations?.[0]?.id as string | undefined) ?? null;
  if (!conversationId) {
    const made = await fetch(`${API}/conversations/`, { method: "POST", headers, body: JSON.stringify({ locationId: home.locationId, contactId: contact.ghl_contact_id }), signal: AbortSignal.timeout(10000) }).catch(() => null);
    const j: any = made ? await made.json().catch(() => null) : null;
    conversationId = j?.conversation?.id ?? j?.id ?? null;
    if (!conversationId) return NextResponse.json({ error: `GoHighLevel didn't open a conversation for them (${made?.status ?? "no answer"}).` }, { status: 502 });
  }

  // Who it was from: the teammate whose mailbox it is, for one we sent.
  const memberId = (m.created_by as string | null) ?? (m.mailbox_member_id as string | null);
  const { data: prof } = memberId ? await supabaseAdmin.from("profiles").select("email").eq("member_id", memberId).maybeSingle() : { data: null };
  const outbound = m.direction === "outbound";
  const body = (m.body as string | null) ?? "";
  const html = looksLikeHtml(body) ? body : plainTextToHtml(body);
  const provider = process.env.GHL_CONVERSATION_PROVIDER_ID;
  const res = await fetch(`${API}/conversations/messages/inbound`, {
    method: "POST", headers, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      type: "Email", conversationId, contactId: contact.ghl_contact_id,
      ...(provider ? { conversationProviderId: provider } : {}),
      direction: outbound ? "outbound" : "inbound", date: m.created_at,
      subject: m.subject ?? undefined, html, message: looksLikeHtml(body) ? htmlToText(body) : body,
      ...(outbound ? { emailTo: m.peer_address ?? contact.email ?? undefined, ...(prof?.email ? { emailFrom: prof.email } : {}) } : { emailFrom: m.peer_address ?? contact.email ?? undefined }),
      ...(Array.isArray(m.cc) && m.cc.length ? { emailCc: m.cc } : {}),
      altId: (m.rfc822_message_id as string | null) ?? (m.gmail_message_id as string | null) ?? m.id,
    }),
  }).catch(() => null);
  const text = res ? await res.text().catch(() => "") : "";
  if (!res?.ok) return NextResponse.json({ error: `GoHighLevel didn't take it (${res?.status ?? "no answer"}). ${text.slice(0, 240)}` }, { status: 502 });
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  const ghlMessageId: string | null = j?.messageId ?? j?.message?.id ?? j?.id ?? null;
  if (!ghlMessageId) return NextResponse.json({ error: `GoHighLevel answered without a message id. ${text.slice(0, 240)}` }, { status: 502 });
  await supabaseAdmin.from("messages").update({ ghl_message_id: ghlMessageId, ghl_conversation_id: conversationId }).eq("id", m.id);
  return NextResponse.json({ ok: true, ghlMessageId });
}

// Server-only: the fields that make a GoHighLevel email send a reply in the thread
// it answers (Derek, 2026-09-12). Gmail sends thread through In-Reply-To headers
// (googleMail.ts readReplyHeaders); GHL builds the email itself, so it takes ids
// instead: replyMessageId (the conversation message being answered), and, where
// they can be found, emailMessageId and threadId from that email.
//
// Emails that came in through the GHL webhook carry no real GHL id (ours is a
// synthetic dedup key), so the message is looked up in the contact's GHL
// conversation: the one with the stored id, else the latest email at or before the
// one being answered. Any failure returns null and the email goes out as a new one.
// Not yet confirmed against a live send; callers retry without these fields if GHL
// refuses them.
import { supabaseAdmin } from "./supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

const GHL = "https://services.leadconnectorhq.com";

export async function ghlReplyFields(opts: {
  token: string; clientId: string; ghlContactId: string | null; locationId: string; replyToMessageId?: string | null;
}): Promise<Record<string, string> | null> {
  if (!opts.replyToMessageId || !opts.ghlContactId) return null;
  try {
    const { data: row } = await supabaseAdmin.from("messages")
      .select("client_id, channel, ghl_message_id, ghl_conversation_id, created_at").eq("id", opts.replyToMessageId).maybeSingle();
    if (!row || row.client_id !== opts.clientId || row.channel !== "email") return null;
    const headers = { Authorization: `Bearer ${opts.token}`, Version: "2021-04-15", Accept: "application/json" };

    let conversationId = (row.ghl_conversation_id as string | null) ?? null;
    if (!conversationId) {
      const res = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(opts.locationId)}&contactId=${encodeURIComponent(opts.ghlContactId)}&limit=1`, { headers });
      conversationId = res.ok ? ((await res.json())?.conversations?.[0]?.id ?? null) : null;
    }
    if (!conversationId) return null;

    const res = await fetch(`${GHL}/conversations/${encodeURIComponent(conversationId)}/messages?limit=20&type=TYPE_EMAIL`, { headers });
    if (!res.ok) return null;
    const j = await res.json();
    // GHL nests the page ({ messages: { messages: [...] } }); tolerate a flat list too.
    const container = j?.messages;
    const list: any[] = Array.isArray(container) ? container : (Array.isArray(container?.messages) ? container.messages : []);
    const emails = list.filter((m) => m?.id && m.messageType === "TYPE_EMAIL")
      .sort((a, b) => new Date(b.dateAdded ?? 0).getTime() - new Date(a.dateAdded ?? 0).getTime());
    const storedId = typeof row.ghl_message_id === "string" && !row.ghl_message_id.startsWith("synthetic:") ? row.ghl_message_id : null;
    const answeredAt = new Date(row.created_at as string).getTime() + 2 * 60_000;
    const target = emails.find((m) => m.id === storedId)
      ?? emails.find((m) => new Date(m.dateAdded ?? 0).getTime() <= answeredAt)
      ?? emails[0];
    if (!target) return null;

    // A conversation message can group several emails; the newest is the one answered.
    const ids: unknown[] = Array.isArray(target.meta?.email?.messageIds) ? target.meta.email.messageIds : [];
    const emailMessageId = [...ids].reverse().find((x): x is string => typeof x === "string" && !!x);
    let threadId: string | undefined;
    if (emailMessageId) {
      const er = await fetch(`${GHL}/conversations/messages/email/${encodeURIComponent(emailMessageId)}`, { headers });
      const em = er.ok ? (await er.json())?.emailMessage : null;
      if (typeof em?.threadId === "string" && em.threadId) threadId = em.threadId;
    }
    return {
      replyMessageId: String(target.id), emailReplyMode: "reply",
      ...(emailMessageId ? { emailMessageId } : {}),
      ...(threadId ? { threadId } : {}),
    };
  } catch {
    return null;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Backfills any GoHighLevel messages for a contact that our webhook never
// captured (webhook downtime, a message sent directly in GHL's own UI
// before the automation was wired up, etc.) — `messages` is realtime-
// subscribed, so any genuinely new row this inserts shows up in an open
// Journal automatically, no client-side merge needed here.
//
// Gated by requireUser (not admin) — reading/backfilling is lower-stakes
// than sending, matching the existing "any signed-in user" trust level on
// messages (see supabase/messages.sql's RLS comment).
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId, contactId, locationId, ghlContactId } = await req.json().catch(() => ({} as any));
  if (!clientId || !contactId || !locationId || !ghlContactId)
    return NextResponse.json({ error: "Missing clientId, contactId, locationId, or ghlContactId." }, { status: 400 });

  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" };

  const searchRes = await fetch(`https://services.leadconnectorhq.com/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(ghlContactId)}&limit=10`, { headers });
  if (!searchRes.ok) { const text = await searchRes.text().catch(() => ""); return NextResponse.json({ error: `GoHighLevel API ${searchRes.status}: ${text.slice(0, 240)}` }, { status: 502 }); }
  const conversations: any[] = (await searchRes.json())?.conversations ?? [];
  if (!conversations.length) return NextResponse.json({ inserted: 0 });

  // Skip messages we already have (webhook-captured rows use a different id
  // scheme than the deterministic one below, so this dedups by ghl_message_id
  // rather than relying on an upsert's ON CONFLICT target).
  const { data: existingRows } = await supabaseAdmin.from("messages").select("ghl_message_id").eq("contact_id", contactId).not("ghl_message_id", "is", null);
  const known = new Set((existingRows ?? []).map((r) => r.ghl_message_id as string));

  let inserted = 0;
  for (const conv of conversations) {
    let lastMessageId: string | undefined;
    for (let page = 0; page < 5; page++) { // ~100 messages per conversation, plenty for a manual refresh
      const q = new URLSearchParams({ limit: "20" });
      if (lastMessageId) q.set("lastMessageId", lastMessageId);
      const msgRes = await fetch(`https://services.leadconnectorhq.com/conversations/${encodeURIComponent(conv.id)}/messages?${q}`, { headers });
      if (!msgRes.ok) break;
      const msgJson = await msgRes.json();
      const messages: any[] = msgJson?.messages ?? [];

      const rows = messages
        .filter((m) => m?.id && !known.has(m.id))
        .map((m) => {
          const channel = m.messageType === "SMS" ? "sms" : m.messageType === "Email" ? "email" : null;
          if (!channel || !m.dateAdded) return null;
          return {
            id: "msg_ghl_" + m.id,
            contact_id: contactId,
            client_id: clientId,
            channel,
            direction: m.direction === "inbound" ? "inbound" : "outbound",
            // GHL's GET messages response wasn't confirmed to include a
            // subject field for email-type messages — falls back to null
            // (same as any message with no subject) rather than guessing.
            subject: m.subject ?? null,
            body: m.body ?? "",
            ghl_message_id: m.id,
            created_by: null,
            created_at: m.dateAdded,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      rows.forEach((r) => known.add(r.ghl_message_id));
      if (rows.length) {
        const { error } = await supabaseAdmin.from("messages").insert(rows);
        if (!error) inserted += rows.length;
      }
      if (!msgJson?.nextPage || !msgJson?.lastMessageId) break;
      lastMessageId = msgJson.lastMessageId;
    }
  }
  return NextResponse.json({ inserted });
}

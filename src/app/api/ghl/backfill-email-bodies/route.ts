import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY one-shot backfill — delete after it has run.
// Repairs email rows synced before refresh-messages learned to follow GHL's
// per-email endpoint. GHL omits `body` on a large share of TYPE_EMAIL
// messages in the conversations list; the content sits behind
// /conversations/messages/email/{meta.email.messageIds[0]} under
// `emailMessage.body` (verified live before this was written).
//
// dryRun=1 (the default) reports what it WOULD change without writing, so
// the shape of the repair can be checked before anything is committed.

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!process.env.PROBE_SECRET || req.nextUrl.searchParams.get("secret") !== process.env.PROBE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dryRun") !== "0";
  const limitContacts = Number(req.nextUrl.searchParams.get("contacts") ?? "50");

  // Blank email rows, grouped by the contact they belong to, with the GHL
  // ids needed to go find them again.
  const { data: blanks } = await supabaseAdmin
    .from("messages")
    .select("id, contact_id, ghl_message_id")
    .eq("channel", "email").eq("body", "").not("ghl_message_id", "is", null);
  if (!blanks?.length) return NextResponse.json({ ok: true, note: "nothing blank to repair" });

  const byContact = new Map<string, { id: string; ghl_message_id: string }[]>();
  for (const b of blanks) {
    const list = byContact.get(b.contact_id as string) ?? [];
    list.push({ id: b.id as string, ghl_message_id: b.ghl_message_id as string });
    byContact.set(b.contact_id as string, list);
  }

  const contactIds = Array.from(byContact.keys()).slice(0, limitContacts);
  const { data: contacts } = await supabaseAdmin.from("contacts").select("id, client_id, ghl_contact_id").in("id", contactIds);
  const clientIds = Array.from(new Set((contacts ?? []).map((c: any) => c.client_id)));
  const { data: clients } = await supabaseAdmin.from("clients").select("id, ghl_location_id").in("id", clientIds);
  const locationOf = new Map((clients ?? []).map((c: any) => [c.id, c.ghl_location_id as string]));

  let repaired = 0, stillBlank = 0, skipped = 0;
  const samples: any[] = [];

  for (const c of contacts ?? []) {
    const rows = byContact.get(c.id as string) ?? [];
    const locationId = locationOf.get(c.client_id as string) ?? "";
    const ghlContactId = c.ghl_contact_id as string | null;
    if (!locationId || !ghlContactId) { skipped += rows.length; continue; }
    const token = await tokenForLocation(locationId);
    if (!token) { skipped += rows.length; continue; }
    const headers = { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" };

    // Walk this contact's conversations to recover each message's
    // meta.email.messageIds — we never stored it, so it has to be re-fetched.
    const emailIdByMsgId = new Map<string, string>();
    try {
      const convRes = await fetch(`https://services.leadconnectorhq.com/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(ghlContactId)}&limit=10`, { headers });
      if (!convRes.ok) { skipped += rows.length; continue; }
      const convs = (await convRes.json())?.conversations ?? [];
      for (const conv of convs) {
        let lastMessageId: string | undefined;
        for (let page = 0; page < 10; page++) {
          const q = new URLSearchParams({ limit: "20" });
          if (lastMessageId) q.set("lastMessageId", lastMessageId);
          const mr = await fetch(`https://services.leadconnectorhq.com/conversations/${encodeURIComponent(conv.id)}/messages?${q}`, { headers });
          if (!mr.ok) break;
          const container = (await mr.json())?.messages;
          const msgs: any[] = Array.isArray(container) ? container : (container?.messages ?? []);
          for (const m of msgs) {
            const eid = m?.meta?.email?.messageIds?.[0];
            if (m?.id && typeof eid === "string") emailIdByMsgId.set(m.id, eid);
          }
          const nextPage = Array.isArray(container) ? false : container?.nextPage;
          const pageLastId = Array.isArray(container) ? null : container?.lastMessageId;
          if (!nextPage || !pageLastId) break;
          lastMessageId = pageLastId;
        }
      }
    } catch { skipped += rows.length; continue; }

    for (const row of rows) {
      const emailId = emailIdByMsgId.get(row.ghl_message_id);
      if (!emailId) { stillBlank++; continue; }
      try {
        const er = await fetch(`https://services.leadconnectorhq.com/conversations/messages/email/${encodeURIComponent(emailId)}`, { headers });
        if (!er.ok) { stillBlank++; continue; }
        const em = (await er.json())?.emailMessage;
        const body = typeof em?.body === "string" ? em.body : "";
        if (!body) { stillBlank++; continue; }
        if (samples.length < 3) samples.push({ messageId: row.ghl_message_id, bodyLen: body.length, subject: em?.subject ?? null });
        if (!dryRun) {
          const patch: any = { body };
          if (typeof em?.subject === "string" && em.subject) patch.subject = em.subject;
          await supabaseAdmin.from("messages").update(patch).eq("id", row.id);
        }
        repaired++;
      } catch { stillBlank++; }
    }
  }

  return NextResponse.json({ ok: true, dryRun, contactsProcessed: (contacts ?? []).length, repaired, stillBlank, skipped, samples });
}

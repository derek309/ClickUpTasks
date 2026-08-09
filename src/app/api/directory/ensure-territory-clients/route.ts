import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Ensures every WP directory listing in a city has a real tracked client to
// click into — "The territory should all work the same as Follow up...
// when you click on it, it's going to go into the page" (Derek, 2026-08-09,
// confirmed: promote every listing, even a genuinely cold "Really unclaimed"
// one with zero engagement, not just matched/engaged ones — so the whole
// page is uniformly click-through, not a mix of real rows and dead ones).
//
// Reuses the same ghlContactId → phone → email → name match chain this page
// already uses client-side (see TerritoryDirectory.tsx's own comment on why
// the chain exists). A listing with no match at all gets a brand-new
// synthetic contact created straight from its own WP data — no other route
// in this app does that (every existing promotion path assumes a contacts
// row already exists), which is the one real gap this closes.
//
// Doesn't bother re-pointing an already-tracked contact's own client_id back
// to "cl_<id>" — this page's own row matching (and Follow Up's) already
// derives the client purely from "cl_" + contact.id, never from the cached
// client_id field, so that would be a write with no reader.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const city = String(body?.city ?? "").trim();
  const state = String(body?.state ?? "").trim();
  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });

  const listingsResult = await fetchDirectoryListingsServer(city, state);
  if ("error" in listingsResult) return NextResponse.json({ ok: true, skipped: listingsResult.error });

  const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

  const { data: contactRows } = await supabaseAdmin.from("contacts").select("id, name, ghl_contact_id, phone, email");
  const existingContactIds = new Set((contactRows ?? []).map((c: any) => c.id as string));
  const byGhlId = new Map<string, any>(), byPhone = new Map<string, any>(), byEmail = new Map<string, any>(), byName = new Map<string, any>();
  for (const c of contactRows ?? []) {
    if (c.ghl_contact_id) byGhlId.set(c.ghl_contact_id, c);
    const p = digits(c.phone); if (p) byPhone.set(p, c);
    const e = lc(c.email); if (e) byEmail.set(e, c);
    const n = lc(c.name); if (n && !byName.has(n)) byName.set(n, c);
  }

  const newContacts: any[] = [];
  const resolvedContactIds: string[] = [];
  for (const l of listingsResult.listings) {
    const rawId = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    if (!Number.isFinite(rawId)) continue;
    // ghlContactId-keyed when we have one (matches the convention every
    // other promotion path in this app already uses); a synthetic
    // gdPlaceId-keyed id otherwise, for a listing WP has never sent an
    // invite through GHL for yet.
    const candidateId = l.ghlContactId ? `ct_ghl_${l.ghlContactId}` : `ct_gd_${rawId}`;
    // Checked FIRST, before any fuzzy match — this listing's own id is
    // stable across calls even when the live WP fetch's phone/email
    // formatting isn't (an external API has no byte-stability guarantee
    // the way this deterministic id does), so a listing this route already
    // promoted is always recognized as done, instead of recomputing "new"
    // every re-run and redoing the same bulk upsert work for nothing.
    if (existingContactIds.has(candidateId)) { resolvedContactIds.push(candidateId); continue; }
    const existing = (l.ghlContactId && byGhlId.get(l.ghlContactId)) || byPhone.get(digits(l.phone)) || byEmail.get(lc(l.email)) || byName.get(lc(l.name)) || null;
    if (existing) { resolvedContactIds.push(existing.id); continue; }
    newContacts.push({
      id: candidateId, client_id: "c_directory", name: l.name,
      email: l.email || null, phone: l.phone || null, ghl_contact_id: l.ghlContactId || null,
      city, state,
    });
    resolvedContactIds.push(candidateId);
  }

  if (newContacts.length) {
    const { error } = await supabaseAdmin.from("contacts").upsert(newContacts, { onConflict: "id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: clientRows } = await supabaseAdmin.from("clients").select("id");
  const existingClientIds = new Set((clientRows ?? []).map((c: any) => c.id as string));
  const byId = new Map<string, string>(); // contactId -> name, for the new client's own name
  for (const c of newContacts) byId.set(c.id, c.name);
  for (const c of contactRows ?? []) if (!byId.has(c.id)) byId.set(c.id, c.name);

  const uniqueContactIds = [...new Set(resolvedContactIds)];
  const newClients = uniqueContactIds
    .filter((id) => !existingClientIds.has("cl_" + id))
    .map((id) => ({ id: "cl_" + id, name: byId.get(id) ?? "Unnamed business", color: "#a855f7", ghl_location_id: "", status: "claimed", type: "prospect", assigned_to: [] }));
  if (newClients.length) {
    const { error } = await supabaseAdmin.from("clients").upsert(newClients, { onConflict: "id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, contactsCreated: newContacts.length, clientsCreated: newClients.length });
}

import { NextRequest, NextResponse } from "next/server";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY — verifies ensure-territory-clients' own logic runs cleanly
// end-to-end against real Lincoln data (bypassing requireUser, since no
// browser session is available here). Deleted after this runs.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city") || "Lincoln";
  const state = searchParams.get("state") || "CA";

  const listingsResult = await fetchDirectoryListingsServer(city, state);
  if ("error" in listingsResult) return NextResponse.json({ ok: true, skipped: listingsResult.error });

  const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

  const { data: contactRows } = await supabaseAdmin.from("contacts").select("id, name, ghl_contact_id, phone, email");
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
    const existing = (l.ghlContactId && byGhlId.get(l.ghlContactId)) || byPhone.get(digits(l.phone)) || byEmail.get(lc(l.email)) || byName.get(lc(l.name)) || null;
    if (existing) { resolvedContactIds.push(existing.id); continue; }
    const rawId = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    if (!Number.isFinite(rawId)) continue;
    const id = l.ghlContactId ? `ct_ghl_${l.ghlContactId}` : `ct_gd_${rawId}`;
    newContacts.push({ id, client_id: "c_directory", name: l.name, email: l.email || null, phone: l.phone || null, ghl_contact_id: l.ghlContactId || null, city, state });
    resolvedContactIds.push(id);
  }

  if (newContacts.length) {
    const { error } = await supabaseAdmin.from("contacts").upsert(newContacts, { onConflict: "id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ ok: false, stage: "contacts", error: error.message }, { status: 500 });
  }

  const { data: clientRows } = await supabaseAdmin.from("clients").select("id");
  const existingClientIds = new Set((clientRows ?? []).map((c: any) => c.id as string));
  const byId = new Map<string, string>();
  for (const c of newContacts) byId.set(c.id, c.name);
  for (const c of contactRows ?? []) if (!byId.has(c.id)) byId.set(c.id, c.name);
  const uniqueContactIds = [...new Set(resolvedContactIds)];
  const newClients = uniqueContactIds
    .filter((id) => !existingClientIds.has("cl_" + id))
    .map((id) => ({ id: "cl_" + id, name: byId.get(id) ?? "Unnamed business", color: "#a855f7", ghl_location_id: "", status: "claimed", type: "prospect", assigned_to: [] }));
  if (newClients.length) {
    const { error } = await supabaseAdmin.from("clients").upsert(newClients, { onConflict: "id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ ok: false, stage: "clients", error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    totalListings: listingsResult.listings.length,
    contactsCreated: newContacts.length,
    clientsCreated: newClients.length,
    sampleNewClientIds: newClients.slice(0, 5).map((c) => c.id),
  });
}

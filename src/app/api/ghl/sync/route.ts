import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireAdmin } from "@/lib/serverAuth";

// Prefer the service-role client so contact upserts succeed once RLS is on;
// fall back to the anon client for the pre-RLS setup.
const writer = () => (adminConfigured ? supabaseAdmin : supabase);

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pulls contacts for one GoHighLevel sub-account (location) and upserts them
// into our contacts table, linked to the given client. The GHL token stays
// server-side (env). NOTE: this route is currently gated only by the admin-only
// Settings UI; server-side role enforcement lands with RLS hardening.
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId, locationId } = await req.json().catch(() => ({}));
  if (!clientId || !locationId) return NextResponse.json({ error: "Missing clientId or locationId." }, { status: 400 });

  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" };
  const contacts: any[] = [];
  let query = `locationId=${encodeURIComponent(locationId)}&limit=100`;

  // Page through every contact (GHL caps each response at 100).
  for (let page = 0; page < 100; page++) {
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/?${query}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `GoHighLevel API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json();
    const batch: any[] = json.contacts ?? [];
    contacts.push(...batch);
    const meta = json.meta ?? {};
    if (batch.length < 100 || !meta.startAfterId) break;
    query = `locationId=${encodeURIComponent(locationId)}&limit=100&startAfterId=${encodeURIComponent(meta.startAfterId)}${meta.startAfter ? `&startAfter=${encodeURIComponent(meta.startAfter)}` : ""}`;
  }
  const rows = contacts.map((c) => ({
    id: `ct_ghl_${c.id}`,
    client_id: clientId,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || c.name || c.email || "Unnamed contact",
    email: c.email ?? "",
    ghl_contact_id: c.id,
  }));

  if (rows.length) {
    const { error } = await writer().from("contacts").upsert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ synced: rows.length });
}

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireAdmin } from "@/lib/serverAuth";

// Prefer the service-role client so contact upserts succeed once RLS is on;
// fall back to the anon client for the pre-RLS setup.
const writer = () => (adminConfigured ? supabaseAdmin : supabase);

/* eslint-disable @typescript-eslint/no-explicit-any */

// A big sub-account (Directory: ~3,000 contacts) means ~30 sequential GHL
// API calls — long enough that a single slow page shouldn't sink the whole
// sync. Give the route room to run, and retry a page a couple times with
// backoff before giving up on it.
export const maxDuration = 60;

async function fetchGhlPage(url: string, headers: Record<string, string>, retries = 2): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res;
    last = res;
    if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  return last!;
}

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
  let pageError: string | null = null;

  // Page through every contact (GHL caps each response at 100).
  for (let page = 0; page < 100; page++) {
    const res = await fetchGhlPage(`https://services.leadconnectorhq.com/contacts/?${query}`, headers);
    if (!res.ok) {
      const text = await res.text();
      pageError = `GoHighLevel API ${res.status}: ${text.slice(0, 240)}`;
      break; // stop paging, but keep + save whatever we already collected
    }
    const json = await res.json();
    const batch: any[] = json.contacts ?? [];
    contacts.push(...batch);
    const meta = json.meta ?? {};
    if (batch.length < 100 || !meta.startAfterId) break;
    query = `locationId=${encodeURIComponent(locationId)}&limit=100&startAfterId=${encodeURIComponent(meta.startAfterId)}${meta.startAfter ? `&startAfter=${encodeURIComponent(meta.startAfter)}` : ""}`;
    await new Promise((r) => setTimeout(r, 150)); // small gap between pages, not a burst
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

  // A mid-sync page failure still saves everything collected up to that
  // point (upsert is idempotent) — surface it as a partial result the admin
  // can just retry, not a total loss.
  if (pageError) return NextResponse.json({ synced: rows.length, error: `Synced ${rows.length} before this page failed — retry Sync to pick up the rest. ${pageError}` }, { status: 200 });
  return NextResponse.json({ synced: rows.length });
}

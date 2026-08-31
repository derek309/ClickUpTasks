import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation, configuredLocations } from "@/lib/ghlTokens";
import { requireAdmin } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Searches GoHighLevel live for a contact by name, email or phone.
//
// "Add a client" only ever searched the LOCALLY SYNCED contacts table, while
// telling you it was searching GoHighLevel. Anyone added to a sub-account
// since the last bulk sync simply wasn't there, and the modal said "No
// matching contacts" as if they didn't exist (Derek hit this with a contact
// he was looking at in GHL in the next tab).
//
// Fans across every configured location rather than asking which one: a
// Private Integration token is scoped to one location, you rarely know which
// location a contact lives in, and this is read-only so trying several is
// harmless. Same reasoning as ../contact/route.ts.
//
// Admin-gated, matching contact writes being admin-only everywhere else.

export const maxDuration = 30;

const PER_LOCATION = 20;
const MAX_RESULTS = 40;

export type GhlContactHit = {
  ghlContactId: string;
  locationId: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  city: string;
  state: string;
};

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const q = typeof b.q === "string" ? b.q.trim() : "";
  if (q.length < 3) return NextResponse.json({ contacts: [] });

  const locations = await configuredLocations();
  if (locations.length === 0) return NextResponse.json({ contacts: [], error: "No GoHighLevel sub-accounts are connected yet." });

  const hits: GhlContactHit[] = [];
  const seen = new Set<string>();
  for (const locationId of locations) {
    if (hits.length >= MAX_RESULTS) break;
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    try {
      const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, page: 1, pageLimit: PER_LOCATION, query: q }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue; // one dead token must not take the whole search down
      const json = await res.json();
      for (const c of (json.contacts ?? []) as any[]) {
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        hits.push({
          ghlContactId: c.id,
          locationId,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || c.name || c.email || "Unnamed contact",
          email: c.email ?? "",
          phone: c.phone ?? "",
          company: c.companyName ?? "",
          city: c.city ?? "",
          state: c.state ?? "",
        });
      }
    } catch { /* timeout or network: skip this location, keep the rest */ }
  }
  return NextResponse.json({ contacts: hits.slice(0, MAX_RESULTS) });
}

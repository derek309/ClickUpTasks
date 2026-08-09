import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY — one-time diagnostic for the 4 orphaned Client Replies tasks
// (Michele/Carla/David/Donna) that didn't heal against Lincoln/Rocklin.
// Checks all 4 territories, reports match/no-match per contact, patches on
// a hit. Deleted after this runs — same pattern as the 2026-08-09 engagement
// backfill route.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: territories } = await supabaseAdmin.from("territories").select("id, city, state");
  const { data: openConvoTasks } = await supabaseAdmin.from("tasks").select("contact_id").eq("priority", "conversation").neq("status", "done").not("contact_id", "is", null);
  const openContactIds = Array.from(new Set((openConvoTasks ?? []).map((t) => t.contact_id as string)));
  const { data: orphaned } = await supabaseAdmin.from("contacts").select("id, name, ghl_contact_id, phone, email").in("id", openContactIds).is("city", null);

  const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

  const results: any[] = [];
  for (const oc of orphaned ?? []) {
    let matchedTerritory: string | null = null;
    let matchedListing: string | null = null;
    for (const t of territories ?? []) {
      const listingsResult = await fetchDirectoryListingsServer(t.city, t.state);
      if ("error" in listingsResult) continue;
      const listing =
        (oc.ghl_contact_id && listingsResult.listings.find((l) => l.ghlContactId === oc.ghl_contact_id)) ??
        (digits(oc.phone) ? listingsResult.listings.find((l) => digits(l.phone) === digits(oc.phone)) : undefined) ??
        (oc.email ? listingsResult.listings.find((l) => lc(l.email) === lc(oc.email)) : undefined);
      if (listing) {
        matchedTerritory = `${t.city}, ${t.state}`;
        matchedListing = listing.name;
        await supabaseAdmin.from("contacts").update({ city: t.city, state: t.state }).eq("id", oc.id);
        break;
      }
    }
    results.push({ contact: oc.name, email: oc.email, ghlContactId: oc.ghl_contact_id, matchedTerritory, matchedListing });
  }

  return NextResponse.json({ ok: true, territoriesChecked: (territories ?? []).map((t) => `${t.city}, ${t.state}`), results });
}

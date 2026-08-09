import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation, configuredLocations } from "@/lib/ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY — one-time diagnostic: which GHL sub-account do the 15 orphaned
// "invite email" tasks' contacts actually live in, and what tags/source do
// they carry? Deleted after this runs, same pattern as the two backfill
// routes earlier today.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: openConvoTasks } = await supabaseAdmin.from("tasks").select("contact_id").eq("priority", "conversation").neq("status", "done").not("contact_id", "is", null);
  const openContactIds = Array.from(new Set((openConvoTasks ?? []).map((t) => t.contact_id as string)));
  const { data: orphaned } = await supabaseAdmin.from("contacts").select("id, name, ghl_contact_id, email").in("id", openContactIds).is("city", null);

  const locations = await configuredLocations();
  const { data: clientRows } = await supabaseAdmin.from("clients").select("id, name, ghl_location_id").not("ghl_location_id", "is", null);
  const clientByLocation = new Map((clientRows ?? []).map((c: any) => [c.ghl_location_id, c.name]));

  const results: any[] = [];
  for (const oc of orphaned ?? []) {
    if (!oc.ghl_contact_id) { results.push({ contact: oc.name, email: oc.email, foundIn: null, note: "no ghl_contact_id" }); continue; }
    let found: any = null;
    for (const loc of locations) {
      const token = await tokenForLocation(loc);
      if (!token) continue;
      try {
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(oc.ghl_contact_id)}`, {
          headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        if (json?.contact) { found = { locationId: loc, contact: json.contact }; break; }
      } catch { continue; }
    }
    results.push({
      contact: oc.name,
      email: oc.email,
      ghlContactId: oc.ghl_contact_id,
      foundInLocation: found?.locationId ?? null,
      foundInClient: found ? (clientByLocation.get(found.locationId) ?? "(no matching client row)") : null,
      tags: found?.contact?.tags ?? null,
      source: found?.contact?.source ?? null,
      companyName: found?.contact?.companyName ?? null,
      dateAdded: found?.contact?.dateAdded ?? null,
    });
  }

  return NextResponse.json({ ok: true, locationsChecked: locations.length, results });
}

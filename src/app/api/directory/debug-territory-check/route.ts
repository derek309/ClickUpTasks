import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY — sweep Rocklin, Roseville, and Tracy for the same "clicked
// listing with no Follow Up task" gap found in Lincoln. Deleted after this
// runs.
const CHECKS: { city: string; state: string; gdPlaceIds: number[] }[] = [
  { city: "Tracy", state: "CA", gdPlaceIds: [15255, 15174, 15419] },
];

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

  const out: any[] = [];
  for (const check of CHECKS) {
    const result = await fetchDirectoryListingsServer(check.city, check.state);
    if ("error" in result) { out.push({ city: check.city, error: result.error }); continue; }
    const byId = new Map(result.listings.map((l) => [typeof l.id === "number" ? l.id : parseInt(String(l.id), 10), l]));
    for (const gdPlaceId of check.gdPlaceIds) {
      const l = byId.get(gdPlaceId);
      if (!l) { out.push({ city: check.city, gdPlaceId, name: null }); continue; }
      let contact: any = null;
      if (l.ghlContactId) {
        const { data } = await supabaseAdmin.from("contacts").select("id, name, client_id, ghl_contact_id, phone, email").eq("ghl_contact_id", l.ghlContactId).maybeSingle();
        contact = data;
      }
      if (!contact && l.email) {
        const { data } = await supabaseAdmin.from("contacts").select("id, name, client_id, ghl_contact_id, phone, email").ilike("email", lc(l.email)).maybeSingle();
        contact = data;
      }
      let openTask: any = null;
      if (contact) {
        const { data: t } = await supabaseAdmin.from("tasks").select("id, title, status").eq("contact_id", contact.id).eq("priority", "conversation").order("due", { ascending: false }).limit(1).maybeSingle();
        openTask = t;
      }
      out.push({
        city: check.city, gdPlaceId, name: l.name, claimed: l.claimed,
        ghlContactId: l.ghlContactId, phone: l.phone, email: l.email,
        contactFound: !!contact, contactId: contact?.id ?? null, clientId: contact?.client_id ?? null,
        openTask,
      });
    }
  }

  return NextResponse.json({ ok: true, out });
}

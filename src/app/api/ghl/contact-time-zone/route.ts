import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation, configuredLocations } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";
import { resolveTimeZone } from "@/lib/meetingTimes";

/* eslint-disable @typescript-eslint/no-explicit-any */

// A contact's time zone, for a meeting request's "my time and yours" (Derek,
// 2026-10-15). GoHighLevel's own timezone on the contact first, then their
// state, ZIP and phone area code (ours, else GoHighLevel's). Answers only the
// zone and where it came from: never the contact or a token. Read only.
//
// The contact's sub account is asked first; the rest at once, since a
// Private Integration token only knows its own location's contacts and the
// draft that waits on this should not wait long.

async function ghlContact(ghlContactId: string, homeLocation: string | null): Promise<any | null> {
  const ask = async (locationId: string) => {
    const token = await tokenForLocation(locationId);
    if (!token) return null;
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(ghlContactId)}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    if (!res?.ok) return null;
    return (await res.json().catch(() => null))?.contact ?? null;
  };
  const all = await configuredLocations();
  if (homeLocation && all.includes(homeLocation)) {
    const c = await ask(homeLocation);
    if (c) return c;
  }
  const rest = all.filter((l) => l !== homeLocation);
  const found = await Promise.all(rest.map((l) => ask(l).catch(() => null)));
  return found.find(Boolean) ?? null;
}

export async function GET(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ghlContactId = req.nextUrl.searchParams.get("contactId")?.trim() ?? "";
  if (!ghlContactId || !/^[A-Za-z0-9_-]{1,64}$/.test(ghlContactId)) return NextResponse.json({ error: "Missing contactId." }, { status: 400 });

  const { data: row } = await supabaseAdmin.from("contacts").select("client_id, state, phone").eq("ghl_contact_id", ghlContactId).limit(1).maybeSingle();
  // A client id not starting cl_ is a sub account, which holds its location id.
  const { data: sub } = row?.client_id && !String(row.client_id).startsWith("cl_")
    ? await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", row.client_id).maybeSingle()
    : { data: null };
  const c = await ghlContact(ghlContactId, (sub?.ghl_location_id as string | null) || null);

  const hit = resolveTimeZone({
    timeZone: c?.timezone ?? c?.timeZone ?? null,
    state: (row?.state as string | null) || c?.state || null,
    postalCode: c?.postalCode ?? null,
    country: c?.country ?? null,
    phone: (row?.phone as string | null) || c?.phone || null,
  });
  return NextResponse.json({ timeZone: hit?.timeZone ?? null, source: hit?.source ?? null });
}

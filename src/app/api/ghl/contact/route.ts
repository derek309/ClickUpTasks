import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation, configuredLocations } from "@/lib/ghlTokens";
import { requireAdmin } from "@/lib/serverAuth";
import { rowToContact } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

// This route can fan a single lookup across several sub-account tokens
// sequentially; give it headroom beyond the default so a couple of slow GHL
// responses don't trip the platform's function limit with an opaque 504.
export const maxDuration = 30;

// Re-pulls one contact's name/email/phone/company/city/state from
// GoHighLevel on demand — the bulk sync (../sync/route.ts) re-syncs an
// entire sub-account (a big Directory location is ~30 sequential GHL API
// calls), which is overkill when someone just wants to check whether a
// single contact's info changed. Admin-gated, matching contacts write
// being admin-only everywhere else in this app.
//
// `locationId` is optional and mostly vestigial: a client's own
// `ghlLocationId` field is unreliable for this purpose — it's empty for
// most clients, and where it IS set it's often been repurposed to just
// hold a company-name label rather than a real GHL location id (see
// Cockpit.tsx's `clientCompany` comment). Since a GHL Private Integration
// token is scoped to one location and `GET /contacts/{id}` doesn't take a
// location in the URL, it's safe to just try every CONNECTED token (the
// ones actually set up in Settings) until one successfully returns this
// exact contact — this is read-only, so trying several is harmless (unlike
// outbound actions like pushing a task or sending an SMS, which stay
// strictly gated on a known-correct location — guessing wrong there could
// send something from the wrong business).
// Runs one GET /contacts/{id} against one sub-account's token. Three outcomes:
//   { contact }   — found it here
//   "miss"        — this token's location genuinely doesn't have the contact
//                   (a real 404), so keep trying other tokens
//   "transient"   — rate-limit / auth / 5xx / network / timeout: we CAN'T
//                   conclude the contact is absent, so if no other token finds
//                   it we must report an error, not "doesn't exist"
type FetchResult = { contact: any } | "miss" | "transient";

async function fetchContactWithToken(token: string, ghlContactId: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(ghlContactId)}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return "transient"; // network error or the 8s timeout fired
  }
  if (res.status === 404) return "miss";
  if (!res.ok) return "transient"; // 401 (revoked), 429 (rate-limited), 5xx
  const json = await res.json().catch(() => null);
  return json?.contact ? { contact: json.contact } : "miss";
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { contactId, locationId, ghlContactId } = await req.json().catch(() => ({} as any));
  if (!contactId || !ghlContactId)
    return NextResponse.json({ error: "Missing contactId or ghlContactId." }, { status: 400 });

  let c: any = null;
  let sawTransient = false; // any token returned a rate-limit / auth / 5xx / timeout
  const tried = new Set<string>();
  const attempt = async (token: string) => {
    const r = await fetchContactWithToken(token, ghlContactId);
    if (r === "transient") { sawTransient = true; return false; }
    if (r === "miss") return false;
    c = r.contact;
    return true;
  };

  if (locationId) {
    const token = await tokenForLocation(locationId);
    if (token) { tried.add(token); await attempt(token); }
  }
  if (!c) {
    const locations = await configuredLocations();
    for (const loc of locations) {
      const token = await tokenForLocation(loc);
      if (!token || tried.has(token)) continue; // dedupe: same token can back two location ids
      tried.add(token);
      if (await attempt(token)) break;
    }
  }
  if (!c && process.env.GHL_TOKEN && !tried.has(process.env.GHL_TOKEN)) await attempt(process.env.GHL_TOKEN);
  if (!c) {
    // Only claim "doesn't exist anywhere" when every token gave a clean 404.
    // If any lookup hit a rate-limit/timeout/5xx, the contact may well be
    // reachable — say so, so the UI doesn't tell the user a live contact is gone.
    if (sawTransient) return NextResponse.json({ error: "GoHighLevel is temporarily unavailable (rate-limited or timed out). Try again in a moment." }, { status: 502 });
    return NextResponse.json({ error: "Couldn't find this contact in any connected GoHighLevel sub-account." }, { status: 404 });
  }

  const row = {
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || c.email || "Unnamed contact",
    email: c.email ?? "",
    phone: c.phone ?? null,
    company_name: c.companyName ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
  };
  const { data, error } = await supabaseAdmin.from("contacts").update(row).eq("id", contactId).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Contact not found locally." }, { status: 404 });
  return NextResponse.json({ contact: rowToContact(data) });
}

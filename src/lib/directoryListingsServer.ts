// Shared core of GET /api/directory/listings — pulled out so a server-only
// caller (the planner auto-invite cron) can fetch a city's directory without
// going through requireUser, which only ever authenticates a logged-in
// browser session. See that route for the auth/501-degrade wrapper.
import type { DirectoryListing } from "@/components/cockpit/TerritoryDirectory";
import { supabaseAdmin } from "./supabaseAdmin";
import { tokenForLocation } from "./ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
export const directoryConfigured = Boolean(WP_BASE && WP_KEY);

// Every unclaimed/invited contact lives under this one shared sub-account
// (see clients.id = 'c_directory') until it actually claims and gets its own
// real GHL location — same id the rest of the app already treats as the
// pre-claim bucket (ghl/webhook route, tasks/follow-up route). Not a env var
// or config value: it's a fixed piece of this account's GHL structure, same
// spirit as WORKSPACE_CLIENT_ID.
const DIRECTORY_CLIENT_ID = "c_directory";

// Resolved once per fetchDirectoryListingsServer call, not per listing —
// ghlUrl and bookingUrl are both location/calendar-wide, not per-business.
async function directoryLocationId(): Promise<string | null> {
  const { data: dir } = await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", DIRECTORY_CLIENT_ID).maybeSingle();
  return dir?.ghl_location_id ?? null;
}

// Each territory that's been set up for interviews has its own GHL calendar
// named "{City}, {State} | ClickUpLocal Business Interview" (confirmed live:
// Tracy and Lincoln currently have one, Rocklin and Roseville don't yet) —
// matched by that name prefix rather than a stored mapping, so a newly
// created calendar just works without a second place to register it. null
// when the location/token isn't resolvable or no calendar matches this city.
//
// The public booking widget URL (https://api.leadconnectorhq.com/widget/
// booking/{calendarId}) is GHL's documented pattern, not something this repo
// had a working example of before — flagged as unverified until it's
// actually clicked once in production.
async function bookingUrlForCity(locationId: string, city: string, state: string): Promise<string | null> {
  const token = await tokenForLocation(locationId);
  if (!token) return null;
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/calendars/?locationId=${encodeURIComponent(locationId)}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" },
    });
    if (!res.ok) return null;
    const calendars: any[] = (await res.json())?.calendars ?? [];
    const wanted = `${city}, ${state}`.toLowerCase();
    const match = calendars.find((c) => String(c.name ?? "").toLowerCase().startsWith(wanted));
    return match ? `https://api.leadconnectorhq.com/widget/booking/${match.id}` : null;
  } catch {
    return null;
  }
}

// GeoDirectory stores region as the full state name ("California"), while the
// territory sends the 2-letter code ("CA"). Normalize both to the abbreviation
// so the state guard matches instead of dropping everything.
const US_STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co",
  connecticut: "ct", delaware: "de", "district of columbia": "dc", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky",
  louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn",
  mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh",
  "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd",
  ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va",
  washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};
const normState = (s: string) => {
  const t = String(s ?? "").trim().toLowerCase();
  return t.length === 2 ? t : (US_STATES[t] || t);
};

// WP's title/category fields sometimes come back HTML-entity-encoded (e.g.
// "Ace Body Shop &amp; Towing") depending on how the listing was saved —
// decode the common ones here so the app never shows raw entities. No DOM
// available server-side, so a small manual table + numeric-entity fallback
// instead of the browser's textarea trick.
const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#039": "'", "#8217": "’", "#8216": "‘", "#8220": "“", "#8221": "”", "#8211": "–", "#8212": "—",
};
const decodeEntities = (s: string) => s.replace(/&(#\d+|[a-zA-Z]+);/g, (m, code) => {
  if (code in HTML_ENTITIES) return HTML_ENTITIES[code];
  if (code[0] === "#") { const n = parseInt(code.slice(1), 10); return Number.isFinite(n) ? String.fromCharCode(n) : m; }
  return m;
});

export async function fetchDirectoryListingsServer(city: string, state: string): Promise<{ listings: DirectoryListing[]; total: number; truncated: boolean } | { error: string; status: number }> {
  if (!directoryConfigured) return { error: "Directory not configured", status: 501 };
  if (!city.trim()) return { error: "city is required", status: 400 };

  // The WP /sales/listings endpoint filters by city name and returns the
  // full per-listing payload (title, phone, email, claimed, score, category,
  // city, street). We ask for a generous page so a whole city comes back in
  // one call; the directory per city is well within one page.
  // light=1: skip WP's per-row full-detail hydration (photos, activity log,
  // owner PII, etc.) — the light row it already computes for sort/filter has
  // everything this list view needs.
  // WP hard-caps per_page at 200, and a real city can exceed that — page
  // until we've collected `total`.
  const PER_PAGE = 200;
  const MAX_PAGES = 10; // 2000 listings/city — far past any real city, but a hard stop
  const base = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/listings`;
  const pageUrl = (page: number) => {
    const qs = new URLSearchParams({
      city, per_page: String(PER_PAGE), page: String(page),
      orderby: "cul_score", order: "DESC", light: "1",
      _cb: String(Date.now()),
    });
    return `${base}?${qs.toString()}`;
  };

  let res: Response;
  try {
    res = await fetch(pageUrl(1), { cache: "no-store", headers: { "X-ClickUpTasks-Key": WP_KEY, Accept: "application/json", "Cache-Control": "no-cache" } });
  } catch (e: any) {
    return { error: `Directory fetch failed: ${String(e?.message ?? e)}`, status: 502 };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    let detail = "";
    try {
      const j = JSON.parse(bodyText);
      detail = j?.data?.error?.message || j?.message || "";
    } catch { /* not JSON — fall through to HTML strip */ }
    if (!detail) detail = bodyText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    detail = detail.replace(/\s+/g, " ").trim().slice(0, 600);
    return { error: `Directory responded ${res.status}: ${detail}`, status: 502 };
  }
  const data = await res.json().catch(() => null);
  const rawItems: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  const total = typeof data?.total === "number" ? data.total : rawItems.length;
  let truncated = false;
  if (rawItems.length > 0 && total > rawItems.length) {
    const lastPage = Math.min(Math.ceil(total / PER_PAGE), MAX_PAGES);
    for (let page = 2; page <= lastPage; page++) {
      try {
        const r = await fetch(pageUrl(page), { cache: "no-store", headers: { "X-ClickUpTasks-Key": WP_KEY, Accept: "application/json", "Cache-Control": "no-cache" } });
        if (!r.ok) { truncated = true; break; }
        const d = await r.json().catch(() => null);
        const items: any[] = Array.isArray(d?.items) ? d.items : [];
        if (items.length === 0) break;
        rawItems.push(...items);
      } catch { truncated = true; break; }
    }
    if (rawItems.length < total) truncated = true;
  }

  // Both resolved once for the whole city, not per listing — a wp-admin edit
  // link doesn't need either, but the GHL contact link and the booking link
  // are location/calendar-wide, so there's nothing per-business to look up
  // twice for 200 rows.
  const locationId = await directoryLocationId();
  const bookingUrl = locationId ? await bookingUrlForCity(locationId, city, state) : null;

  const wantState = normState(state);
  const listings: DirectoryListing[] = rawItems
    .filter((it) => !wantState || normState(it.region ?? it.state ?? "") === wantState || String(it.region ?? "").trim() === "")
    .map((it) => {
      const ghlContactId = String(it.ghl_contact_id ?? "");
      return {
        id: it.id,
        name: decodeEntities(String(it.title ?? "")),
        phone: String(it.phone ?? ""),
        email: String(it.email ?? ""),
        city: String(it.city ?? ""),
        street: String(it.street ?? ""),
        claimed: Boolean(it.claimed),
        hasOffer: Boolean(it.has_offer),
        hasActiveEvents: Boolean(it.has_active_events),
        hasRecentPost: Boolean(it.has_recent_post),
        url: String(it.listing_url ?? "").trim() || (WP_BASE ? `${WP_BASE}/?p=${it.id}` : ""),
        // wp-admin edit screen for this GeoDirectory listing (gd_place post
        // type — same post id the public listing page above resolves).
        editUrl: WP_BASE ? `${WP_BASE.replace(/\/$/, "")}/wp-admin/post.php?post=${it.id}&action=edit` : "",
        ghlUrl: locationId && ghlContactId ? `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${ghlContactId}` : "",
        bookingUrl,
        score: (() => { const n = parseInt(String(it.clickuplocal_score ?? ""), 10); return Number.isFinite(n) ? n : null; })(),
        category: decodeEntities(Array.isArray(it.categories) && it.categories.length ? String(it.categories[0]).split("›").pop()!.trim() : String(it.category ?? "")),
        outcome: String(it.outcome ?? ""),
        outcomeLabel: String(it.outcome_label ?? ""),
        nextAction: String(it.next_action ?? ""),
        nextActionLabel: String(it.next_action_label ?? ""),
        followupDue: typeof it.followup_due === "number" ? it.followup_due : 0,
        lastTouched: typeof it.last_touched === "number" ? it.last_touched : 0,
        rep: String(it.sales_rep?.name ?? ""),
        ghlContactId,
      };
    });

  return { listings, total, truncated };
}

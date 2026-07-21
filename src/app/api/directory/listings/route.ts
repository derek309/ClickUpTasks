import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Proxy the ClickUpLocal WordPress directory (GeoDirectory) into the task app
// so the territory/city view can show a business's real directory listing
// status the same way the /sales field tool does: claimed vs unclaimed,
// CUL score, category. Live-fetched per city (no local copy) — the directory
// is the source of truth, and an ambassador opening a city wants it current.
//
// Auth: the caller must be a signed-in task-app user (requireUser). The shared
// server-to-server key to WordPress (CLICKUPTASKS_API_KEY, sent as the
// X-ClickUpTasks-Key header that cul_sales_user_can() already accepts) stays
// server-side and is never exposed to the browser. Returns 501 when the two
// env vars aren't configured, so the feature degrades cleanly before setup.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";      // e.g. https://clickuplocal.com
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";   // shared secret, same value as wp-config
const configured = Boolean(WP_BASE && WP_KEY);

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

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!configured) return NextResponse.json({ error: "Directory not configured", listings: [] }, { status: 501 });

  const { searchParams } = new URL(req.url);
  const city = (searchParams.get("city") || "").trim();
  const state = (searchParams.get("state") || "").trim();
  if (!city) return NextResponse.json({ error: "city is required", listings: [] }, { status: 400 });

  // The WP /sales/listings endpoint filters by city name and returns the
  // full per-listing payload (title, phone, email, claimed, score, category,
  // city, street). We ask for a generous page so a whole city comes back in
  // one call; the directory per city is well within one page.
  // light=1: skip WP's per-row full-detail hydration (photos, activity log,
  // owner PII, etc.) — the light row it already computes for sort/filter has
  // everything this list view needs. Cuts load time from many seconds to
  // near-instant for a dense city. See sales-tool.php's cul_sales_rest_list.
  // _cb: unique per request so any caching layer in front of WordPress
  // (Cloudflare, a page-rule cache, etc.) can't serve a stale response —
  // the directory should always reflect the live /sales state.
  // WP hard-caps per_page at 200 (min(200, ...) in cul_sales_rest_list), and a
  // real city can exceed that — Lincoln has 231. A single request silently
  // dropped the tail, which hid actual claimed clients from the territory, and
  // WP's own `truncated` flag reports false while truncating, so nothing
  // warned. Page until we've collected `total`.
  const PER_PAGE = 200;
  const MAX_PAGES = 10; // 2000 listings/city — far past any real city, but a hard stop
  const base = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/listings`;
  const pageUrl = (page: number) => {
    const qs = new URLSearchParams({
      city, per_page: String(PER_PAGE), page: String(page),
      orderby: "cul_score", order: "DESC", light: "1",
      // Unique per request so no cache layer in front of WordPress can serve
      // a stale page — the directory should always reflect live /sales state.
      _cb: String(Date.now()),
    });
    return `${base}?${qs.toString()}`;
  };

  let res: Response;
  try {
    res = await fetch(pageUrl(1), { cache: "no-store", headers: { "X-ClickUpTasks-Key": WP_KEY, Accept: "application/json", "Cache-Control": "no-cache" } });
  } catch (e: any) {
    return NextResponse.json({ error: "Directory fetch failed", detail: String(e?.message ?? e), listings: [] }, { status: 502 });
  }
  if (!res.ok) {
    // Surface WordPress's actual error instead of an opaque status. WP's REST
    // 500 comes back as JSON carrying the precise PHP error (file + line) in
    // data.error.message — pull that when present; otherwise strip the HTML
    // "critical error" page down to readable text. Wider slice so the
    // "…on line N" tail isn't cut off.
    const bodyText = await res.text().catch(() => "");
    let detail = "";
    try {
      const j = JSON.parse(bodyText);
      detail = j?.data?.error?.message || j?.message || "";
    } catch { /* not JSON — fall through to HTML strip */ }
    if (!detail) detail = bodyText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    detail = detail.replace(/\s+/g, " ").trim().slice(0, 600);
    return NextResponse.json({ error: `Directory responded ${res.status}`, detail, listings: [] }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  const rawItems: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  // Pull the remaining pages when the city has more than one. Sequential
  // rather than parallel: this is a handful of requests at most, and it keeps
  // a big city from hammering the WP box. A page that fails just stops the
  // loop — better to return what we have (and say so) than fail the whole
  // territory over the tail.
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

  // Optional state narrowing — the WP endpoint filters on city name only, so
  // when a state is given we drop rows whose region doesn't match (guards the
  // rare same-named city in two states).
  const wantState = normState(state);
  const listings = rawItems
    .filter((it) => !wantState || normState(it.region ?? it.state ?? "") === wantState || String(it.region ?? "").trim() === "")
    .map((it) => ({
      id: it.id,
      name: String(it.title ?? ""),
      phone: String(it.phone ?? ""),
      email: String(it.email ?? ""),
      city: String(it.city ?? ""),
      street: String(it.street ?? ""),
      claimed: Boolean(it.claimed),
      hasOffer: Boolean(it.has_offer),
      // The hydrated /sales payload returns the score as a string ("72") and
      // categories as an array of breadcrumbs ("A › B › Leaf"); normalize both.
      score: (() => { const n = parseInt(String(it.clickuplocal_score ?? ""), 10); return Number.isFinite(n) ? n : null; })(),
      category: Array.isArray(it.categories) && it.categories.length ? String(it.categories[0]).split("›").pop()!.trim() : String(it.category ?? ""),
      // Outreach pipeline state (from /sales — the source of truth): last
      // outcome, queued next action, follow-up due date, last-touched. Drive
      // the funnel view + the "log a touch" write path.
      outcome: String(it.outcome ?? ""),
      outcomeLabel: String(it.outcome_label ?? ""),
      nextAction: String(it.next_action ?? ""),
      nextActionLabel: String(it.next_action_label ?? ""),
      followupDue: typeof it.followup_due === "number" ? it.followup_due : 0,
      lastTouched: typeof it.last_touched === "number" ? it.last_touched : 0,
      rep: String(it.sales_rep?.name ?? ""),  // assigned ambassador (read-only here)
      ghlContactId: String(it.ghl_contact_id ?? ""), // links to the Prospects-pipeline opportunity
    }));

  // Our own truncation flag, not WP's — WP reports truncated:false even when
  // it capped the result at per_page, so trusting it hid the missing tail.
  return NextResponse.json({ listings, total, truncated });
}

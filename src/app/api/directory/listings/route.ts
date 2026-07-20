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
  const qs = new URLSearchParams({ city, per_page: "200", orderby: "cul_score", order: "DESC", light: "1" });
  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/listings?${qs.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { "X-ClickUpTasks-Key": WP_KEY, Accept: "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ error: "Directory fetch failed", detail: String(e?.message ?? e), listings: [] }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `Directory responded ${res.status}`, listings: [] }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  const rawItems: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

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

  return NextResponse.json({ listings, truncated: Boolean(data?.truncated) });
}

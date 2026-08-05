import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { citySlugForTerritory } from "@/lib/wpCitySlug";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Fetches the public "I'm interested" join links for a set of businesses in
// one planner week — the same URL the invite email sends them to, so a rep
// can copy it and hand it over directly (text it, paste it into a call).
//
// Proxies WordPress's /sales/join-links rather than building the URL here:
// the token is an HMAC over (city|week|listing) keyed by a secret that lives
// only in WordPress, deliberately, so this side can't mint one. Batched in a
// single call so the UI has every link before the rep clicks — a copy button
// that has to await a fetch first trips Safari's user-gesture rule.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
const configured = Boolean(WP_BASE && WP_KEY);

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!configured) return NextResponse.json({ error: "Invite links aren't configured yet (missing CUL_WP_BASE_URL/CLICKUPTASKS_API_KEY)." }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const territoryId = String(body?.territoryId ?? "").trim();
  const week = String(body?.week ?? "").trim();
  const listingIds = Array.isArray(body?.gdPlaceIds)
    ? [...new Set(body.gdPlaceIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0))]
    : [];
  if (!territoryId || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ error: "territoryId and week (yyyy-mm-dd) are required" }, { status: 400 });
  }
  if (listingIds.length === 0) return NextResponse.json({ ok: true, links: {} });

  // One 400 for both "no such territory" and "no slug to build from" — see
  // wpCitySlug.ts; the UI shows either as the same error string.
  const citySlug = await citySlugForTerritory(territoryId);
  if (!citySlug) return NextResponse.json({ error: "Territory not found, or it has no city name or wp_city_slug to build links for." }, { status: 400 });

  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/join-links`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "X-ClickUpTasks-Key": WP_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ city: citySlug, week, listing_ids: listingIds }),
      cache: "no-store",
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Invite link fetch failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: data?.error || `WordPress responded ${res.status}` }, { status: 502 });

  return NextResponse.json({ ok: true, links: (data?.links ?? {}) as Record<string, string> });
}

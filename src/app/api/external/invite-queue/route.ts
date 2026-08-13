import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { verifyClickUpTasksKey } from "@/lib/verifyBridgeKey";
import { rowToPlannerWeek } from "@/lib/db";
import { todayIso } from "@/lib/data";
import { inviteHistory, isDue, ROTATION_WINDOW_DAYS } from "@/lib/plannerPools";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";
import { zonedDateString, BUSINESS_TZ } from "@/lib/businessHours";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The daily auto-invite queue for one city: who already went out today, who
// goes next, and who is behind them.
//
// Exists so the WordPress Outreach tab can SHOW the queue without deciding it.
// The decision has to stay here: the ranking runs on invite history stored in
// Supabase (planner_weeks.invited), which WordPress has no copy of. WordPress
// keeps its own outreach records per city and week, a different store with
// different timestamps, so a queue computed there would rank by one history
// while the cron sends by another. It would look authoritative and be wrong.
//
// Deliberately reuses inviteHistory/isDue and mirrors runPlannerAutoInvite's
// candidate pipeline exactly (unclaimed only, due for a touch, never-invited
// first then oldest, capped) rather than reimplementing the ordering. If that
// cron's ranking changes, this must change with it or the queue starts lying
// about who is next, which is the whole reason a rep would open it.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!verifyClickUpTasksKey(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const city = (req.nextUrl.searchParams.get("city") || "").trim();
  const state = (req.nextUrl.searchParams.get("state") || "CA").trim();
  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });

  const { data: terrRows } = await supabaseAdmin.from("territories").select("id, city, state, daily_invite_cap");
  const terr = (terrRows ?? []).find((t: any) => String(t.city).toLowerCase() === city.toLowerCase());
  if (!terr) return NextResponse.json({ error: "No territory for that city" }, { status: 404 });

  const cap = Number(terr.daily_invite_cap ?? 0);
  const [weeks, listingsResult] = await Promise.all([
    supabaseAdmin.from("planner_weeks").select("*").eq("territory_id", terr.id).then(({ data }) => (data ?? []).map(rowToPlannerWeek)),
    fetchDirectoryListingsServer(terr.city, terr.state || state),
  ]);
  if ("error" in listingsResult) return NextResponse.json({ error: listingsResult.error }, { status: 502 });

  const nameByGd = new Map<number, string>();
  for (const l of listingsResult.listings) {
    const gd = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    if (Number.isFinite(gd)) nameByGd.set(gd, l.name);
  }

  // Pacific day, matching the window the cron itself is evaluated in — a UTC
  // day would roll over mid-afternoon here and show an empty "sent today"
  // while the morning's batch was still the most recent thing that happened.
  const todayLocal = zonedDateString(new Date(), BUSINESS_TZ);
  const sentToday: { gdPlaceId: number; name: string; at: string; by: string }[] = [];
  for (const w of weeks) {
    for (const inv of w.invited ?? []) {
      if (inv.status !== "invited") continue;
      if (zonedDateString(new Date(inv.at), BUSINESS_TZ) !== todayLocal) continue;
      sentToday.push({ gdPlaceId: inv.gdPlaceId, name: nameByGd.get(inv.gdPlaceId) || String(inv.gdPlaceId), at: inv.at, by: String((inv as any).by ?? "") });
    }
  }
  sentToday.sort((a, b) => a.at.localeCompare(b.at));

  const invited = inviteHistory(weeks);
  const today = todayIso();
  const candidates = listingsResult.listings
    .filter((l) => !l.claimed)
    .map((l) => ({ l, gdPlaceId: typeof l.id === "number" ? l.id : parseInt(String(l.id), 10) }))
    .filter((c) => Number.isFinite(c.gdPlaceId))
    .map((c) => ({ ...c, lastAt: invited.get(c.gdPlaceId)?.lastAt ?? null }))
    .filter((c) => isDue(c.lastAt, today))
    .sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? ""));

  const remaining = Math.max(0, cap - sentToday.length);
  const shape = (c: (typeof candidates)[number]) => ({
    gdPlaceId: c.gdPlaceId,
    name: c.l.name,
    lastInvitedAt: c.lastAt,
    hasEmail: Boolean(c.l.email),
  });

  // "Tomorrow" is the next capful behind today's, not a promise. Due-ness is
  // recomputed each morning against that day's date and the listing set can
  // change overnight (a claim, a new listing, a manual invite), so this is
  // "who is next in line right now" — labelled as such on the WordPress side
  // rather than presented as a schedule.
  const todayQueue = candidates.slice(0, remaining).map(shape);
  const tomorrowQueue = cap > 0 ? candidates.slice(remaining, remaining + cap).map(shape) : [];

  return NextResponse.json({
    ok: true,
    city: terr.city,
    cap,
    rotationWindowDays: ROTATION_WINDOW_DAYS,
    sentToday,
    remainingToday: remaining,
    todayQueue,
    tomorrowQueue,
    dueTotal: candidates.length,
    // Businesses with no email can never actually receive an invite; the cron
    // still counts them as candidates and burns a slot attempting them, which
    // is why a 15 cap has been producing 10 to 14 sends a day. Surfaced so the
    // gap is visible instead of looking like the cron underperforming.
    dueWithoutEmail: candidates.filter((c) => !c.l.email).length,
  });
}

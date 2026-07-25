// Candidate "who to feature" pools for the Content Planner — computed from
// data ClickUpTasks already owns (the directory listings proxy + the
// territory's own planner_weeks history) rather than stored anywhere new.
// The ClickUpTasks equivalent of WordPress's cul_sales_featured_map(),
// scanning real rows instead of LIKE-matching wp_options.
import type { PlannerWeek } from "./data";

export type PoolListing = { id: number | string; name: string; category: string; claimed: boolean; hasOffer: boolean; score: number | null };
export type PoolCandidate = { gdPlaceId: number | null; name: string; cat: string; score: number | null; timesFeatured: number; lastFeatured: string | null; due: boolean };

const FEATURE_SLOTS = ["spotlight", "gem", "gem2", "gem3"] as const;
const ROTATION_WINDOW_DAYS = 90;

// name -> { count, last week iso } across every week this territory has ever
// had picks for, regardless of which slot — mirrors WP's rotation history,
// just off real rows instead of an options-table LIKE scan.
function featureHistory(weeks: PlannerWeek[]): Map<string, { count: number; last: string }> {
  const map = new Map<string, { count: number; last: string }>();
  for (const w of weeks) {
    for (const slot of FEATURE_SLOTS) {
      const biz = w.picks[slot];
      if (!biz?.name) continue;
      const key = biz.name.toLowerCase().trim();
      const rec = map.get(key);
      if (!rec || w.week > rec.last) map.set(key, { count: (rec?.count ?? 0) + 1, last: w.week });
      else map.set(key, { count: rec.count + 1, last: rec.last });
    }
  }
  return map;
}

function isDue(last: string | null, todayIso: string): boolean {
  if (!last) return true;
  const days = (new Date(todayIso).getTime() - new Date(last).getTime()) / 86400000;
  return days > ROTATION_WINDOW_DAYS;
}

export function computePlannerPools(opts: {
  listings: PoolListing[];
  weeks: PlannerWeek[];
  dismissedIds: number[];
  excludeNames: string[]; // already picked in the open week's own slots
  todayIso: string;
}): { spotlight: PoolCandidate[]; hiddenGem: PoolCandidate[] } {
  const { listings, weeks, dismissedIds, excludeNames, todayIso } = opts;
  const history = featureHistory(weeks);
  const excluded = new Set(excludeNames.map((n) => n.toLowerCase().trim()));
  const dismissed = new Set(dismissedIds);

  const toCandidate = (l: PoolListing): PoolCandidate | null => {
    if (excluded.has(l.name.toLowerCase().trim())) return null;
    const idNum = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    if (Number.isFinite(idNum) && dismissed.has(idNum)) return null;
    const rec = history.get(l.name.toLowerCase().trim()) ?? null;
    return {
      gdPlaceId: Number.isFinite(idNum) ? idNum : null, name: l.name, cat: l.category, score: l.score,
      timesFeatured: rec?.count ?? 0, lastFeatured: rec?.last ?? null, due: isDue(rec?.last ?? null, todayIso),
    };
  };

  const spotlight = listings.filter((l) => l.claimed && l.hasOffer).map(toCandidate).filter((c): c is PoolCandidate => !!c)
    .sort((a, b) => (a.due === b.due ? (b.score ?? -1) - (a.score ?? -1) : a.due ? -1 : 1));
  const hiddenGem = listings.filter((l) => !l.claimed).map(toCandidate).filter((c): c is PoolCandidate => !!c)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return { spotlight: spotlight.slice(0, 8), hiddenGem: hiddenGem.slice(0, 8) };
}

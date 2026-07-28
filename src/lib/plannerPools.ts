// Candidate "who to feature" pools for the Content Planner — computed from
// data ClickUpTasks already owns (the directory listings proxy + the
// territory's own planner_weeks history) rather than stored anywhere new.
// The ClickUpTasks equivalent of WordPress's cul_sales_featured_map(),
// scanning real rows instead of LIKE-matching wp_options.
import type { PlannerWeek } from "./data";
import { matchesAnyCategory } from "./categoryMatch";

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
  categories?: string[]; // the week's theme categories — matches rank ahead of everything else
}): { spotlight: PoolCandidate[]; hiddenGem: PoolCandidate[] } {
  const { listings, weeks, dismissedIds, excludeNames, todayIso, categories } = opts;
  const history = featureHistory(weeks);
  const excluded = new Set(excludeNames.map((n) => n.toLowerCase().trim()));
  const dismissed = new Set(dismissedIds);
  // Fuzzy word-overlap match (categoryMatch.ts) — theme categories and real
  // GD categories are different vocabularies, so exact string equality
  // rarely hits (e.g. theme "Coffee and Cafes" vs GD "Coffee Shops"). Empty
  // categories (no theme assigned) matches everything.
  const themeCats = (categories ?? []).filter((c) => c.trim());
  const matchesTheme = (c: PoolCandidate) => matchesAnyCategory(c.cat, themeCats);

  const toCandidate = (l: PoolListing): PoolCandidate | null => {
    if (excluded.has(l.name.toLowerCase().trim())) return null;
    // The agency's own directory listing isn't a real feature candidate —
    // it surfaced as a Spotlight suggestion once already (a real,
    // claimed+offer listing, just not a business anyone should feature).
    if (l.name.toLowerCase().replace(/\s+/g, "") === "clickuplocal") return null;
    const idNum = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    if (Number.isFinite(idNum) && dismissed.has(idNum)) return null;
    const rec = history.get(l.name.toLowerCase().trim()) ?? null;
    return {
      gdPlaceId: Number.isFinite(idNum) ? idNum : null, name: l.name, cat: l.category, score: l.score,
      timesFeatured: rec?.count ?? 0, lastFeatured: rec?.last ?? null, due: isDue(rec?.last ?? null, todayIso),
    };
  };

  // Theme-matching candidates rank ahead of everything else (rather than a
  // hard filter) so a themed week never comes up empty just because the
  // territory happens to be short on that category this cycle.
  const rankByTheme = (list: PoolCandidate[], sortFn: (a: PoolCandidate, b: PoolCandidate) => number) => [
    ...list.filter(matchesTheme).sort(sortFn),
    ...list.filter((c) => !matchesTheme(c)).sort(sortFn),
  ];

  const dueThenScore = (a: PoolCandidate, b: PoolCandidate) => (a.due === b.due ? (b.score ?? -1) - (a.score ?? -1) : a.due ? -1 : 1);
  const byScore = (a: PoolCandidate, b: PoolCandidate) => (b.score ?? -1) - (a.score ?? -1);

  const spotlight = rankByTheme(
    listings.filter((l) => l.claimed && l.hasOffer).map(toCandidate).filter((c): c is PoolCandidate => !!c),
    dueThenScore
  );
  const hiddenGem = rankByTheme(
    listings.filter((l) => !l.claimed).map(toCandidate).filter((c): c is PoolCandidate => !!c),
    byScore
  );

  return { spotlight: spotlight.slice(0, 8), hiddenGem: hiddenGem.slice(0, 8) };
}

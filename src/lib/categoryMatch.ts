// Fuzzy match between a newsletter theme's category tags and a listing's real
// GeoDirectory category — the two are different vocabularies with no shared
// source of truth. Theme categories come from either a hardcoded seed
// calendar (supabase/planner-theme-calendar-seed.sql, invented editorial
// phrases ported from WordPress) or an ungrounded AI call
// (mode: suggest_categories in /api/ai/planner-workshop) — neither is ever
// shown the directory's live GD taxonomy, so "Coffee and Cafes" (theme) vs
// "Coffee Shops" (real GD category) never matches on exact string equality,
// even though they're obviously the same thing to a person. Word-overlap is
// the fix that helps regardless of which side invented its phrasing, without
// requiring the two vocabularies to ever be kept in sync.
const STOPWORDS = new Set(["and", "the", "of", "a", "an", "for", "or", "in", "at", "to"]);

// Generic retail/venue-type nouns (post-stemming, singular form) that appear
// as a suffix on huge swaths of unrelated GD categories — "Coffee Shops",
// "Body Shops", "Tire Shops", "Bicycle Shops" all share "shop"; "Wine Bars",
// "Sports Bars", "Juice Bars" all share "bar". Treated as meaningful overlap,
// these produced real false positives (a body shop and a tire shop both
// "matching" a coffee-and-cafes theme via the shared word "shop"). Excluded
// the same way STOPWORDS are — a match still needs an actual distinguishing
// word ("coffee", "body", "tire") to hit.
const GENERIC_CATEGORY_WORDS = new Set(["shop", "store", "bar", "center", "centre", "service", "market"]);

// Cheap English singular/plural normalization ("Bakeries" -> "bakery",
// "Cafes" -> "cafe", "Shops" -> "shop") — not a real stemmer, just enough to
// stop a plural/singular mismatch (a very likely category-naming difference)
// from silently defeating the word-overlap match below.
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  // "-es" is only a true es-plural after a sibilant (boxes, dishes, churches).
  // Everywhere else it's just an "-e" word pluralized with a bare "-s", and
  // stripping both letters mangles it: "wines" became "win" while "wine"
  // stayed "wine", so a Wine theme silently matched no wine business at all.
  // Same for shoes/shoe, bikes/bike, cakes/cake.
  if (word.length > 3 && word.endsWith("es")) {
    return /(?:s|x|z|ch|sh)$/.test(word.slice(0, -2)) ? word.slice(0, -2) : word.slice(0, -1);
  }
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function significantWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)).map(stem)
      .filter((w) => !GENERIC_CATEGORY_WORDS.has(w))
  );
}

// True if the two category phrases share at least one significant word
// ("Coffee and Cafes" / "Coffee Shops" → both contain "coffee"). Falls back
// to substring containment for short single-word categories that a word-set
// intersection alone would miss (e.g. "Bakeries" / "Bakery").
export function categoriesMatch(a: string, b: string): boolean {
  const av = a.trim().toLowerCase(), bv = b.trim().toLowerCase();
  if (!av || !bv) return false;
  if (av === bv || av.includes(bv) || bv.includes(av)) return true;
  const wa = significantWords(a);
  for (const w of wa) if (significantWords(b).has(w)) return true;
  return false;
}

// True if `category` matches ANY of the theme's category tags (or the theme
// has none set, in which case everything matches — no theme, no filter).
export function matchesAnyCategory(category: string, themeCategories: string[]): boolean {
  if (themeCategories.length === 0) return true;
  return themeCategories.some((c) => categoriesMatch(c, category));
}

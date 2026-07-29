"use client";

// Content Planner — the per-city weekly newsletter workflow, moved in from
// WordPress's /sales Content Planner tab. ClickUpTasks is now the source of
// truth (see supabase/planner.sql); WordPress becomes a push-target for the
// public "{City} Weekly" archive page only (Phase 4). Phase 3: sections/
// events editors + brief generation + the newsletter backlog. The AI
// Workshop/candidate pools (Phase 5) aren't built yet.
import { useEffect, useMemo, useRef, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import {
  fetchPlannerWeeks, upsertPlannerWeek, deletePlannerWeekDb,
  fetchPlannerSections, upsertPlannerSection, deletePlannerSectionDb,
  fetchPlannerEvents, upsertPlannerEvent, deletePlannerEventDb, fetchRecentPlannerEvents,
  fetchNewsletterItems, upsertNewsletterItem, deleteNewsletterItemDb,
  fetchThemeCalendar,
} from "@/lib/db";
import {
  PLANNER_CURRENT_WEEK, plannerWeekLabel, addDaysIso, todayIso, PLANNER_CONTENT_SLOTS, PLANNER_BUSINESS_SLOTS, themeForWeek,
  type PlannerWeek, type PlannerSlot, type PlannerBiz, type PlannerSection, type PlannerEvent, type NewsletterItem, type ThemeCalendarEntry, type PlannerInvite,
} from "@/lib/data";
import { generatePlannerBrief } from "@/lib/plannerBrief";
import { pushPlannerWeek } from "@/lib/plannerPush";
import { featureHistory, inviteHistory } from "@/lib/plannerPools";
import { categoriesMatch, matchesAnyCategory } from "@/lib/categoryMatch";
import { I, newId } from "./ui";
import { type DirectoryListing } from "./TerritoryDirectory";

const SLOT_LABELS: Record<PlannerSlot, string> = {
  spotlight: "Business Spotlight",
  gem: "Hidden Gem",
  gem2: "Hidden Gem 2",
  gem3: "Hidden Gem 3",
  story: "The Story (local news)",
};
// A week patch, or a function deriving one from the CURRENT row. The function
// form matters for array appends (invited/dismissed/categories) issued after
// an await, where the captured `week` prop is already stale.
type PlannerWeekPatch = Partial<PlannerWeek> | ((w: PlannerWeek) => Partial<PlannerWeek>);
const SECTION_PRESETS = ["The Story", "New In Town", "Ask Your Concierge", "Last Call"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// A batch of live-search suggestions is a paid, ~10-60s Gemini call — losing
// it to an accidental refresh mid-review means paying for it again. Cached
// per week in localStorage (same cut_-prefixed, try/catch convention used
// elsewhere in this app), not the database — it's a disposable draft, not
// data worth syncing across devices.
const DRAFT_CACHE_PREFIX = "cut_plannerDraft_";

export function PlannerPanel({ territoryId, city, state, initialWeekId, onWeekChange }: {
  territoryId: string; city: string; state: string;
  // Deep-link support (Cockpit's URL sync) — initialWeekId seeds which week
  // opens on mount, onWeekChange mirrors every change back up so the URL
  // stays in sync. Both optional so this component still works standalone.
  initialWeekId?: string | null; onWeekChange?: (id: string | null) => void;
}) {
  const [weeks, setWeeks] = useState<PlannerWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [openWeekId, setOpenWeekId] = useState<string | null>(initialWeekId ?? null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  useEffect(() => { onWeekChange?.(openWeekId); }, [openWeekId, onWeekChange]);
  // Business typeahead source for slot/section/event picks — the same city
  // fetch TerritoryDirectory already uses, cached here independently since
  // this view can be open without the Businesses tab ever having loaded it.
  const [listings, setListings] = useState<DirectoryListing[]>([]);
  // The theme calendar is shared across every city, so it's fetched once
  // here rather than per-territory like weeks/listings.
  const [themeCalendar, setThemeCalendar] = useState<ThemeCalendarEntry[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setOpenWeekId(null);
    fetchPlannerWeeks(territoryId).then((ws) => { if (alive) { setWeeks(ws); setLoading(false); } });
    return () => { alive = false; };
  }, [territoryId]);

  useEffect(() => {
    let alive = true;
    fetchThemeCalendar().then((c) => { if (alive) setThemeCalendar(c); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ city, state });
    authedFetch(`/api/directory/listings?${qs.toString()}`)
      .then(async (res) => { const body = await res.json().catch(() => ({})); if (alive && Array.isArray(body.listings)) setListings(body.listings); })
      .catch(() => {});
    return () => { alive = false; };
  }, [city, state]);

  const nextWeekIso = addDaysIso(PLANNER_CURRENT_WEEK, 7);
  const hasWeek = (w: string) => weeks.some((x) => x.week === w);

  const createWeek = async (week: string) => {
    // No theme/categories prefilled here — the calendar's assignment is
    // only ever offered as a suggestion (it's fed to "Suggest themes" as
    // context), never written to the week until the user actually picks
    // one. A prefilled theme reads as already-decided and skews the
    // Spotlight/Hidden Gem pools before anyone chose anything.
    const w: PlannerWeek = {
      id: newId("pw_"), territoryId, week, themeOverride: "", themeDescription: "", categories: [], notes: "", weatherNote: "",
      picks: {}, dismissed: [], invited: [], archived: false, sentDate: null, wpPushedAt: null, createdAt: new Date().toISOString(),
    };
    setWeeks((ws) => [w, ...ws]);
    await upsertPlannerWeek(w);
    setOpenWeekId(w.id);
  };

  // upsertPlannerWeek REPLACES the whole row, so every save must be built from
  // the very latest week — a merge built from a stale snapshot silently erases
  // whatever landed in between (this is why notes/categories kept "not
  // sticking"). weeksRef is updated SYNCHRONOUSLY inside patchWeek rather than
  // only by the effect below, because the effect can't run until after a
  // render: two edits in the same tick would otherwise both read the
  // pre-render value and the second would clobber the first.
  const weeksRef = useRef<PlannerWeek[]>(weeks);
  useEffect(() => { weeksRef.current = weeks; }, [weeks]);

  // `patch` may be a function so callers appending to an array (invited,
  // dismissed, categories) derive from the current row instead of a `week`
  // prop captured before an await — see sendInvite, where the GHL send takes
  // seconds and two overlapping invites would otherwise drop one.
  const patchWeek = (id: string, patch: PlannerWeekPatch) => {
    const cur = weeksRef.current.find((w) => w.id === id);
    if (!cur) return;
    const merged: PlannerWeek = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
    weeksRef.current = weeksRef.current.map((w) => (w.id === id ? merged : w));
    setWeeks(weeksRef.current);
    upsertPlannerWeek(merged);
  };

  const deleteWeek = (id: string) => {
    setWeeks((ws) => ws.filter((w) => w.id !== id));
    if (openWeekId === id) setOpenWeekId(null);
    deletePlannerWeekDb(id);
  };

  const openWeek = weeks.find((w) => w.id === openWeekId) ?? null;

  if (loading) return <div className="bg-background p-4 py-10 text-center text-[13px] text-muted sm:p-5">Loading planner…</div>;

  if (openWeek) {
    return (
      <WeekWorkspace week={openWeek} weeks={weeks} listings={listings} cityName={city} state={state} themeCalendar={themeCalendar} onBack={() => setOpenWeekId(null)}
        onPatch={(patch) => patchWeek(openWeek.id, patch)} onDelete={() => deleteWeek(openWeek.id)} />
    );
  }

  const sorted = [...weeks].sort((a, b) => b.week.localeCompare(a.week));

  return (
    <div className="pt-1">
      <div className="mb-2 flex flex-wrap gap-2">
        {!hasWeek(PLANNER_CURRENT_WEEK) && (
          <button onClick={() => createWeek(PLANNER_CURRENT_WEEK)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground"><I.plus /> This week ({plannerWeekLabel(PLANNER_CURRENT_WEEK)})</button>
        )}
        {!hasWeek(nextWeekIso) && (
          <button onClick={() => createWeek(nextWeekIso)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground"><I.plus /> Next week ({plannerWeekLabel(nextWeekIso)})</button>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {sorted.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No weeks yet for {city} — create this week to get started.</div>}
        {sorted.map((w) => {
          const filled = PLANNER_CONTENT_SLOTS.filter((s) => w.picks[s]?.name).length;
          return (
            <button key={w.id} onClick={() => setOpenWeekId(w.id)} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium">{plannerWeekLabel(w.week)}</span>
                  {w.week === PLANNER_CURRENT_WEEK && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">This week</span>}
                  {w.week === nextWeekIso && <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-semibold text-muted">Next week</span>}
                  {w.sentDate && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600">Sent</span>}
                  {w.archived && <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-semibold text-muted">Archived</span>}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-muted">{w.themeOverride || "No theme yet"} · {filled}/{PLANNER_CONTENT_SLOTS.length} slots filled</span>
              </span>
              <I.chevron className="shrink-0 -rotate-90 text-muted" />
            </button>
          );
        })}
      </div>

      {/* The full year's seasonal theme plan (planner_theme_calendar) — read
          only here; a new week's theme/categories are pre-filled from this
          via themeForWeek, but the calendar itself isn't edited in-app. */}
      {themeCalendar.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border bg-surface shadow-soft">
          <button onClick={() => setCalendarOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Theme calendar</span>
            <I.chevron className={`text-muted transition-transform ${calendarOpen ? "" : "-rotate-90"}`} />
          </button>
          {calendarOpen && (
            <div className="divide-y border-t">
              {MONTH_NAMES.map((name, i) => {
                const entries = themeCalendar.filter((c) => c.month === i + 1).sort((a, b) => a.weekOfMonth - b.weekOfMonth);
                if (!entries.length) return null;
                return (
                  <div key={name} className="px-4 py-2.5">
                    <div className="mb-1 text-[12px] font-semibold text-foreground">{name}</div>
                    <div className="space-y-0.5">
                      {entries.map((e) => (
                        <div key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                          <span className="text-muted">Week {e.weekOfMonth}</span>
                          <span className="font-medium">{e.title}</span>
                          {e.categories.length > 0 && <span className="text-[12px] text-muted">· {e.categories.join(", ")}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shared search-or-free-text business picker — used by slots, sections, and
// events alike, so there's exactly one place defining how a business gets
// attached to something in the planner.
function toGdPlaceId(id: number | string): number | null {
  const n = typeof id === "number" ? id : parseInt(String(id), 10);
  return Number.isFinite(n) ? n : null;
}

function BusinessPicker({ listings, onPick, onCancel }: {
  listings: DirectoryListing[];
  onPick: (biz: PlannerBiz) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matches = ql ? listings.filter((l) => l.name.toLowerCase().includes(ql)).slice(0, 8) : [];
  const pickFromListing = (l: DirectoryListing) => {
    const gdPlaceId = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    onPick({ clientId: null, gdPlaceId: Number.isFinite(gdPlaceId) ? gdPlaceId : null, name: l.name, url: l.url ?? "", cat: l.category ?? "", note: "" });
  };
  return (
    <div className="relative">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        placeholder="Search businesses…" className="w-full rounded-lg border bg-background px-3 py-1.5 text-[14px] outline-none focus:border-accent" />
      {matches.length > 0 && (
        <div className="mt-1 overflow-hidden rounded-lg border bg-surface shadow-soft-md">
          {matches.map((l) => (
            <button key={l.id} onClick={() => pickFromListing(l)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-background">
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {l.category && <span className="shrink-0 text-[12px] text-muted">{l.category}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center gap-2">
        <button onClick={() => q.trim() && onPick({ clientId: null, gdPlaceId: null, name: q.trim(), url: "", cat: "", note: "" })} disabled={!q.trim()}
          className="text-[12px] font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline">Use “{q.trim() || "…"}” as free text</button>
        <button onClick={onCancel} className="text-[12px] font-medium text-muted hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

// Every field here already saves on change (each patch/onPatch call fires
// its upsert immediately) — this button doesn't change that, it just gives
// a deliberate click to confirm it, since "it just saves as you type" isn't
// always reassuring on its own.
function SaveConfirmButton() {
  const [saved, setSaved] = useState(false);
  return (
    <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }}
      className="mt-2 rounded-md border border-accent px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft">
      {saved ? "Saved ✓" : "Save"}
    </button>
  );
}

function WeekWorkspace({ week, weeks, listings, cityName, state, themeCalendar, onBack, onPatch, onDelete }: {
  week: PlannerWeek;
  weeks: PlannerWeek[]; // the territory's full week history, for rotation "due" status
  listings: DirectoryListing[];
  cityName: string;
  state: string;
  themeCalendar: ThemeCalendarEntry[];
  onBack: () => void;
  onPatch: (patch: PlannerWeekPatch) => void;
  onDelete: () => void;
}) {
  const [pickerSlot, setPickerSlot] = useState<PlannerSlot | null>(null);
  const [catInput, setCatInput] = useState("");
  const [themeOptions, setThemeOptions] = useState<{ title: string; description: string }[] | null>(null);
  const [themeLoading, setThemeLoading] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<string[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [sections, setSections] = useState<PlannerSection[]>([]);
  const [events, setEvents] = useState<PlannerEvent[]>([]);
  // Mirror the two lists so patchSection/patchEvent can build each whole-row
  // save from the latest value (see their comments). Kept in sync here for
  // loads/adds/removes, and updated synchronously inside the patchers.
  const sectionsRef = useRef<PlannerSection[]>([]);
  const eventsRef = useRef<PlannerEvent[]>([]);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  useEffect(() => { eventsRef.current = events; }, [events]);
  const [items, setItems] = useState<NewsletterItem[]>([]);
  // Collapsed by default; opened automatically once the fetch resolves if
  // this week (or the unscheduled backlog) actually has something queued.
  const [queueOpen, setQueueOpen] = useState(false);
  const [pickerSectionId, setPickerSectionId] = useState<string | null>(null);
  const [pickerEventId, setPickerEventId] = useState<string | null>(null);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<"idle" | "pushing" | "pushed" | "error">("idle");
  const [pushError, setPushError] = useState<string | null>(null);
  // Skips the auto-push effect's very first fire for a given week (which
  // otherwise trips the moment the section/event fetch above resolves,
  // pushing on mere navigation instead of a real edit).
  const skipNextAutoPush = useRef(true);

  useEffect(() => {
    let alive = true;
    skipNextAutoPush.current = true;
    Promise.all([fetchPlannerSections(week.id), fetchPlannerEvents(week.id), fetchNewsletterItems(week.territoryId)]).then(([s, e, allItems]) => {
      if (!alive) return;
      setSections(s); setEvents(e);
      const relevant = allItems.filter((it) => it.weekId === week.id || it.weekId === null);
      setItems(relevant);
      setQueueOpen(relevant.length > 0);
    });
    setBrief(null);
    setPushStatus("idle");
    return () => { alive = false; };
  }, [week.id, week.territoryId]);

  const pushNow = async () => {
    setPushStatus("pushing"); setPushError(null);
    const r = await pushPlannerWeek(week, sections, events);
    if (r.ok) { setPushStatus("pushed"); onPatch({ wpPushedAt: new Date().toISOString() }); }
    else { setPushStatus("error"); setPushError(r.error ?? "Push failed"); }
  };

  // Auto-push on every settled change, per the plan's "push on every
  // debounced save" call — the public archive already gates on ship-date,
  // so an early partial push has zero exposure; not gating this behind a
  // manual Publish avoids a rep forgetting and an issue silently not
  // shipping. Debounced so a burst of keystrokes doesn't hammer WordPress.
  useEffect(() => {
    if (skipNextAutoPush.current) { skipNextAutoPush.current = false; return; }
    const t = setTimeout(() => { pushNow(); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.picks, week.themeOverride, week.categories, week.notes, sections, events]);

  const setSlot = (slot: PlannerSlot, biz: PlannerBiz | null) => {
    const picks = { ...week.picks };
    if (biz) picks[slot] = biz; else delete picks[slot];
    onPatch({ picks });
    setPickerSlot(null);
  };

  const addCategory = () => {
    const c = catInput.trim();
    if (!c || week.categories.includes(c)) { setCatInput(""); return; }
    onPatch({ categories: [...week.categories, c] });
    setCatInput("");
  };
  const removeCategory = (c: string) => onPatch({ categories: week.categories.filter((x) => x !== c) });
  // Real GD categories that actually have listings behind them, with counts
  // — typing (or AI-suggesting) a category name in different wording from
  // the directory's own taxonomy is exactly what produced zero-match
  // categories live ("Indoor Recreation and Arcades", "Museums and Cultural
  // Centers" — neither shares a word with any real Lincoln category).
  // Picking straight from this list guarantees at least one match.
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of listings) {
      const c = (l.category || "").trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [listings]);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const filteredCategoryOptions = useMemo(() => {
    const q = catInput.trim().toLowerCase();
    const opts = q ? categoryOptions.filter(([c]) => c.toLowerCase().includes(q)) : categoryOptions;
    return opts.filter(([c]) => !week.categories.includes(c)).slice(0, 12);
  }, [categoryOptions, catInput, week.categories]);
  const pickCategoryOption = (c: string) => {
    if (!week.categories.includes(c)) onPatch({ categories: [...week.categories, c] });
    setCatInput("");
    setCatDropdownOpen(false);
  };

  const addSection = (type: string) => {
    const s: PlannerSection = { id: newId("psec_"), weekId: week.id, position: sections.length, type, text: "", biz: null };
    setSections((ss) => [...ss, s]);
    upsertPlannerSection(s);
  };
  // Same whole-row-replace hazard as patchWeek: typing a section's write-up
  // and then retitling it (or attaching a business) would each save a merge
  // built from the same pre-render `sections` snapshot, so the second write
  // erased the first. Ref is updated synchronously here, not just by the
  // effect, so same-tick edits build on each other.
  const patchSection = (id: string, patch: Partial<PlannerSection>) => {
    const cur = sectionsRef.current.find((x) => x.id === id);
    if (!cur) return;
    const merged: PlannerSection = { ...cur, ...patch };
    sectionsRef.current = sectionsRef.current.map((s) => (s.id === id ? merged : s));
    setSections(sectionsRef.current);
    upsertPlannerSection(merged);
  };
  const removeSection = (id: string) => { setSections((ss) => ss.filter((s) => s.id !== id)); deletePlannerSectionDb(id); };

  const addEvent = () => {
    const e: PlannerEvent = { id: newId("pev_"), weekId: week.id, position: events.length, text: "", biz: null };
    setEvents((es) => [...es, e]);
    upsertPlannerEvent(e);
  };
  const patchEvent = (id: string, patch: Partial<PlannerEvent>) => {
    const cur = eventsRef.current.find((x) => x.id === id);
    if (!cur) return;
    const merged: PlannerEvent = { ...cur, ...patch };
    eventsRef.current = eventsRef.current.map((e) => (e.id === id ? merged : e));
    setEvents(eventsRef.current);
    upsertPlannerEvent(merged);
  };
  const removeEvent = (id: string) => { setEvents((es) => es.filter((e) => e.id !== id)); deletePlannerEventDb(id); };

  const addBacklogItem = () => {
    const title = newItemTitle.trim();
    if (!title) return;
    const item: NewsletterItem = {
      id: newId("ni_"), territoryId: week.territoryId, type: "business", clientId: null, gdPlaceId: null,
      weekId: week.id, title, note: "", url: null, status: "pending", createdBy: null, createdAt: new Date().toISOString(),
    };
    setItems((its) => [item, ...its]);
    upsertNewsletterItem(item);
    setNewItemTitle("");
  };
  const removeBacklogItem = (id: string) => { setItems((its) => its.filter((it) => it.id !== id)); deleteNewsletterItemDb(id); };

  const generateBrief = () => {
    const briefListings = listings.map((l) => ({ name: l.name, category: l.category ?? "", claimed: l.claimed, hasOffer: l.hasOffer, offerTitle: undefined as string | undefined }));
    setBrief(generatePlannerBrief({ cityName, week, sections, events, listings: briefListings }));
  };
  const downloadBrief = () => {
    if (!brief) return;
    const blob = new Blob([brief], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `brief-${cityName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${week.week}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Every directory listing matching the week's theme categories, claimed or
  // not — the actual "who to invite" surface. Filling Spotlight/Hidden Gem
  // happens by inviting from this list and assigning accepted responses,
  // not from a separate AI-suggested candidate pool.
  const categoryMatches = useMemo(
    () => (week.categories.length === 0 ? [] : listings.filter((l) => matchesAnyCategory(l.category ?? "", week.categories))
      .sort((a, b) => (a.claimed === b.claimed ? a.name.localeCompare(b.name) : a.claimed ? 1 : -1))),
    [listings, week.categories]
  );
  // Per-pill match count — how many listings THIS specific theme category
  // matches on its own (unlike categoryMatches above, which is the union
  // across every selected category). Lets a zero-match pill (wrong
  // vocabulary, see categoryOptions above) be spotted at a glance instead
  // of only showing up as "the total didn't grow."
  const categoryPillCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of week.categories) map.set(c, listings.filter((l) => categoriesMatch(c, l.category ?? "")).length);
    return map;
  }, [week.categories, listings]);
  // Grouped by the listing's own real GD category (not the theme's category
  // tags — a different vocabulary, see categoryMatch.ts) so it's obvious how
  // many of each you actually have, not just a flat count. Biggest groups
  // first, alphabetical among ties.
  const categoryGroups = useMemo(() => {
    const map = new Map<string, DirectoryListing[]>();
    for (const l of categoryMatches) {
      const key = l.category || "Uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [categoryMatches]);
  // Same rotation history the Spotlight/Hidden Gem pool uses, keyed by name
  // — reused here to show "how many times featured" on the full list too.
  const featureCounts = useMemo(() => featureHistory(weeks), [weeks]);
  const inviteCounts = useMemo(() => inviteHistory(weeks), [weeks]);
  // Selection for bulk-invite on the category business list below — cleared
  // implicitly on every week switch since WeekWorkspace fully unmounts then
  // (PlannerPanel only ever renders it when a week is open, never keyed
  // across different weeks).
  const [selectedForInvite, setSelectedForInvite] = useState<Set<number>>(new Set());
  const [bulkInviting, setBulkInviting] = useState(false);
  const toggleSelectedForInvite = (gdPlaceId: number) =>
    setSelectedForInvite((s) => { const n = new Set(s); if (n.has(gdPlaceId)) n.delete(gdPlaceId); else n.add(gdPlaceId); return n; });
  // Most recent invited-entry for a listing in THIS week — mirrors the
  // "latest send wins" logic the webhook write-back uses server-side.
  const latestInviteFor = (gdPlaceId: number): PlannerInvite | null => {
    let latest: PlannerInvite | null = null;
    for (const inv of week.invited) if (inv.gdPlaceId === gdPlaceId) latest = inv;
    return latest;
  };
  // "Not using this business in this week's newsletter" — works whether or
  // not they've been invited yet, and is always reversible. Already-invited
  // businesses flip their invited entry's status (no dismissed-list entry
  // needed); never-invited ones go on `week.dismissed` — that field is
  // otherwise unused now that the AI candidate pool is gone, so it's a clean
  // fit rather than inventing a new one. A business is never in both states
  // at once, so these two branches never collide.
  const skipBusiness = (gdPlaceId: number) => {
    let idx = -1;
    week.invited.forEach((inv, i) => { if (inv.gdPlaceId === gdPlaceId) idx = i; });
    if (idx !== -1) onPatch({ invited: week.invited.map((inv, i) => (i === idx ? { ...inv, status: "skipped" as const } : inv)) });
    else if (!week.dismissed.includes(gdPlaceId)) onPatch({ dismissed: [...week.dismissed, gdPlaceId] });
  };
  const bringBackBusiness = (gdPlaceId: number) => {
    let idx = -1;
    week.invited.forEach((inv, i) => { if (inv.gdPlaceId === gdPlaceId) idx = i; });
    if (idx !== -1 && week.invited[idx].status === "skipped") onPatch({ invited: week.invited.map((inv, i) => (i === idx ? { ...inv, status: "invited" as const } : inv)) });
    else if (week.dismissed.includes(gdPlaceId)) onPatch({ dismissed: week.dismissed.filter((id) => id !== gdPlaceId) });
  };
  const assignListingToSlot = (l: DirectoryListing, slot: PlannerSlot) => {
    const gdPlaceId = toGdPlaceId(l.id);
    setSlot(slot, { clientId: null, gdPlaceId, name: l.name, url: l.url ?? "", cat: l.category ?? "", note: "" });
  };
  // Accepted-but-not-yet-in-a-slot — the "decide who to feature" shortlist,
  // separate from the full category list so responses don't get lost among
  // everyone who hasn't replied yet. Excludes anyone already placed in a
  // business slot this week (nothing to decide on there anymore).
  const acceptedUnassigned = useMemo(() => {
    const placedIds = new Set(
      (["spotlight", "gem", "gem2", "gem3"] as const).map((s) => week.picks[s]?.gdPlaceId).filter((id): id is number => id != null)
    );
    return categoryMatches.filter((l) => {
      const gdPlaceId = toGdPlaceId(l.id);
      if (gdPlaceId == null || placedIds.has(gdPlaceId)) return false;
      let latestStatus: string | undefined;
      for (const inv of week.invited) if (inv.gdPlaceId === gdPlaceId) latestStatus = inv.status;
      return latestStatus === "accepted";
    });
  }, [categoryMatches, week.picks, week.invited]);

  // Cross-week dedupe for Story/Events suggestions — a recurring event (a
  // weekly farmers market, say) has no "due" rotation logic like the
  // business pools do, so without this it'd get suggested and re-added
  // every week. Story headlines are already on `weeks` (picks.story); events
  // live in their own table, so the last ~8 weeks' worth get fetched here.
  const [recentEvents, setRecentEvents] = useState<PlannerEvent[]>([]);
  useEffect(() => {
    let alive = true;
    const recentWeekIds = [...weeks].sort((a, b) => b.week.localeCompare(a.week)).slice(0, 8).map((w) => w.id);
    fetchRecentPlannerEvents(recentWeekIds).then((es) => { if (alive) setRecentEvents(es); });
    return () => { alive = false; };
  }, [weeks]);
  const recentEventTitles = useMemo(() => [...new Set(recentEvents.map((e) => e.text.split("\n")[0]?.trim()).filter(Boolean))], [recentEvents]);
  const recentStoryHeadlines = useMemo(() => [...new Set(weeks.map((w) => w.picks.story?.name).filter((n): n is string => !!n))], [weeks]);

  // Invite-to-be-featured — proxies WordPress's own outreach/send action
  // (real GHL email, real contact upsert, logged on WP's own outreach
  // record). ClickUpTasks is just the trigger; nothing here is persisted
  // locally beyond this session's own feedback. gdPlaceId-only: WordPress
  // resolves the invite email from the GeoDirectory listing itself, so a
  // free-text pick with no listing has nothing to invite.
  const [inviteState, setInviteState] = useState<Partial<Record<number, "sending" | string>>>({});
  const [inviteArmed, setInviteArmed] = useState<number | null>(null);
  const humanizeInviteError = (err: string | undefined) =>
    err === "no_email" ? "No email on file for this listing."
    : err === "ghl_not_connected" ? "GoHighLevel isn't connected for this city yet."
    : err || "Invite failed.";
  // Sending again is allowed — a business might miss the first email, or a
  // rep might want to follow up. Every send appends its own {gdPlaceId, at}
  // entry (not deduped), so week.invited also doubles as a send count.
  // Split from the onPatch call so bulk-invite (below) can send several ids
  // in a row. Both callers append via onPatch's FUNCTION form, which derives
  // from the current row rather than the `week` prop captured before the
  // send — a real GHL email round-trip takes seconds, and two overlapping
  // invites (or a single invite landing mid-bulk) would otherwise each write
  // an `invited` array built without the other's entry, silently dropping a
  // send that actually went out.
  const postInvite = async (gdPlaceId: number): Promise<PlannerInvite | null> => {
    setInviteArmed(null);
    setInviteState((m) => ({ ...m, [gdPlaceId]: "sending" }));
    try {
      const res = await authedFetch("/api/planner/invite/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId: week.territoryId, week: week.week, gdPlaceId, themeDescription: week.themeDescription }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setInviteState((m) => { const n = { ...m }; delete n[gdPlaceId]; return n; });
        return { gdPlaceId, at: new Date().toISOString(), status: "invited" };
      }
      setInviteState((m) => ({ ...m, [gdPlaceId]: humanizeInviteError(j.error) }));
      return null;
    } catch (e) {
      setInviteState((m) => ({ ...m, [gdPlaceId]: e instanceof Error ? e.message : "Invite failed." }));
      return null;
    }
  };
  const sendInvite = async (gdPlaceId: number) => {
    const entry = await postInvite(gdPlaceId);
    if (entry) onPatch((w) => ({ invited: [...w.invited, entry] }));
  };
  // Bulk version — sends selected ids one at a time (a short stagger avoids
  // hammering the WP endpoint) and applies a single combined patch at the end.
  const inviteSelected = async () => {
    const ids = Array.from(selectedForInvite);
    if (ids.length === 0) return;
    setBulkInviting(true);
    const newEntries: PlannerInvite[] = [];
    for (const gdPlaceId of ids) {
      const entry = await postInvite(gdPlaceId);
      if (entry) newEntries.push(entry);
      await new Promise((r) => setTimeout(r, 250));
    }
    if (newEntries.length > 0) onPatch((w) => ({ invited: [...w.invited, ...newEntries] }));
    setBulkInviting(false);
    setSelectedForInvite(new Set());
  };
  // Two-click arm/confirm — mirrors WP's own caution around a button that
  // sends a real email, not just an in-app action. The button never
  // disappears after a successful send — only the persisted count (and the
  // label, "Invite" vs "Invite again") changes — so following up is just
  // clicking it again.
  const renderInvite = (gdPlaceId: number | null) => {
    if (gdPlaceId == null) return null;
    const state = inviteState[gdPlaceId];
    const count = week.invited.filter((x) => x.gdPlaceId === gdPlaceId).length;
    const countLabel = count > 0 ? <span className="text-[11px] font-medium text-emerald-600">Invited {count}×</span> : null;
    if (state === "sending") return <span className="flex shrink-0 items-center gap-1.5">{countLabel}<span className="text-[12px] text-muted">Sending…</span></span>;
    if (state) return (
      <span className="flex shrink-0 items-center gap-1.5">
        {countLabel}
        <span className="text-[11px] text-danger">{state}</span>
        <button onClick={() => setInviteState((m) => { const n = { ...m }; delete n[gdPlaceId]; return n; })} className="text-[12px] font-medium text-muted hover:text-foreground">Dismiss</button>
      </span>
    );
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        {countLabel}
        {inviteArmed === gdPlaceId
          ? <button onClick={() => sendInvite(gdPlaceId)} className="text-[12px] font-medium text-danger hover:underline">Confirm{count > 0 ? " resend" : ""}?</button>
          : <button onClick={() => setInviteArmed(gdPlaceId)} className="text-[12px] font-medium text-accent hover:underline">{count > 0 ? "✉️ Invite again" : "✉️ Invite"}</button>}
      </span>
    );
  };

  // Story + Events: real, live web search (Gemini google_search grounding),
  // not the deterministic pool above — genuinely new content this territory
  // has no data of its own for. Same suggest → accept/decline shape either
  // way; accept writes through the existing setSlot/upsertPlannerEvent paths.
  type StorySuggestion = { headline: string; summary: string; sourceUrl?: string; sourceName?: string };
  type EventSuggestion = { title: string; summary: string; startDate?: string; venue?: string; address?: string; sourceUrl?: string };
  const [storySuggestLoading, setStorySuggestLoading] = useState(false);
  const [storySuggestions, setStorySuggestions] = useState<StorySuggestion[] | null>(null);
  const [storySuggestError, setStorySuggestError] = useState<string | null>(null);
  const [eventsSuggestLoading, setEventsSuggestLoading] = useState(false);
  const [eventsSuggestions, setEventsSuggestions] = useState<EventSuggestion[] | null>(null);
  const [eventsSuggestError, setEventsSuggestError] = useState<string | null>(null);

  const suggestStory = async () => {
    setStorySuggestLoading(true); setStorySuggestions(null); setStorySuggestError(null);
    try {
      const res = await authedFetch("/api/ai/planner-workshop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest_story", cityName, state, excludeTitles: recentStoryHeadlines }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.suggestions)) setStorySuggestions(j.suggestions);
      else setStorySuggestError(j.error || "Search failed.");
    } catch (e) {
      setStorySuggestError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setStorySuggestLoading(false);
    }
  };
  const acceptStorySuggestion = (s: StorySuggestion) => {
    setSlot("story", { clientId: null, gdPlaceId: null, name: s.headline, url: s.sourceUrl ?? "", cat: "News", note: s.summary ?? "" });
    setStorySuggestions(null);
  };
  const declineStorySuggestion = (s: StorySuggestion) => setStorySuggestions((list) => (list ?? []).filter((x) => x !== s));

  // append=true (the "Find more" link) keeps whatever's already on screen and
  // asks Gemini to search for additional events beyond that list; the top
  // "Find events" button always starts fresh — useful to re-check throughout
  // the week as new events get posted online.
  const suggestEvents = async (append = false) => {
    const already = append ? (eventsSuggestions ?? []) : [];
    setEventsSuggestLoading(true); setEventsSuggestError(null);
    if (!append) setEventsSuggestions(null);
    try {
      const res = await authedFetch("/api/ai/planner-workshop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest_events", cityName, state, dateFrom: addDaysIso(week.week, -3), dateTo: addDaysIso(week.week, 3), excludeTitles: [...recentEventTitles, ...already.map((s) => s.title)] }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.suggestions)) setEventsSuggestions([...already, ...j.suggestions]);
      else setEventsSuggestError(j.error || "Search failed.");
    } catch (e) {
      setEventsSuggestError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setEventsSuggestLoading(false);
    }
  };
  const acceptEventSuggestion = (s: EventSuggestion) => {
    const text = [
      s.title,
      [s.startDate, [s.venue, s.address].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
      s.summary,
      s.sourceUrl,
    ].filter(Boolean).join("\n");
    const e: PlannerEvent = { id: newId("pev_"), weekId: week.id, position: events.length, text, biz: null };
    setEvents((es) => [...es, e]);
    upsertPlannerEvent(e);
    setEventsSuggestions((list) => (list ?? []).filter((x) => x !== s));
  };
  const declineEventSuggestion = (s: EventSuggestion) => setEventsSuggestions((list) => (list ?? []).filter((x) => x !== s));

  // Weather — same live-search suggest/accept/decline shape as Story/Events;
  // replaces plannerBrief's old hardcoded "(fill in at build time)" stub
  // once accepted. Single result, not a list, so no append/decline-one-of-many.
  type WeatherSuggestion = { summary: string; sourceUrl?: string };
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherSuggestion, setWeatherSuggestion] = useState<WeatherSuggestion | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const suggestWeather = async () => {
    setWeatherLoading(true); setWeatherSuggestion(null); setWeatherError(null);
    try {
      const res = await authedFetch("/api/ai/planner-workshop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest_weather", cityName, state, dateFrom: addDaysIso(week.week, -3), dateTo: addDaysIso(week.week, 3) }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.suggestions) && j.suggestions[0]) setWeatherSuggestion(j.suggestions[0]);
      else setWeatherError(j.error || "Search failed.");
    } catch (e) {
      setWeatherError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setWeatherLoading(false);
    }
  };
  const acceptWeather = () => { if (weatherSuggestion) onPatch({ weatherNote: weatherSuggestion.summary }); setWeatherSuggestion(null); };
  const declineWeather = () => setWeatherSuggestion(null);

  // Restore whatever suggestion batches were showing before a refresh —
  // skipNextDraftPersist mirrors skipNextAutoPush above: without it, the
  // persist effect's very first fire (this same commit, before hydrate's
  // setState calls have flushed) would see the still-empty initial state and
  // immediately wipe the cache this effect just read from.
  const skipNextDraftPersist = useRef(true);
  useEffect(() => {
    skipNextDraftPersist.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_CACHE_PREFIX + week.id);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.themeOptions) setThemeOptions(d.themeOptions);
      if (d.categorySuggestions) setCategorySuggestions(d.categorySuggestions);
      if (d.storySuggestions) setStorySuggestions(d.storySuggestions);
      if (d.eventsSuggestions) setEventsSuggestions(d.eventsSuggestions);
      if (d.weatherSuggestion) setWeatherSuggestion(d.weatherSuggestion);
    } catch {}
  }, [week.id]);
  useEffect(() => {
    if (skipNextDraftPersist.current) { skipNextDraftPersist.current = false; return; }
    try {
      const key = DRAFT_CACHE_PREFIX + week.id;
      const isEmpty = !themeOptions && !categorySuggestions && !storySuggestions && !eventsSuggestions && !weatherSuggestion;
      if (isEmpty) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ themeOptions, categorySuggestions, storySuggestions, eventsSuggestions, weatherSuggestion }));
    } catch {}
  }, [week.id, themeOptions, categorySuggestions, storySuggestions, eventsSuggestions, weatherSuggestion]);

  // "Draft this week" — fires every applicable suggest_* call in parallel for
  // whatever's still empty, so a rep reviews one batch of suggestions
  // instead of clicking each Suggest button in turn. Never auto-accepts
  // anything — same guiding/reviewing shape as every other suggest here,
  // just kicked off together. Respects whatever's already set (a pre-filled
  // calendar theme, a manually-typed note) rather than overwriting it.
  const [draftLoading, setDraftLoading] = useState(false);
  const draftWeek = async () => {
    setDraftLoading(true);
    const tasks: Promise<unknown>[] = [];
    if (!week.themeOverride.trim()) tasks.push(suggestThemes());
    else if (!categorySuggestions) tasks.push(suggestCategoriesFor(week.themeOverride, week.themeDescription || undefined));
    // Spotlight/Hidden Gem no longer auto-draft here — filling those is now
    // the category business list's job (invite → accept → assign to slot),
    // not an AI guess.
    if (!week.picks.story) tasks.push(suggestStory());
    tasks.push(suggestEvents(false));
    if (!week.weatherNote) tasks.push(suggestWeather());
    await Promise.allSettled(tasks);
    setDraftLoading(false);
  };

  // The theme calendar's raw assignment for this week — a seed for
  // suggest_theme, not something written to the week until a rep picks it.
  const assignedTheme = useMemo(() => themeForWeek(week.week, themeCalendar), [week.week, themeCalendar]);

  const suggestThemes = async () => {
    setThemeLoading(true); setThemeOptions(null); setThemeError(null); setCategorySuggestions(null);
    try {
      const [, m, d] = week.week.split("-").map(Number);
      const weekIndex = Math.min(5, Math.max(1, Math.ceil(d / 7)));
      const res = await authedFetch("/api/ai/planner-workshop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest_theme", cityName, state, month: m, weekIndex, assignedTitle: assignedTheme?.title, assignedCategories: assignedTheme?.categories }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.options)) setThemeOptions(j.options);
      else setThemeError(j.error || "Theme suggestion failed.");
    } catch (e) {
      setThemeError(e instanceof Error ? e.message : "Theme suggestion failed.");
    } finally {
      setThemeLoading(false);
    }
  };

  const chooseTheme = (opt: { title: string; description: string }) => {
    onPatch({ themeOverride: opt.title, themeDescription: opt.description });
    setThemeOptions(null);
    suggestCategoriesFor(opt.title, opt.description);
  };

  const suggestCategoriesFor = async (theme: string, themeDescription?: string) => {
    setCategoriesLoading(true); setCategorySuggestions(null); setCategoriesError(null);
    try {
      const res = await authedFetch("/api/ai/planner-workshop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest_categories", cityName, theme, themeDescription }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.categories)) setCategorySuggestions(j.categories);
      else setCategoriesError(j.error || "Category suggestion failed.");
    } catch (e) {
      setCategoriesError(e instanceof Error ? e.message : "Category suggestion failed.");
    } finally {
      setCategoriesLoading(false);
    }
  };

  const acceptCategorySuggestion = (c: string) => {
    if (!week.categories.includes(c)) onPatch({ categories: [...week.categories, c] });
    setCategorySuggestions((cs) => (cs ? cs.filter((x) => x !== c) : cs));
  };

  const weekItems = items.filter((it) => it.weekId === week.id);
  const backlogItems = items.filter((it) => it.weekId === null);

  return (
    <div className="pt-1">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-foreground"><I.chevron className="rotate-90" /> All weeks</button>
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="border-b bg-background/40 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="text-[15px] font-semibold">{plannerWeekLabel(week.week)}</span>
              {week.archived && <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-semibold text-muted">Archived</span>}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={draftWeek} disabled={draftLoading} title="Runs Suggest on everything still empty — theme, spotlight, gem, local news, events, weather — for you to review" className="rounded-md border border-accent px-2.5 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-40">{draftLoading ? "Drafting…" : "✨ Draft this week"}</button>
              <span title={pushError ?? undefined} className="text-[12px] text-muted">
                {pushStatus === "pushing" ? "Pushing to site…" : pushStatus === "pushed" ? "Pushed ✓" : pushStatus === "error" ? "Push failed" : week.wpPushedAt ? `Pushed ${new Date(week.wpPushedAt).toLocaleTimeString()}` : "Not pushed yet"}
              </span>
              <button onClick={pushNow} disabled={pushStatus === "pushing"} className="rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">Push now</button>
              {week.sentDate ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[12px] font-semibold text-emerald-600">Sent {week.sentDate}</span>
              ) : (
                <button onClick={() => { onPatch({ sentDate: todayIso() }); pushNow(); }} className="rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground">Mark sent</button>
              )}
              <button onClick={() => { onPatch({ archived: !week.archived }); pushNow(); }} className="rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground">{week.archived ? "Unarchive" : "Archive"}</button>
              <button onClick={generateBrief} className="rounded-md border border-accent px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">Generate brief</button>
            </div>
            {/* Kept apart from the routine action buttons above (its own
                flex item, with a divider) instead of sitting right next to
                Generate brief — a destructive, unrecoverable action is too
                easy to misclick when it's packed into the same tight
                button row. */}
            <span className="mx-1 hidden h-5 w-px bg-border sm:inline-block" />
            <button
              onClick={() => { if (window.confirm(`Delete "${plannerWeekLabel(week.week)}"? This can't be undone.`)) onDelete(); }}
              title="Delete this week" className="rounded-md p-1.5 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <input value={week.themeOverride} onChange={(e) => onPatch({ themeOverride: e.target.value })} placeholder="Theme (e.g. “Foodie favorites”)"
              className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-1.5 text-[14px] font-medium outline-none placeholder:text-muted focus:border-accent" />
            <button onClick={suggestThemes} disabled={themeLoading} title="Suggest themes for this week" className="shrink-0 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">{themeLoading ? "Thinking…" : "✨ Suggest themes"}</button>
          </div>
          <textarea value={week.themeDescription} onChange={(e) => onPatch({ themeDescription: e.target.value })} rows={2}
            placeholder="What this week's theme is about — the goal, who to feature, what kind of stories/events to look for…"
            className="mb-2 w-full resize-y rounded-lg border bg-surface px-3 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
          {themeError && <div className="mb-2 text-[12px] text-danger">{themeError}</div>}
          {themeOptions && (
            <div className="mb-2 space-y-1">
              {themeOptions.map((opt) => (
                <button key={opt.title} onClick={() => chooseTheme(opt)} className="block w-full rounded-md border bg-background px-2.5 py-1.5 text-left hover:bg-accent-soft/50">
                  <span className="block text-[13px] font-medium">{opt.title}</span>
                  <span className="block text-[12px] text-muted">{opt.description}</span>
                </button>
              ))}
              <button onClick={() => setThemeOptions(null)} className="text-[12px] font-medium text-muted hover:text-foreground">Dismiss</button>
            </div>
          )}
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {week.categories.map((c) => {
              const n = categoryPillCounts.get(c) ?? 0;
              return (
                <span key={c} title={`${n} matching listing${n === 1 ? "" : "s"}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${n === 0 ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent"}`}>
                  {c}
                  <span className="opacity-70">· {n}</span>
                  <button onClick={() => removeCategory(c)} className="hover:opacity-70"><I.close className="h-3 w-3" /></button>
                </span>
              );
            })}
            <div className="relative min-w-[120px] flex-1">
              <input value={catInput} onChange={(e) => setCatInput(e.target.value)} onFocus={() => setCatDropdownOpen(true)}
                onBlur={() => setTimeout(() => setCatDropdownOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); setCatDropdownOpen(false); } }}
                placeholder="+ Theme category" className="w-full rounded-md border-transparent bg-transparent px-1.5 py-0.5 text-[12px] outline-none placeholder:text-muted focus:border-accent focus:bg-surface" />
              {catDropdownOpen && filteredCategoryOptions.length > 0 && (
                <div className="absolute left-0 top-full z-10 mt-1 max-h-56 w-64 overflow-y-auto rounded-lg border bg-surface shadow-soft-md">
                  <div className="border-b px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Real categories with listings</div>
                  {filteredCategoryOptions.map(([c, n]) => (
                    <button key={c} onMouseDown={(e) => e.preventDefault()} onClick={() => pickCategoryOption(c)}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[13px] hover:bg-background">
                      <span className="truncate">{c}</span>
                      <span className="shrink-0 pl-2 text-[11px] text-muted">{n}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!categoriesLoading && !categorySuggestions && (
              <button onClick={() => suggestCategoriesFor(week.themeOverride)} disabled={!week.themeOverride.trim()} title="Suggest categories for this theme" className="shrink-0 text-[12px] font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline">✨ Suggest categories</button>
            )}
            {categoriesLoading && <span className="text-[12px] text-muted">Thinking…</span>}
          </div>
          {categoriesError && <div className="mb-2 text-[12px] text-danger">{categoriesError}</div>}
          {categorySuggestions && categorySuggestions.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {categorySuggestions.map((c) => (
                <button key={c} onClick={() => acceptCategorySuggestion(c)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-accent px-2 py-0.5 text-[12px] font-medium text-accent hover:bg-accent-soft"><I.plus className="h-3 w-3" /> {c}</button>
              ))}
              <button onClick={() => setCategorySuggestions(null)} className="text-[12px] font-medium text-muted hover:text-foreground">Dismiss</button>
            </div>
          )}
          <textarea value={week.notes} onChange={(e) => onPatch({ notes: e.target.value })} placeholder="Notes for this week…" rows={2}
            className="w-full resize-y rounded-lg border bg-surface px-3 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
        </div>

        {week.categories.length > 0 && (
          <div className="border-b bg-background/40 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Businesses in these categories ({categoryMatches.length})</span>
              <span className="flex items-center gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Claimed</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Unclaimed</span>
              </span>
            </div>
            {categoryMatches.length === 0 ? (
              <div className="text-[13px] text-muted">No directory listings match these categories yet.</div>
            ) : (
              <>
                {acceptedUnassigned.length > 0 && (
                  <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Accepted — ready to feature ({acceptedUnassigned.length})</div>
                    <div className="space-y-1">
                      {acceptedUnassigned.map((l) => (
                        <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{l.name}</span>
                          <button onClick={() => assignListingToSlot(l, "spotlight")} className="shrink-0 rounded-md border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent-soft">→ Spotlight</button>
                          <button onClick={() => assignListingToSlot(l, "gem")} className="shrink-0 rounded-md border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent-soft">→ Hidden Gem</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  {categoryGroups.map(([category, group]) => (
                    <div key={category}>
                      <div className="mb-1 text-[11px] font-semibold text-muted">{category} ({group.length})</div>
                      <div className="space-y-1">
                        {group.map((l) => {
                          const gdPlaceId = toGdPlaceId(l.id);
                          const featured = featureCounts.get(l.name.toLowerCase().trim());
                          const allTime = gdPlaceId != null ? inviteCounts.get(gdPlaceId) : undefined;
                          const thisWeek = gdPlaceId != null ? week.invited.filter((x) => x.gdPlaceId === gdPlaceId).length : 0;
                          const latest = gdPlaceId != null ? latestInviteFor(gdPlaceId) : null;
                          const status = latest ? (latest.status ?? "invited") : null;
                          const dismissedFlag = gdPlaceId != null && week.dismissed.includes(gdPlaceId);
                          const skipped = status === "skipped" || dismissedFlag;
                          const selected = gdPlaceId != null && selectedForInvite.has(gdPlaceId);
                          const statsLine = `this week ${thisWeek}× · all-time ${allTime?.invited ?? 0}× · accepted ${allTime?.accepted ?? 0} · skipped ${allTime?.skipped ?? 0} · featured ${featured?.count ?? 0}×`;
                          if (skipped) {
                            return (
                              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5 opacity-50">
                                <span className="min-w-0 flex-1 truncate text-[13px] font-medium line-through">{l.name}</span>
                                <span className="shrink-0 text-[11px] font-medium">Skipped — not used this newsletter</span>
                                {gdPlaceId != null && (
                                  <button onClick={() => bringBackBusiness(gdPlaceId)} className="shrink-0 text-[11px] font-semibold text-accent opacity-100 hover:underline">↺ Bring back</button>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                              {gdPlaceId != null && (
                                <button onClick={() => toggleSelectedForInvite(gdPlaceId)} title="Select for bulk invite"
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${selected ? "border-accent bg-accent text-white" : "border-border"}`}>
                                  {selected && <I.check />}
                                </button>
                              )}
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.claimed ? "bg-emerald-500" : "bg-amber-500"}`} title={l.claimed ? "Claimed" : "Unclaimed"} />
                              <span className="min-w-0 flex-1">
                                {l.url
                                  ? <a href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block truncate text-[13px] font-medium text-accent hover:underline">{l.name}</a>
                                  : <span className="block truncate text-[13px] font-medium">{l.name}</span>}
                                <span title={statsLine} className="block truncate text-[11px] text-muted">{statsLine}</span>
                              </span>
                              <span title={l.hasActiveEvents ? "Active event listing" : "No active event listing"} className={`shrink-0 ${l.hasActiveEvents ? "text-accent" : "text-muted/30"}`}><I.calendar /></span>
                              <span title={l.hasRecentPost ? "Recent blog post" : "No recent blog post"} className={`shrink-0 text-[13px] ${l.hasRecentPost ? "" : "opacity-25 grayscale"}`}>📝</span>
                              {status === "accepted" && <span className="shrink-0 text-[11px] font-semibold text-emerald-600">Accepted</span>}
                              <span className="flex shrink-0 items-center gap-1">
                                <button onClick={() => assignListingToSlot(l, "spotlight")} className="text-[11px] font-medium text-accent hover:underline">→ Spotlight</button>
                                <button onClick={() => assignListingToSlot(l, "gem")} className="text-[11px] font-medium text-accent hover:underline">→ Hidden Gem</button>
                              </span>
                              {status !== "accepted" && gdPlaceId != null && (
                                <button onClick={() => skipBusiness(gdPlaceId)} className="shrink-0 text-[11px] font-medium text-muted hover:text-foreground">Skip</button>
                              )}
                              {renderInvite(gdPlaceId)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedForInvite.size > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent-soft/50 px-2.5 py-1.5">
                    <span className="text-[12px] font-medium">{selectedForInvite.size} selected</span>
                    <button onClick={inviteSelected} disabled={bulkInviting}
                      className="rounded-md border border-accent px-2 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-40">{bulkInviting ? "Inviting…" : "✉️ Invite selected"}</button>
                    <button onClick={() => setSelectedForInvite(new Set())} className="text-[12px] font-medium text-muted hover:text-foreground">Clear</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {brief && (
          <div className="border-b bg-background/40 px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Brief preview</span>
              <div className="flex items-center gap-2">
                <button onClick={() => navigator.clipboard.writeText(brief).catch(() => {})} className="text-[12px] font-medium text-accent hover:underline">Copy</button>
                <button onClick={downloadBrief} className="text-[12px] font-medium text-accent hover:underline">Download .md</button>
                <button onClick={() => setBrief(null)} className="text-[12px] font-medium text-muted hover:text-foreground">Close</button>
              </div>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-surface p-3 text-[12px] leading-relaxed text-foreground">{brief}</pre>
          </div>
        )}

        <div className="divide-y">
          {/* Only one Hidden Gem slot is offered by default now — gem2/gem3
              stay hidden unless a week already has one filled (older weeks),
              so nothing existing disappears. Need more than one gem for a
              week? Use Sections instead — it already supports an arbitrary
              number of business-attached write-ups. */}
          {PLANNER_CONTENT_SLOTS.filter((slot) => (slot !== "gem2" && slot !== "gem3") || week.picks[slot]).map((slot) => {
            const biz = week.picks[slot];
            return (
              <div key={slot} className="p-4">
                <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{SLOT_LABELS[slot]}</div>
                {biz ? (
                  <div className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2">
                    <div className="min-w-0 flex-1">
                      {biz.url
                        ? <a href={biz.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[14px] font-medium text-accent hover:underline">{biz.name}</a>
                        : <div className="truncate text-[14px] font-medium">{biz.name}</div>}
                      {biz.cat && <div className="text-[12px] text-muted">{biz.cat}</div>}
                      <textarea value={biz.note} onChange={(e) => setSlot(slot, { ...biz, note: e.target.value })} placeholder="Note for this pick…" rows={1}
                        className="mt-1 w-full resize-y rounded-md border bg-surface px-2 py-1 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
                      {/* Picking them for the issue and letting them know are two
                          separate things — a rep may want to invite/notify a
                          business even after already slotting them in. */}
                      {PLANNER_BUSINESS_SLOTS.includes(slot) && <div className="mt-1.5">{renderInvite(biz.gdPlaceId)}</div>}
                    </div>
                    <button onClick={() => setSlot(slot, null)} title="Clear" className="shrink-0 rounded-md p-1 text-muted hover:bg-surface hover:text-danger"><I.close /></button>
                  </div>
                ) : pickerSlot === slot ? (
                  <BusinessPicker listings={listings} onPick={(biz2) => setSlot(slot, biz2)} onCancel={() => setPickerSlot(null)} />
                ) : (
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setPickerSlot(slot)} className="rounded-lg border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">+ Pick a business</button>
                      {slot === "story" && (
                        <button onClick={suggestStory} disabled={storySuggestLoading} className="rounded-lg border px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">{storySuggestLoading ? "Searching…" : "✨ Find local news"}</button>
                      )}
                    </div>
                    {slot === "story" && storySuggestError && <div className="mt-1.5 text-[12px] text-danger">{storySuggestError}</div>}
                    {slot === "story" && storySuggestions && (
                      <div className="mt-1.5 space-y-1.5">
                        {storySuggestions.length === 0 && <div className="text-[13px] text-muted">No local news found.</div>}
                        {storySuggestions.map((s) => (
                          <div key={s.headline} className="rounded-lg border bg-background px-3 py-2">
                            <div className="text-[13px] font-medium">{s.headline}</div>
                            <div className="mb-1 text-[12px] text-muted">{s.summary}</div>
                            {s.sourceUrl && (
                              <div className="mb-1.5 text-[11px]">
                                <span className="text-muted">Source: {s.sourceName || "Link"} — </span>
                                <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">View source ↗</a>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <button onClick={() => acceptStorySuggestion(s)} className="text-[12px] font-medium text-accent hover:underline">Accept</button>
                              <button onClick={() => declineStorySuggestion(s)} className="text-[12px] font-medium text-muted hover:text-foreground">Decline</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Custom sections — repeatable typed write-ups (preset types or a
            custom title), each with an optional attached business. */}
        <div className="border-t p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Sections</span>
            <select onChange={(e) => { if (e.target.value) { addSection(e.target.value === "__custom" ? "" : e.target.value); e.target.value = ""; } }} defaultValue=""
              className="rounded-lg border border-dashed bg-background px-3 py-1.5 text-[13px] font-medium text-muted outline-none hover:bg-surface hover:text-foreground">
              <option value="" disabled>+ Add section</option>
              {SECTION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value="__custom">Custom…</option>
            </select>
          </div>
          <div className="space-y-3">
            {sections.map((sec) => (
              <div key={sec.id} className="rounded-lg border bg-background p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <input value={sec.type} onChange={(e) => patchSection(sec.id, { type: e.target.value })} placeholder="Section title"
                    className="min-w-0 flex-1 rounded-md border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium outline-none placeholder:text-muted focus:border-accent focus:bg-surface" />
                  <button onClick={() => removeSection(sec.id)} title="Remove section" className="shrink-0 rounded-md p-1 text-muted hover:text-danger"><I.trash /></button>
                </div>
                <textarea value={sec.text} onChange={(e) => patchSection(sec.id, { text: e.target.value })} placeholder="Write-up…" rows={2}
                  className="mb-1.5 w-full resize-y rounded-md border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
                {sec.biz ? (
                  <div className="flex items-center gap-2 rounded-md border bg-surface px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{sec.biz.name}</span>
                    <button onClick={() => patchSection(sec.id, { biz: null })} title="Clear" className="shrink-0 text-muted hover:text-danger"><I.close className="h-3 w-3" /></button>
                  </div>
                ) : pickerSectionId === sec.id ? (
                  <BusinessPicker listings={listings} onPick={(biz) => { patchSection(sec.id, { biz }); setPickerSectionId(null); }} onCancel={() => setPickerSectionId(null)} />
                ) : (
                  <button onClick={() => setPickerSectionId(sec.id)} className="text-[12px] font-medium text-accent hover:underline">+ Attach a business</button>
                )}
              </div>
            ))}
            {sections.length === 0 && <div className="text-[13px] text-muted">No sections yet.</div>}
          </div>
          <SaveConfirmButton />
        </div>

        {/* Events — write-ups, each optionally tied to a business. */}
        <div className="border-t p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Events</span>
            <span className="flex items-center gap-2">
              <button onClick={() => suggestEvents(false)} disabled={eventsSuggestLoading} title="Fresh search — replaces the list below" className="text-[12px] font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline">{eventsSuggestLoading ? "Searching…" : "✨ Find events"}</button>
              <button onClick={addEvent} className="text-[12px] font-medium text-accent hover:underline">+ Add event</button>
            </span>
          </div>
          {eventsSuggestError && <div className="mb-2 text-[12px] text-danger">{eventsSuggestError}</div>}
          {eventsSuggestions && (
            <div className="mb-3 space-y-1.5">
              {eventsSuggestions.length === 0 && <div className="text-[13px] text-muted">No events found for this week.</div>}
              {eventsSuggestions.map((s) => (
                <div key={s.title} className="rounded-lg border bg-background p-3">
                  <div className="text-[13px] font-medium">{s.title}</div>
                  <div className="text-[12px] text-muted">{[s.startDate, [s.venue, s.address].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</div>
                  <div className="mb-1 text-[12px] text-muted">{s.summary}</div>
                  {s.sourceUrl && (
                    <div className="mb-1.5 text-[11px]">
                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">View source ↗</a>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button onClick={() => acceptEventSuggestion(s)} className="text-[12px] font-medium text-accent hover:underline">Accept</button>
                    <button onClick={() => declineEventSuggestion(s)} className="text-[12px] font-medium text-muted hover:text-foreground">Decline</button>
                  </div>
                </div>
              ))}
              <button onClick={() => suggestEvents(true)} disabled={eventsSuggestLoading} className="text-[12px] font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline">{eventsSuggestLoading ? "Searching…" : "Find more"}</button>
            </div>
          )}
          <div className="space-y-3">
            {events.map((ev) => (
              <div key={ev.id} className="rounded-lg border bg-background p-3">
                <div className="mb-1.5 flex items-start gap-2">
                  <textarea value={ev.text} onChange={(e) => patchEvent(ev.id, { text: e.target.value })} placeholder="Event write-up…" rows={2}
                    className="min-w-0 flex-1 resize-y rounded-md border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
                  <button onClick={() => removeEvent(ev.id)} title="Remove event" className="shrink-0 rounded-md p-1 text-muted hover:text-danger"><I.trash /></button>
                </div>
                {ev.biz ? (
                  <div className="flex items-center gap-2 rounded-md border bg-surface px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{ev.biz.name}</span>
                    <button onClick={() => patchEvent(ev.id, { biz: null })} title="Clear" className="shrink-0 text-muted hover:text-danger"><I.close className="h-3 w-3" /></button>
                  </div>
                ) : pickerEventId === ev.id ? (
                  <BusinessPicker listings={listings} onPick={(biz) => { patchEvent(ev.id, { biz }); setPickerEventId(null); }} onCancel={() => setPickerEventId(null)} />
                ) : (
                  <button onClick={() => setPickerEventId(ev.id)} className="text-[12px] font-medium text-accent hover:underline">+ Attach a business</button>
                )}
              </div>
            ))}
            {events.length === 0 && <div className="text-[13px] text-muted">No events yet.</div>}
          </div>
          <SaveConfirmButton />
        </div>

        {/* Weather — replaces plannerBrief's old hardcoded stub once accepted. */}
        <div className="border-t p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Weather</span>
            <button onClick={suggestWeather} disabled={weatherLoading} className="text-[12px] font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline">{weatherLoading ? "Searching…" : "✨ Get weather"}</button>
          </div>
          {weatherError && <div className="mb-2 text-[12px] text-danger">{weatherError}</div>}
          {weatherSuggestion && (
            <div className="mb-2 rounded-lg border bg-background p-3">
              <div className="mb-1 text-[13px]">{weatherSuggestion.summary}</div>
              {weatherSuggestion.sourceUrl && (
                <div className="mb-1.5 text-[11px]">
                  <a href={weatherSuggestion.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">View source ↗</a>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={acceptWeather} className="text-[12px] font-medium text-accent hover:underline">Accept</button>
                <button onClick={declineWeather} className="text-[12px] font-medium text-muted hover:text-foreground">Decline</button>
              </div>
            </div>
          )}
          {week.weatherNote ? (
            <div className="text-[13px] text-foreground">{week.weatherNote}</div>
          ) : !weatherSuggestion && <div className="text-[13px] text-muted">No forecast added yet.</div>}
        </div>

        {/* Newsletter backlog — items queued for this week, plus the
            unassigned "who to go after" backlog for visibility. Full queue
            management (adding from a business's own page) lands in a later
            phase; this is a minimal quick-add so the loop works end to end.
            Collapsed by default when there's nothing in it — it's easy to
            mistake for empty dead space otherwise. */}
        <div className="border-t p-4">
          <button onClick={() => setQueueOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Queued for this week{weekItems.length > 0 ? ` (${weekItems.length})` : ""}</span>
            <I.chevron className={`text-muted transition-transform ${queueOpen ? "" : "-rotate-90"}`} />
          </button>
          {queueOpen && (
            <div className="mt-2">
              <div className="mb-2 space-y-1.5">
                {weekItems.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{it.title}</span>
                    <button onClick={() => removeBacklogItem(it.id)} title="Remove" className="shrink-0 text-muted hover:text-danger"><I.close className="h-3 w-3" /></button>
                  </div>
                ))}
                {weekItems.length === 0 && <div className="text-[13px] text-muted">Nothing queued for this week yet — a general-purpose catch-all for anything to include that isn’t a slot pick or event (a video, offer, or one-off mention).</div>}
              </div>
              <div className="flex items-center gap-2">
                <input value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addBacklogItem(); }}
                  placeholder="Queue a business/item for this week…" className="min-w-0 flex-1 rounded-md border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
                <button onClick={addBacklogItem} disabled={!newItemTitle.trim()} className="shrink-0 rounded-md border border-accent px-2.5 py-1.5 text-[13px] font-medium text-accent disabled:opacity-40">Add</button>
              </div>
              {backlogItems.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Backlog (not yet scheduled) · {backlogItems.length}</div>
                  <div className="space-y-1.5">
                    {backlogItems.slice(0, 10).map((it) => (
                      <div key={it.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{it.title}</span>
                        <button onClick={() => upsertNewsletterItem({ ...it, weekId: week.id }).then(() => setItems((its) => its.map((x) => (x.id === it.id ? { ...x, weekId: week.id } : x))))}
                          className="shrink-0 text-[12px] font-medium text-accent hover:underline">Add to this week</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

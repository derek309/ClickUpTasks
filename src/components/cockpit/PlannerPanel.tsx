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
} from "@/lib/db";
import {
  PLANNER_CURRENT_WEEK, plannerWeekLabel, addDaysIso, todayIso, PLANNER_CONTENT_SLOTS, PLANNER_BUSINESS_SLOTS, playbookCompletion,
  type PlannerWeek, type PlannerSlot, type PlannerBiz, type PlannerSection, type PlannerEvent, type NewsletterItem, type Client, type Task,
} from "@/lib/data";
import { generatePlannerBrief } from "@/lib/plannerBrief";
import { pushPlannerWeek } from "@/lib/plannerPush";
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
// "Hidden Gem" is here as well as being a fixed slot above: the slot is the
// week's one headline gem, and this is how you add a second, third, nth one.
// Sections already carry an attached business and flow into the brief under
// their own heading, so an extra gem needs no new slot machinery.
const SECTION_PRESETS = ["Hidden Gem", "The Story", "New In Town", "Ask Your Concierge", "Last Call"];
// A batch of live-search suggestions is a paid, ~10-60s Gemini call — losing
// it to an accidental refresh mid-review means paying for it again. Cached
// per week in localStorage (same cut_-prefixed, try/catch convention used
// elsewhere in this app), not the database — it's a disposable draft, not
// data worth syncing across devices.
const DRAFT_CACHE_PREFIX = "cut_plannerDraft_";

export function PlannerPanel({ territoryId, city, state, initialWeekId, onWeekChange, clients, tasks }: {
  territoryId: string; city: string; state: string;
  // Deep-link support (Cockpit's URL sync) — initialWeekId seeds which week
  // opens on mount, onWeekChange mirrors every change back up so the URL
  // stays in sync. Both optional so this component still works standalone.
  initialWeekId?: string | null; onWeekChange?: (id: string | null) => void;
  // The full roster — used only to rank the "ready to feature" queue by
  // Playbook completion (see acceptedUnassigned below). Optional so this
  // component still works standalone; when omitted, that queue just falls
  // back to its underlying first-accepted order.
  clients?: Client[]; tasks?: Task[];
}) {
  const [weeks, setWeeks] = useState<PlannerWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [openWeekId, setOpenWeekId] = useState<string | null>(initialWeekId ?? null);
  useEffect(() => { onWeekChange?.(openWeekId); }, [openWeekId, onWeekChange]);
  // Business typeahead source for slot/section/event picks — the same city
  // fetch TerritoryDirectory already uses, cached here independently since
  // this view can be open without the Businesses tab ever having loaded it.
  const [listings, setListings] = useState<DirectoryListing[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setOpenWeekId(null);
    fetchPlannerWeeks(territoryId).then((ws) => { if (alive) { setWeeks(ws); setLoading(false); } });
    return () => { alive = false; };
  }, [territoryId]);

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
  // Lets an ambassador queue up as many future weeks as they want, one click
  // at a time — always steps forward from whatever the LATEST week already
  // is (not just "next week"), so repeated clicks build Aug 23, Aug 30, etc.
  // without ever needing to know today's date. Falls back to nextWeekIso
  // when there's nothing yet, so it still does something sensible from empty.
  const latestWeekIso = weeks.length ? [...weeks].map((w) => w.week).sort().at(-1)! : PLANNER_CURRENT_WEEK;
  const addAnotherWeek = () => createWeek(addDaysIso(latestWeekIso, 7));

  const createWeek = async (week: string) => {
    // themeOverride/categories stay empty — the theme model is gone (Aug 3
    // Derek/Justin call), so a new week has nothing to fill in up top before
    // working the auto-cycling queue below. The fields remain on PlannerWeek
    // for older weeks and for generatePlannerBrief, just unset going forward.
    const w: PlannerWeek = {
      id: newId("pw_"), territoryId, week, themeOverride: "", themeDescription: "", categories: [], notes: "", weatherNote: "",
      picks: {}, dismissed: [], invited: [], supportLocalExcluded: [], supportLocalAdded: [], archived: false, sentDate: null, wpPushedAt: null, createdAt: new Date().toISOString(),
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
  // prop captured before an await — see SlotInviteButton's onSent, where the
  // GHL send takes seconds and two overlapping sends would otherwise drop one.
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
      <WeekWorkspace week={openWeek} weeks={weeks} listings={listings} cityName={city} state={state} onBack={() => setOpenWeekId(null)}
        onPatch={(patch) => patchWeek(openWeek.id, patch)} onDelete={() => deleteWeek(openWeek.id)} clients={clients} tasks={tasks} />
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
        {/* Unlike the two above, this never hides — it always steps forward
            from the latest week that exists, so you can keep clicking to
            queue up as many future weeks as you want to get ahead. */}
        <button onClick={addAnotherWeek} title={`Creates ${plannerWeekLabel(addDaysIso(latestWeekIso, 7))}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground"><I.plus /> Add another week</button>
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
                <span className="mt-0.5 block truncate text-[13px] text-muted">{filled}/{PLANNER_CONTENT_SLOTS.length} slots filled</span>
              </span>
              <I.chevron className="shrink-0 -rotate-90 text-muted" />
            </button>
          );
        })}
      </div>
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

// Notifying a business that's already been picked for a slot is a separate
// action from picking them ("picking them for the issue and letting them
// know are two separate things" — a rep may want to invite/notify a
// business even after already slotting them in). Self-contained (not the
// shared queue machinery that moved to the Businesses page) since this only
// ever fires for the one business currently in a given slot.
function SlotInviteButton({ territoryId, week, gdPlaceId, count, onSent }: {
  territoryId: string; week: string; gdPlaceId: number; count: number; onSent: () => void;
}) {
  const [state, setState] = useState<"idle" | "armed" | "sending" | string>("idle");
  const send = async () => {
    setState("sending");
    try {
      const res = await authedFetch("/api/planner/invite/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId, week, gdPlaceId, themeDescription: "" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) { setState("idle"); onSent(); }
      else setState(j.error === "outside_business_hours" ? "Outside business hours (8am–6pm Mon–Fri)." : j.error || "Invite failed.");
    } catch (e) {
      setState(e instanceof Error ? e.message : "Invite failed.");
    }
  };
  if (state === "sending") return <span className="text-[12px] text-muted">Sending…</span>;
  if (state !== "idle" && state !== "armed") return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <span className="text-danger">{state}</span>
      <button onClick={() => setState("idle")} className="font-medium text-muted hover:text-foreground">Dismiss</button>
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      {count > 0 && <span className="font-medium text-emerald-600">Invited {count}×</span>}
      {state === "armed"
        ? <button onClick={send} className="font-medium text-danger hover:underline">Confirm{count > 0 ? " resend" : ""}?</button>
        : <button onClick={() => setState("armed")} className="font-medium text-accent hover:underline">{count > 0 ? "✉️ Let them know again" : "✉️ Let them know"}</button>}
    </span>
  );
}

function WeekWorkspace({ week, weeks, listings, cityName, state, onBack, onPatch, onDelete, clients, tasks }: {
  week: PlannerWeek;
  weeks: PlannerWeek[]; // the territory's full week history, for rotation "due" status
  listings: DirectoryListing[];
  cityName: string;
  state: string;
  onBack: () => void;
  onPatch: (patch: PlannerWeekPatch) => void;
  onDelete: () => void;
  // The full roster — used only to rank the "ready to feature" queue by
  // Playbook completion (see acceptedUnassigned below).
  clients?: Client[]; tasks?: Task[];
}) {
  const [pickerSlot, setPickerSlot] = useState<PlannerSlot | null>(null);
  const [slPickerOpen, setSlPickerOpen] = useState(false);
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
    const briefListings = listings.map((l) => ({ id: String(l.id), name: l.name, category: l.category ?? "", claimed: l.claimed, hasOffer: l.hasOffer }));
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

  // Same rotation history the old Spotlight/Hidden Gem pool used, keyed by
  // name/gdPlaceId — used only by the Spotlight/Hidden Gem "ready to
  // feature" shortlist below now; the invite queue itself (sending,
  // skipping, copy-link, the auto-invite preview) moved to the Businesses
  // page (TerritoryDirectory.tsx) — it's a continuous prospecting concern,
  // not a per-week newsletter one, and the funnel/stage grouping it belongs
  // next to already lives there.
  const assignListingToSlot = (l: DirectoryListing, slot: PlannerSlot) => {
    const gdPlaceId = toGdPlaceId(l.id);
    setSlot(slot, { clientId: null, gdPlaceId, name: l.name, url: l.url ?? "", cat: l.category ?? "", note: "" });
  };
  // A listing's client, found by its ghlContactId — either the id-derived
  // contact (Client.id === "cl_" + contactId) or an explicit
  // linkedContactId/linkedContactIds override (see Client's own doc comment
  // in data.ts). Used only to look up Playbook progress for the featured
  // queue below.
  const clientByContactId = useMemo(() => {
    const m = new Map<string, Client>();
    for (const c of clients ?? []) {
      if (c.id.startsWith("cl_")) m.set(c.id.slice(3), c);
      if (c.linkedContactId) m.set(c.linkedContactId, c);
      for (const id of c.linkedContactIds ?? []) m.set(id, c);
    }
    return m;
  }, [clients]);

  // Accepted-but-not-yet-in-a-slot — the "decide who to feature" shortlist,
  // the one place invites still touch the Planner: once a business accepts
  // (tracked on week.invited by the Businesses-page invite queue), it
  // graduates here to be assigned a slot. Gamified per the Aug 3
  // Derek/Justin call: the further a claimed business has progressed
  // through the Playbook, the higher it jumps in line for the featured
  // spotlight — on top of the underlying first-accepted order.
  const acceptedUnassigned = useMemo(() => {
    const placedIds = new Set(
      (["spotlight", "gem", "gem2", "gem3"] as const).map((s) => week.picks[s]?.gdPlaceId).filter((id): id is number => id != null)
    );
    const candidates = listings.filter((l) => {
      const gdPlaceId = toGdPlaceId(l.id);
      if (gdPlaceId == null || placedIds.has(gdPlaceId)) return false;
      let latestStatus: string | undefined;
      for (const inv of week.invited) if (inv.gdPlaceId === gdPlaceId) latestStatus = inv.status;
      return latestStatus === "accepted";
    });
    const pctFor = (l: DirectoryListing) => {
      const client = l.ghlContactId ? clientByContactId.get(l.ghlContactId) : undefined;
      return client ? playbookCompletion(client.id, tasks ?? []).pct : 0;
    };
    return [...candidates].sort((a, b) => pctFor(b) - pctFor(a));
  }, [listings, week.picks, week.invited, clientByContactId, tasks]);

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
        // Ship date forward, NOT the week's Sunday-Saturday label span. The
        // issue lands ON week.week (Wednesday), so the label's range starts
        // three days in the past — readers were being shown a "forecast" for
        // days that had already happened. Wed->Sun matches how Derek writes
        // it by hand and keeps the weekend, which is the part worth planning
        // around, in view.
        body: JSON.stringify({ mode: "suggest_weather", cityName, state, dateFrom: week.week, dateTo: addDaysIso(week.week, 4) }),
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
      if (d.storySuggestions) setStorySuggestions(d.storySuggestions);
      if (d.eventsSuggestions) setEventsSuggestions(d.eventsSuggestions);
      if (d.weatherSuggestion) setWeatherSuggestion(d.weatherSuggestion);
    } catch {}
  }, [week.id]);
  useEffect(() => {
    if (skipNextDraftPersist.current) { skipNextDraftPersist.current = false; return; }
    try {
      const key = DRAFT_CACHE_PREFIX + week.id;
      const isEmpty = !storySuggestions && !eventsSuggestions && !weatherSuggestion;
      if (isEmpty) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ storySuggestions, eventsSuggestions, weatherSuggestion }));
    } catch {}
  }, [week.id, storySuggestions, eventsSuggestions, weatherSuggestion]);

  // "Draft this week" — fires every applicable suggest_* call in parallel for
  // whatever's still empty, so a rep reviews one batch of suggestions
  // instead of clicking each Suggest button in turn. Never auto-accepts
  // anything — same guiding/reviewing shape as every other suggest here,
  // just kicked off together.
  const [draftLoading, setDraftLoading] = useState(false);
  const draftWeek = async () => {
    setDraftLoading(true);
    const tasks: Promise<unknown>[] = [];
    // Spotlight/Hidden Gem no longer auto-draft here — filling those is now
    // the category business list's job (invite → accept → assign to slot),
    // not an AI guess.
    if (!week.picks.story) tasks.push(suggestStory());
    tasks.push(suggestEvents(false));
    if (!week.weatherNote) tasks.push(suggestWeather());
    await Promise.allSettled(tasks);
    setDraftLoading(false);
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
          <textarea value={week.notes} onChange={(e) => onPatch({ notes: e.target.value })} placeholder="Notes for this week…" rows={2}
            className="w-full resize-y rounded-lg border bg-surface px-3 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
        </div>

        {/* The invite queue itself (sending, skipping, copy-link, the
            auto-invite preview) lives on the Businesses page now — it's a
            continuous prospecting concern tied to the funnel/stage
            grouping there, not a per-week newsletter decision. This is just
            the graduation point: once a business accepts, it shows up here
            to be assigned a slot. */}
        <div className="border-b bg-background/40 p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Accepted — ready to feature ({acceptedUnassigned.length})</div>
          {acceptedUnassigned.length === 0 ? (
            <div className="text-[13px] text-muted">Nobody&apos;s accepted an invite yet — send and track invites from the Businesses page.</div>
          ) : (
            <div className="space-y-1">
              {acceptedUnassigned.map((l) => {
                const client = l.ghlContactId ? clientByContactId.get(l.ghlContactId) : undefined;
                const pct = client ? playbookCompletion(client.id, tasks ?? []).pct : null;
                return (
                  <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{l.name}</span>
                    {pct != null && pct > 0 && (
                      <span title="Playbook completion — further along jumps the featured queue" className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">🚀 {pct}%</span>
                    )}
                    <button onClick={() => assignListingToSlot(l, "spotlight")} className="shrink-0 rounded-md border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent-soft">→ Spotlight</button>
                    <button onClick={() => assignListingToSlot(l, "gem")} className="shrink-0 rounded-md border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent-soft">→ Hidden Gem</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
              week? Add a "Hidden Gem" section below — it's a preset in the
              Add-section dropdown, and sections already support an arbitrary
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
                      {PLANNER_BUSINESS_SLOTS.includes(slot) && biz.gdPlaceId != null && (
                        <div className="mt-1.5">
                          <SlotInviteButton territoryId={week.territoryId} week={week.week} gdPlaceId={biz.gdPlaceId}
                            count={week.invited.filter((x) => x.gdPlaceId === biz.gdPlaceId).length}
                            onSent={() => onPatch((w) => ({ invited: [...w.invited, { gdPlaceId: biz.gdPlaceId!, at: new Date().toISOString(), status: "invited" as const }] }))} />
                        </div>
                      )}
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

        {/* Support Local — auto-populated (every claimed business with an
            active offer), so residents always see something to go claim
            regardless of the week's theme, but not a fixed list: an
            auto-included business can be hidden for this week (excluded, not
            deleted — it comes back if it still qualifies later), and any
            business can be added on top even if it doesn't otherwise qualify.
            Overrides live on the week itself (supportLocalExcluded/Added),
            not as their own deletable rows like the sections below. */}
        <div className="border-t p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Support Local</span>
            <button onClick={() => setSlPickerOpen((o) => !o)} className="rounded-lg border border-dashed px-2.5 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground">+ Add business</button>
          </div>
          {slPickerOpen && (
            <div className="mb-2">
              <BusinessPicker listings={listings} onCancel={() => setSlPickerOpen(false)}
                onPick={(biz) => { onPatch((w) => ({ supportLocalAdded: [...w.supportLocalAdded, biz] })); setSlPickerOpen(false); }} />
            </div>
          )}
          {(() => {
            const autoRows = listings.filter((l) => l.claimed && l.hasOffer && !week.supportLocalExcluded.includes(String(l.id)));
            const addedRows = week.supportLocalAdded;
            if (!autoRows.length && !addedRows.length) return <div className="text-[13px] text-muted">No claimed businesses with an active offer yet — add one above to feature something.</div>;
            return (
              <div className="flex flex-wrap gap-1.5">
                {autoRows.map((l) => (
                  <span key={`auto_${l.id}`} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[13px] font-medium">
                    {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{l.name}</a> : <span>{l.name}</span>}
                    <button onClick={() => onPatch((w) => ({ supportLocalExcluded: [...w.supportLocalExcluded, String(l.id)] }))} title="Hide this week" className="text-muted hover:text-danger">✕</button>
                  </span>
                ))}
                {addedRows.map((b, i) => (
                  <span key={`added_${i}`} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 py-1 text-[13px] font-medium text-accent">
                    {b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{b.name}</a> : <span>{b.name}</span>}
                    <button onClick={() => onPatch((w) => ({ supportLocalAdded: w.supportLocalAdded.filter((_, j) => j !== i) }))} title="Remove" className="text-accent/70 hover:text-danger">✕</button>
                  </span>
                ))}
              </div>
            );
          })()}
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

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
  fetchPlannerEvents, upsertPlannerEvent, deletePlannerEventDb,
  fetchNewsletterItems, upsertNewsletterItem, deleteNewsletterItemDb,
} from "@/lib/db";
import {
  PLANNER_CURRENT_WEEK, plannerWeekLabel, addDaysIso, todayIso, PLANNER_CONTENT_SLOTS,
  type PlannerWeek, type PlannerSlot, type PlannerBiz, type PlannerSection, type PlannerEvent, type NewsletterItem,
} from "@/lib/data";
import { generatePlannerBrief } from "@/lib/plannerBrief";
import { pushPlannerWeek } from "@/lib/plannerPush";
import { computePlannerPools, type PoolCandidate } from "@/lib/plannerPools";
import { I, newId } from "./ui";
import { type DirectoryListing } from "./TerritoryDirectory";

const SLOT_LABELS: Record<PlannerSlot, string> = {
  spotlight: "Business Spotlight",
  gem: "Hidden Gem",
  gem2: "Hidden Gem 2",
  gem3: "Hidden Gem 3",
  story: "The Story (local news)",
};
const SECTION_PRESETS = ["The Story", "New In Town", "Ask Your Concierge", "Last Call"];

export function PlannerPanel({ territoryId, city, state }: {
  territoryId: string; city: string; state: string;
}) {
  const [weeks, setWeeks] = useState<PlannerWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
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

  const createWeek = async (week: string) => {
    const w: PlannerWeek = {
      id: newId("pw_"), territoryId, week, themeOverride: "", categories: [], notes: "",
      picks: {}, dismissed: [], archived: false, sentDate: null, wpPushedAt: null, createdAt: new Date().toISOString(),
    };
    setWeeks((ws) => [w, ...ws]);
    await upsertPlannerWeek(w);
    setOpenWeekId(w.id);
  };

  const patchWeek = (id: string, patch: Partial<PlannerWeek>) => {
    setWeeks((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    const w = weeks.find((x) => x.id === id);
    if (w) upsertPlannerWeek({ ...w, ...patch });
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
      <WeekWorkspace week={openWeek} weeks={weeks} listings={listings} cityName={city} onBack={() => setOpenWeekId(null)}
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
    </div>
  );
}

// Shared search-or-free-text business picker — used by slots, sections, and
// events alike, so there's exactly one place defining how a business gets
// attached to something in the planner.
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
    onPick({ clientId: null, gdPlaceId: Number.isFinite(gdPlaceId) ? gdPlaceId : null, name: l.name, url: "", cat: l.category ?? "", note: "" });
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

function WeekWorkspace({ week, weeks, listings, cityName, onBack, onPatch, onDelete }: {
  week: PlannerWeek;
  weeks: PlannerWeek[]; // the territory's full week history, for rotation "due" status
  listings: DirectoryListing[];
  cityName: string;
  onBack: () => void;
  onPatch: (patch: Partial<PlannerWeek>) => void;
  onDelete: () => void;
}) {
  const [pickerSlot, setPickerSlot] = useState<PlannerSlot | null>(null);
  const [catInput, setCatInput] = useState("");
  const [sections, setSections] = useState<PlannerSection[]>([]);
  const [events, setEvents] = useState<PlannerEvent[]>([]);
  const [items, setItems] = useState<NewsletterItem[]>([]);
  const [pickerSectionId, setPickerSectionId] = useState<string | null>(null);
  const [pickerEventId, setPickerEventId] = useState<string | null>(null);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const [workshopPrompt, setWorkshopPrompt] = useState("");
  const [workshopLoading, setWorkshopLoading] = useState(false);
  const [workshopResult, setWorkshopResult] = useState<string | null>(null);
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
      setItems(allItems.filter((it) => it.weekId === week.id || it.weekId === null));
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

  const addSection = (type: string) => {
    const s: PlannerSection = { id: newId("psec_"), weekId: week.id, position: sections.length, type, text: "", biz: null };
    setSections((ss) => [...ss, s]);
    upsertPlannerSection(s);
  };
  const patchSection = (id: string, patch: Partial<PlannerSection>) => {
    setSections((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const s = sections.find((x) => x.id === id);
    if (s) upsertPlannerSection({ ...s, ...patch });
  };
  const removeSection = (id: string) => { setSections((ss) => ss.filter((s) => s.id !== id)); deletePlannerSectionDb(id); };

  const addEvent = () => {
    const e: PlannerEvent = { id: newId("pev_"), weekId: week.id, position: events.length, text: "", biz: null };
    setEvents((es) => [...es, e]);
    upsertPlannerEvent(e);
  };
  const patchEvent = (id: string, patch: Partial<PlannerEvent>) => {
    setEvents((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    const e = events.find((x) => x.id === id);
    if (e) upsertPlannerEvent({ ...e, ...patch });
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

  const filledSlotNames = PLANNER_CONTENT_SLOTS.map((s) => week.picks[s]?.name).filter(Boolean) as string[];
  const pools = useMemo(() => computePlannerPools({
    listings: listings.map((l) => ({ id: l.id, name: l.name, category: l.category ?? "", claimed: l.claimed, hasOffer: l.hasOffer, score: l.score })),
    weeks, dismissedIds: week.dismissed, excludeNames: filledSlotNames, todayIso: todayIso(),
  }), [listings, weeks, week.dismissed, filledSlotNames]);

  // Fills the first open business slot (spotlight, then gems in order) with
  // a suggested candidate — the same "Pick" shortcut the WordPress planner
  // offered from its own pool sidebar.
  const pickCandidate = (c: PoolCandidate) => {
    const target = (["spotlight", "gem", "gem2", "gem3"] as const).find((s) => !week.picks[s]);
    if (!target) return;
    setSlot(target, { clientId: null, gdPlaceId: c.gdPlaceId, name: c.name, url: "", cat: c.cat, note: "" });
  };
  const dismissCandidate = (c: PoolCandidate) => {
    if (c.gdPlaceId == null || week.dismissed.includes(c.gdPlaceId)) return;
    onPatch({ dismissed: [...week.dismissed, c.gdPlaceId] });
  };

  const runWorkshop = async (mode: "angles" | "draft" | "feature" | "ask") => {
    if (mode === "ask" && !workshopPrompt.trim()) return;
    setWorkshopLoading(true); setWorkshopResult(null);
    try {
      const res = await authedFetch("/api/ai/planner-workshop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, cityName, theme: week.themeOverride, categories: week.categories, notes: week.notes,
          filledSlots: filledSlotNames, candidateNames: [...pools.spotlight, ...pools.hiddenGem].map((c) => c.name),
          prompt: mode === "ask" ? workshopPrompt.trim() : undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      setWorkshopResult(res.ok && !j.error ? j.text : (j.error || "Workshop request failed."));
    } catch (e) {
      setWorkshopResult(e instanceof Error ? e.message : "Workshop request failed.");
    } finally {
      setWorkshopLoading(false);
    }
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
            <div className="flex items-center gap-1.5">
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
              <button onClick={onDelete} title="Delete this week" className="rounded-md p-1.5 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
            </div>
          </div>
          <input value={week.themeOverride} onChange={(e) => onPatch({ themeOverride: e.target.value })} placeholder="Theme (e.g. “Foodie favorites”)"
            className="mb-2 w-full rounded-lg border bg-surface px-3 py-1.5 text-[14px] font-medium outline-none placeholder:text-muted focus:border-accent" />
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {week.categories.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">
                {c}
                <button onClick={() => removeCategory(c)} className="hover:text-danger"><I.close className="h-3 w-3" /></button>
              </span>
            ))}
            <input value={catInput} onChange={(e) => setCatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
              placeholder="+ Theme category" className="min-w-[120px] flex-1 rounded-md border-transparent bg-transparent px-1.5 py-0.5 text-[12px] outline-none placeholder:text-muted focus:border-accent focus:bg-surface" />
          </div>
          <textarea value={week.notes} onChange={(e) => onPatch({ notes: e.target.value })} placeholder="Notes for this week…" rows={2}
            className="w-full resize-y rounded-lg border bg-surface px-3 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
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
          {PLANNER_CONTENT_SLOTS.map((slot) => {
            const biz = week.picks[slot];
            return (
              <div key={slot} className="p-4">
                <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{SLOT_LABELS[slot]}</div>
                {biz ? (
                  <div className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{biz.name}</div>
                      {biz.cat && <div className="text-[12px] text-muted">{biz.cat}</div>}
                      <textarea value={biz.note} onChange={(e) => setSlot(slot, { ...biz, note: e.target.value })} placeholder="Note for this pick…" rows={1}
                        className="mt-1 w-full resize-y rounded-md border bg-surface px-2 py-1 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
                    </div>
                    <button onClick={() => setSlot(slot, null)} title="Clear" className="shrink-0 rounded-md p-1 text-muted hover:bg-surface hover:text-danger"><I.close /></button>
                  </div>
                ) : pickerSlot === slot ? (
                  <BusinessPicker listings={listings} onPick={(biz2) => setSlot(slot, biz2)} onCancel={() => setPickerSlot(null)} />
                ) : (
                  <button onClick={() => setPickerSlot(slot)} className="rounded-lg border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">+ Pick a business</button>
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
            <span className="relative">
              <select onChange={(e) => { if (e.target.value) { addSection(e.target.value === "__custom" ? "" : e.target.value); e.target.value = ""; } }} defaultValue=""
                className="rounded-md border bg-background px-2 py-1 text-[12px] font-medium text-accent outline-none">
                <option value="" disabled>+ Add section</option>
                {SECTION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value="__custom">Custom…</option>
              </select>
            </span>
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
        </div>

        {/* Events — write-ups, each optionally tied to a business. */}
        <div className="border-t p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Events</span>
            <button onClick={addEvent} className="text-[12px] font-medium text-accent hover:underline">+ Add event</button>
          </div>
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
        </div>

        {/* Newsletter backlog — items queued for this week, plus the
            unassigned "who to go after" backlog for visibility. Full queue
            management (adding from a business's own page) lands in a later
            phase; this is a minimal quick-add so the loop works end to end. */}
        <div className="border-t p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Queued for this week</div>
          <div className="mb-2 space-y-1.5">
            {weekItems.map((it) => (
              <div key={it.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px]">{it.title}</span>
                <button onClick={() => removeBacklogItem(it.id)} title="Remove" className="shrink-0 text-muted hover:text-danger"><I.close className="h-3 w-3" /></button>
              </div>
            ))}
            {weekItems.length === 0 && <div className="text-[13px] text-muted">Nothing queued for this week yet.</div>}
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

        {/* Who to feature — computed live from the directory (claimed+offer
            for Spotlight, unclaimed-by-score for Hidden Gem) plus this
            territory's own feature-rotation history, instead of stored
            data. "Due" businesses (never featured, or not in 90+ days)
            sort first for Spotlight. */}
        <div className="border-t p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Who to feature</div>
          {(["spotlight", "hiddenGem"] as const).map((key) => {
            const list = pools[key];
            if (!list.length) return null;
            return (
              <div key={key} className="mb-3 last:mb-0">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted/70">{key === "spotlight" ? "Spotlight candidates (claimed, active offer)" : "Hidden Gem candidates (unclaimed, top-scored)"}</div>
                <div className="space-y-1">
                  {list.map((c) => (
                    <div key={`${key}-${c.gdPlaceId ?? c.name}`} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{c.name}</span>
                        <span className="block truncate text-[11px] text-muted">{c.cat}{c.due ? " · due" : c.lastFeatured ? ` · featured ${c.lastFeatured}` : ""}</span>
                      </span>
                      <button onClick={() => pickCandidate(c)} className="shrink-0 text-[12px] font-medium text-accent hover:underline">+ Pick</button>
                      <button onClick={() => dismissCandidate(c)} title="Not this week" className="shrink-0 text-muted hover:text-danger"><I.close className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {pools.spotlight.length === 0 && pools.hiddenGem.length === 0 && <div className="text-[13px] text-muted">No candidates found yet.</div>}
        </div>

        {/* AI Workshop — a co-pilot scoped to this week's context (theme,
            categories, notes, current picks, candidate pool). Never writes
            anything on its own; results are Copy/Append-only. */}
        <div className="border-t p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">AI Workshop</div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button onClick={() => runWorkshop("angles")} disabled={workshopLoading} className="rounded-md border px-2.5 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">Story angles</button>
            <button onClick={() => runWorkshop("feature")} disabled={workshopLoading} className="rounded-md border px-2.5 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">Who to feature</button>
            <button onClick={() => runWorkshop("draft")} disabled={workshopLoading} className="rounded-md border px-2.5 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">Draft copy</button>
          </div>
          <div className="flex items-center gap-1.5">
            <input value={workshopPrompt} onChange={(e) => setWorkshopPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runWorkshop("ask"); }}
              placeholder="Ask the Workshop…" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
            <button onClick={() => runWorkshop("ask")} disabled={workshopLoading || !workshopPrompt.trim()} className="shrink-0 rounded-md border border-accent px-2.5 py-1.5 text-[13px] font-medium text-accent disabled:opacity-40">Ask</button>
          </div>
          {(workshopLoading || workshopResult) && (
            <div className="mt-2 rounded-lg border bg-background p-3">
              {workshopLoading ? (
                <div className="text-[13px] text-muted">Thinking…</div>
              ) : (
                <>
                  <div className="whitespace-pre-wrap text-[13px]">{workshopResult}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => workshopResult && navigator.clipboard.writeText(workshopResult).catch(() => {})} className="text-[12px] font-medium text-accent hover:underline">Copy</button>
                    <button onClick={() => { if (workshopResult) onPatch({ notes: week.notes ? `${week.notes}\n\n${workshopResult}` : workshopResult }); setWorkshopResult(null); }} className="text-[12px] font-medium text-accent hover:underline">Append to notes</button>
                    <button onClick={() => setWorkshopResult(null)} className="text-[12px] font-medium text-muted hover:text-foreground">Dismiss</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

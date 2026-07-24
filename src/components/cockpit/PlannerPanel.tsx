"use client";

// Content Planner — the per-city weekly newsletter workflow, moved in from
// WordPress's /sales Content Planner tab. ClickUpTasks is now the source of
// truth (see supabase/planner.sql); WordPress becomes a push-target for the
// public "{City} Weekly" archive page only (Phase 4). Phase 2: week index +
// the core spotlight/gem/story picks editor. Sections/events (Phase 3) and
// the AI Workshop/candidate pools (Phase 5) aren't built yet.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { fetchPlannerWeeks, upsertPlannerWeek, deletePlannerWeekDb } from "@/lib/db";
import {
  PLANNER_CURRENT_WEEK, plannerWeekLabel, addDaysIso, PLANNER_CONTENT_SLOTS,
  type PlannerWeek, type PlannerSlot, type PlannerBiz,
} from "@/lib/data";
import { I, newId } from "./ui";
import { type DirectoryListing } from "./TerritoryDirectory";

const SLOT_LABELS: Record<PlannerSlot, string> = {
  spotlight: "Business Spotlight",
  gem: "Hidden Gem",
  gem2: "Hidden Gem 2",
  gem3: "Hidden Gem 3",
  story: "The Story (local news)",
};

export function PlannerPanel({ territoryId, city, state }: {
  territoryId: string; city: string; state: string;
}) {
  const [weeks, setWeeks] = useState<PlannerWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
  // Business typeahead source for slot picks — the same city fetch
  // TerritoryDirectory already uses, cached here independently since this
  // view can be open without the Businesses tab ever having loaded it.
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
      id: newId("pw_"), territoryId, week, themeOverride: "", notes: "",
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
      <WeekWorkspace week={openWeek} listings={listings} onBack={() => setOpenWeekId(null)}
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

function WeekWorkspace({ week, listings, onBack, onPatch, onDelete }: {
  week: PlannerWeek;
  listings: DirectoryListing[];
  onBack: () => void;
  onPatch: (patch: Partial<PlannerWeek>) => void;
  onDelete: () => void;
}) {
  const [pickerSlot, setPickerSlot] = useState<PlannerSlot | null>(null);
  const [q, setQ] = useState("");

  const setSlot = (slot: PlannerSlot, biz: PlannerBiz | null) => {
    const picks = { ...week.picks };
    if (biz) picks[slot] = biz; else delete picks[slot];
    onPatch({ picks });
    setPickerSlot(null); setQ("");
  };

  const pickFromListing = (slot: PlannerSlot, l: DirectoryListing) => {
    const gdPlaceId = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    setSlot(slot, { clientId: null, gdPlaceId: Number.isFinite(gdPlaceId) ? gdPlaceId : null, name: l.name, url: "", cat: l.category ?? "", note: "" });
  };

  const ql = q.trim().toLowerCase();
  const matches = ql ? listings.filter((l) => l.name.toLowerCase().includes(ql)).slice(0, 8) : [];

  return (
    <div className="pt-1">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-foreground"><I.chevron className="rotate-90" /> All weeks</button>
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="border-b bg-background/40 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[15px] font-semibold">{plannerWeekLabel(week.week)}</span>
            <div className="flex items-center gap-1.5">
              {week.sentDate && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[12px] font-semibold text-emerald-600">Sent {week.sentDate}</span>}
              <button onClick={onDelete} title="Delete this week" className="rounded-md p-1.5 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
            </div>
          </div>
          <input value={week.themeOverride} onChange={(e) => onPatch({ themeOverride: e.target.value })} placeholder="Theme (e.g. “Foodie favorites”)"
            className="mb-2 w-full rounded-lg border bg-surface px-3 py-1.5 text-[14px] font-medium outline-none placeholder:text-muted focus:border-accent" />
          <textarea value={week.notes} onChange={(e) => onPatch({ notes: e.target.value })} placeholder="Notes for this week…" rows={2}
            className="w-full resize-y rounded-lg border bg-surface px-3 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
        </div>
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
                  <div className="relative">
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setPickerSlot(null); setQ(""); } }}
                      placeholder="Search businesses…" className="w-full rounded-lg border bg-background px-3 py-1.5 text-[14px] outline-none focus:border-accent" />
                    {matches.length > 0 && (
                      <div className="mt-1 overflow-hidden rounded-lg border bg-surface shadow-soft-md">
                        {matches.map((l) => (
                          <button key={l.id} onClick={() => pickFromListing(slot, l)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-background">
                            <span className="min-w-0 flex-1 truncate">{l.name}</span>
                            {l.category && <span className="shrink-0 text-[12px] text-muted">{l.category}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => setSlot(slot, { clientId: null, gdPlaceId: null, name: q.trim(), url: "", cat: "", note: "" })} disabled={!q.trim()}
                      className="mt-1 text-[12px] font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline">Use “{q.trim() || "…"}” as free text</button>
                  </div>
                ) : (
                  <button onClick={() => setPickerSlot(slot)} className="rounded-lg border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">+ Pick a business</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

// The /sales-style directory view for a single territory (city). Live-fetches
// the ClickUpLocal directory (GeoDirectory) listings for the city from the
// WordPress side via /api/directory/listings and buckets the businesses the
// way the field-sales tool does:
//   • Claimed   — the owner has claimed their directory listing
//   • Unclaimed — a listing nobody has claimed yet (a prospect to call)
//   • No listing — a GHL contact in this city that matches no directory listing
// A matched business that we've already onboarded (a tracked client, i.e.
// clients.id === "cl_"+contactId) gets a ✓ Client badge on top of its bucket.
//
// Rendered as one card matching GroupedList's own chrome (rounded-xl border
// bg-surface shadow-soft, a column header row, colored collapsible group
// headers with a count pill) so this reads as the same list format as
// Tasks/Projects instead of a bespoke layout.
//
// When the directory isn't configured (the endpoint 501s before Derek sets the
// WP env vars) or errors, it degrades to showing every city contact under
// "No listing" — exactly the pre-directory behavior, just relabeled.
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { clientStatusMeta, type Contact, type Client } from "@/lib/data";
import { I } from "./ui";

export type DirectoryListing = {
  id: number | string;
  name: string;
  phone: string;
  email: string;
  city: string;
  street: string;
  claimed: boolean;
  hasOffer: boolean;
  score: number | null;
  category: string;
  // Outreach pipeline (from /sales — source of truth)
  outcome: string;
  outcomeLabel: string;
  nextAction: string;
  nextActionLabel: string;
  followupDue: number;  // unix seconds, 0 = none
  lastTouched: number;  // unix seconds, 0 = never
  rep: string;          // assigned ambassador's name (read-only here)
  ghlContactId: string; // links to the Prospects-pipeline opportunity
  activityLog?: ActivityEntry[]; // loaded on demand / after a touch
};

export type Stage = { id: string; name: string };
export type OppRef = { opportunityId: string; stageId: string };

export type ActivityEntry = {
  id: string;
  outcomeLabel: string;
  nextActionLabel: string;
  dateH: string;
  tsH: string;
  user: string;
  note: string;
  amountLabel: string;
};

// Mirrors the /sales vocabulary (cul_sales_outcomes / cul_sales_next_actions).
export const OUTCOMES: [string, string][] = [
  ["emailed", "Emailed"], ["called", "Called"], ["sms", "SMS'd"], ["visited", "Visited"],
  ["presented", "Appointment"], ["posted", "Posted"], ["won", "Won"], ["lost", "Lost"],
];
export const NEXT_ACTIONS: [string, string][] = [
  ["email", "Email"], ["call", "Call"], ["sms", "SMS"], ["visit", "Visit"], ["present", "Appointment"], ["close", "Close"],
];

// Returns { label, overdue }. Kept a module-scope helper (not computed in the
// component body) so its Date.now() read doesn't trip react-hooks/purity.
const fmtDue = (unix: number): { label: string; overdue: boolean } => {
  if (!unix) return { label: "", overdue: false };
  const days = Math.round((unix * 1000 - Date.now()) / 86400000);
  if (days < 0) return { label: `overdue ${-days}d`, overdue: true };
  if (days === 0) return { label: "due today", overdue: false };
  if (days === 1) return { label: "due tomorrow", overdue: false };
  return { label: `due in ${days}d`, overdue: false };
};

// Last 10 digits — normalizes (555) 123-4567 / +1 555 123 4567 / 5551234567 to
// the same key so a listing and a GHL contact match despite formatting.
const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

// Invisible guard, not a confirmation step: a double-click or drag to select
// the row's text (e.g. to copy a business name) still fires a click event on
// mouseup. Skip acting on it so that doesn't get mistaken for an intentional
// click — no dialog, no visible difference for a real click.
const isRealClick = () => !window.getSelection()?.toString();

type SortKey = "score" | "name";

// Group colors, same "colored strip" language GroupedList uses for status/
// priority groups (g.color + alpha suffix for background/border).
const BUCKET_META = {
  unclaimed: { label: "Unclaimed", color: "#f59e0b", hint: "listings nobody has claimed — prospects to call" },
  claimed: { label: "Claimed", color: "#10b981", hint: "owner has claimed their directory listing" },
  none: { label: "No listing", color: "#64748b", hint: "contacts in this city with no directory listing" },
} as const;

// Name | Score | Stage | Actions | Client
const TEMPLATE = "minmax(0,1fr) 56px 180px 210px 150px";

// Module-scope caches so leaving a city and coming back (or switching tabs)
// doesn't re-hit the network + show a loading flash every time — the same
// live data is still current for a minute, which covers normal in-session
// navigation. A lazy useState initializer reads these synchronously on
// mount, so a warm revisit renders immediately with no spinner.
const CACHE_TTL = 60_000;
type ListingsCacheEntry = { data: DirectoryListing[]; notConfigured: boolean; at: number };
const listingsCache = new Map<string, ListingsCacheEntry>();
type PipelineCacheEntry = { stages: Stage[]; byContact: Record<string, OppRef>; at: number };
let pipelineCache: PipelineCacheEntry | null = null;

export default function TerritoryDirectory({ city, state, contacts, clients, onAddContact, onOpenClient }: {
  city: string;
  state: string;
  contacts: Contact[];   // already scoped to this city/state by the caller
  clients: Client[];
  // Territory is a working view over what's already in GHL — no "add as
  // client" ceremony before you can open/journal a business. Both the name
  // click and the "+ Add as client" button call this same immediate action:
  // open if a client already exists for the matched contact, silently
  // create-and-open (as a Lead) if not.
  onAddContact: (contact: Contact) => void;
  onOpenClient: (clientId: string) => void;
}) {
  const cacheKey = `${city}|${state}`;
  const warm = () => { const c = listingsCache.get(cacheKey); return c && Date.now() - c.at < CACHE_TTL ? c : null; };
  const [listings, setListings] = useState<DirectoryListing[] | null>(() => warm()?.data ?? null);
  const [loading, setLoading] = useState(() => !warm());
  const [err, setErr] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(() => warm()?.notConfigured ?? false);
  const [sort, setSort] = useState<SortKey>("score");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  useEffect(() => {
    let alive = true;
    const cached = listingsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL) return; // still warm — nothing to fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setErr(null); setNotConfigured(false);
    const qs = new URLSearchParams({ city, state });
    authedFetch(`/api/directory/listings?${qs.toString()}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.status === 501) { setNotConfigured(true); setListings([]); listingsCache.set(cacheKey, { data: [], notConfigured: true, at: Date.now() }); return; }
        if (!res.ok) { setErr(body?.error || `Directory error ${res.status}`); setListings([]); return; }
        const data = Array.isArray(body.listings) ? body.listings : [];
        listingsCache.set(cacheKey, { data, notConfigured: false, at: Date.now() });
        setListings(data);
      })
      .catch((e) => { if (alive) { setErr(String(e?.message ?? e)); setListings([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [city, state, cacheKey]);

  // The GHL Prospects pipeline: ordered stages + a contactId → current-stage
  // map for every opportunity. Company-wide (not per-city), so it's cached
  // once and reused across every city for the same TTL window.
  const [stages, setStages] = useState<Stage[]>(() => pipelineCache?.stages ?? []);
  const [oppsByContact, setOppsByContact] = useState<Record<string, OppRef>>(() => pipelineCache?.byContact ?? {});
  useEffect(() => {
    let alive = true;
    if (pipelineCache && Date.now() - pipelineCache.at < CACHE_TTL) return; // still warm
    authedFetch("/api/directory/pipeline")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        const stagesRes = Array.isArray(body.stages) ? body.stages : [];
        const byContactRes = body.byContact && typeof body.byContact === "object" ? body.byContact : {};
        pipelineCache = { stages: stagesRes, byContact: byContactRes, at: Date.now() };
        setStages(stagesRes);
        setOppsByContact(byContactRes);
      })
      .catch(() => { /* funnel optional */ });
    return () => { alive = false; };
  }, []);

  const advanceStage = async (contactId: string, stageId: string, name: string) => {
    if (!contactId) return;
    const prev = oppsByContact[contactId];
    setOppsByContact((m) => ({ ...m, [contactId]: { opportunityId: prev?.opportunityId ?? "", stageId } })); // optimistic
    try {
      const res = await authedFetch("/api/directory/opportunity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId, stageId, name, opportunityId: prev?.opportunityId }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setOppsByContact((m) => {
          const merged = { ...m, [contactId]: { opportunityId: data.opportunityId, stageId: data.stageId } };
          if (pipelineCache) pipelineCache = { ...pipelineCache, byContact: merged, at: Date.now() }; // keep the cache current so a revisit shows this change
          return merged;
        });
      } else throw new Error(data?.error || `Error ${res.status}`);
    } catch {
      setOppsByContact((m) => { const n = { ...m }; if (prev) n[contactId] = prev; else delete n[contactId]; return n; }); // revert
    }
  };

  // Patch one listing in place after a logged touch returns the fresh state
  // from /sales — keeps the funnel accurate without a full refetch, and
  // writes through to the cache so a revisit within the TTL sees the change.
  const patchListing = (id: number | string, next: Partial<DirectoryListing>) =>
    setListings((ls) => {
      const updated = (ls ?? []).map((l) => (l.id === id ? { ...l, ...next } : l));
      const cached = listingsCache.get(cacheKey);
      if (cached) listingsCache.set(cacheKey, { ...cached, data: updated, at: Date.now() });
      return updated;
    });

  const clientIds = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);

  // Match each listing to a city contact (phone → email → name). A contact can
  // back at most one listing; first match wins. Track which contacts got
  // matched so the leftovers form the "No listing" bucket.
  const { rows, matchedContactIds } = useMemo(() => {
    const byPhone = new Map<string, Contact>();
    const byEmail = new Map<string, Contact>();
    const byName = new Map<string, Contact>();
    for (const c of contacts) {
      const p = digits(c.phone); if (p) byPhone.set(p, c);
      const e = lc(c.email); if (e) byEmail.set(e, c);
      const n = lc(c.name); if (n && !byName.has(n)) byName.set(n, c);
    }
    const matched = new Set<string>();
    const out = (listings ?? []).map((l) => {
      const c = byPhone.get(digits(l.phone)) ?? byEmail.get(lc(l.email)) ?? byName.get(lc(l.name)) ?? null;
      if (c) matched.add(c.id);
      const client = c && clientIds.has("cl_" + c.id) ? clients.find((cl) => cl.id === "cl_" + c.id) ?? null : null;
      return { listing: l, contact: c, client };
    });
    return { rows: out, matchedContactIds: matched };
  }, [listings, contacts, clients, clientIds]);

  // "No listing" = city contacts that matched no directory listing.
  const noListing = useMemo(() => contacts.filter((c) => !matchedContactIds.has(c.id)), [contacts, matchedContactIds]);

  const sortRows = <T extends { listing: DirectoryListing }>(arr: T[]) =>
    [...arr].sort((a, b) => sort === "name"
      ? a.listing.name.localeCompare(b.listing.name)
      : (b.listing.score ?? -1) - (a.listing.score ?? -1) || a.listing.name.localeCompare(b.listing.name));

  const claimed = sortRows(rows.filter((r) => r.listing.claimed));
  const unclaimed = sortRows(rows.filter((r) => !r.listing.claimed));
  const total = claimed.length + unclaimed.length + noListing.length;

  if (loading) return <div className="bg-background p-4 py-10 text-center text-[13px] text-muted sm:p-5">Loading directory for {city}…</div>;

  const groups: { key: keyof typeof BUCKET_META; count: number }[] = [
    { key: "unclaimed", count: unclaimed.length },
    { key: "claimed", count: claimed.length },
    { key: "none", count: noListing.length },
  ];

  return (
    <div className="pt-1">
      {/* No extra padding here — the parent (TerritoryPanel) already gives
          the page px-5/py-3, so this only needs a small top gap under its
          header, not a second full padding block. */}
      {/* Sort control — mirrors the sort-by affordance GroupedList's caller
          places above the table; groups themselves collapse individually
          instead of a separate bucket-filter row. */}
      <div className="mb-2 flex items-center justify-end">
        <span className="inline-flex overflow-hidden rounded-md border text-[12px]">
          {(["score", "name"] as const).map((k) => (
            <button key={k} onClick={() => setSort(k)} className={`px-2 py-1 font-medium ${sort === k ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface"}`}>{k === "score" ? "Score" : "A–Z"}</button>
          ))}
        </span>
      </div>

      {notConfigured && (
        <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800">
          Directory not connected yet — showing city contacts only. Set <code>CUL_WP_BASE_URL</code> + <code>CLICKUPTASKS_API_KEY</code> to pull listing/claimed status.
        </div>
      )}
      {err && <div className="mb-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">Couldn&apos;t load the directory: {err}</div>}

      <div className="overflow-x-auto rounded-xl border bg-surface shadow-soft">
        <div className="hidden items-center gap-2 border-b bg-background/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted sm:grid" style={{ gridTemplateColumns: TEMPLATE }}>
          <span>Name</span>
          <span className="text-center">Score</span>
          <span>Stage</span>
          <span>Actions</span>
          <span>Client</span>
        </div>
        <div className="divide-y-8 divide-background">
          {groups.map((g) => {
            const meta = BUCKET_META[g.key];
            const isOpen = !collapsed.has(g.key);
            return (
              <div key={g.key}>
                <button onClick={() => toggleGroup(g.key)} className="flex w-full items-center gap-2 border-y px-4 py-2 text-left transition" style={{ background: meta.color + "22", borderColor: meta.color + "40" }}>
                  <I.chevron className={`text-muted transition ${isOpen ? "-rotate-90" : "rotate-180"}`} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                  <span className="text-[15px] font-bold">{meta.label}</span>
                  <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: meta.color }}>{g.count}</span>
                  <span className="truncate text-[12px] font-normal normal-case text-muted">{meta.hint}</span>
                </button>
                {isOpen && g.key !== "none" && (g.key === "unclaimed" ? unclaimed : claimed).map((r) => (
                  <ListingRow key={r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient} onPatch={patchListing}
                    stages={stages} currentStageId={oppsByContact[r.listing.ghlContactId]?.stageId} onAdvance={advanceStage} />
                ))}
                {isOpen && g.key === "none" && noListing.map((c) => {
                  const client = clientIds.has("cl_" + c.id) ? clients.find((cl) => cl.id === "cl_" + c.id) ?? null : null;
                  return <NoListingRow key={c.id} contact={c} client={client} onAddContact={onAddContact} onOpenClient={onOpenClient} />;
                })}
              </div>
            );
          })}
        </div>
        {total === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No directory listings or contacts in {city} yet.</div>}
      </div>
    </div>
  );
}

// Reusable "sm:contents" split — on mobile the row stacks (name, then a wrap
// of the other fields); at sm+ it drops into the shared grid template. Same
// technique GroupedList's TaskRow uses.
function NoListingRow({ contact, client, onAddContact, onOpenClient }: {
  contact: Contact; client: Client | null; onAddContact: (c: Contact) => void; onOpenClient: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border-b px-4 py-2.5 text-[15px] transition-colors last:border-0 hover:bg-accent-soft/50 sm:grid sm:min-h-[42px] sm:items-center sm:gap-2 sm:py-1.5" style={{ gridTemplateColumns: TEMPLATE }}>
      <button onClick={() => { if (!isRealClick()) return; if (client) onOpenClient(client.id); else onAddContact(contact); }} title={client ? "Open this client" : "Open this business"}
        className="min-w-0 truncate text-left hover:text-accent hover:underline">
        {contact.name}{contact.company && <span className="text-muted/70"> · {contact.company}</span>}
      </button>
      <span className="hidden sm:block" />
      <span className="hidden sm:block" />
      <span className="hidden sm:block" />
      <div>
        {client
          ? <button onClick={() => onOpenClient(client.id)} className="rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">✓ Client</button>
          : <button onClick={() => onAddContact(contact)} className="rounded-md border border-dashed px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">+ Add as client</button>}
      </div>
    </div>
  );
}

function ListingRow({ row, onAddContact, onOpenClient, onPatch, stages, currentStageId, onAdvance }: {
  row: { listing: DirectoryListing; contact: Contact | null; client: Client | null };
  onAddContact: (c: Contact) => void;
  onOpenClient: (id: string) => void;
  onPatch: (id: number | string, next: Partial<DirectoryListing>) => void;
  stages: Stage[];
  currentStageId?: string;
  onAdvance: (contactId: string, stageId: string, name: string) => void;
}) {
  const { listing, contact, client } = row;
  const meta = client ? clientStatusMeta(client.status) : null;
  const [logOpen, setLogOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [followupDays, setFollowupDays] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [callMsg, setCallMsg] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [histLoading, setHistLoading] = useState(false);

  const due = fmtDue(listing.followupDue);
  const log = listing.activityLog;
  const expanded = logOpen || histOpen;

  const call = async () => {
    if (!listing.phone) { setCallMsg("No phone on file"); return; }
    setCalling(true); setCallMsg(null);
    try {
      const res = await authedFetch("/api/directory/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: String(listing.id) }) });
      const data = await res.json().catch(() => ({}));
      setCallMsg(res.ok && data?.ok ? "Calling… your phone rings first" : (data?.error || `Error ${res.status}`));
    } catch (e) {
      setCallMsg(String((e as Error)?.message ?? e));
    } finally {
      setCalling(false);
    }
  };

  const toggleHistory = async () => {
    const opening = !histOpen;
    setHistOpen(opening);
    if (opening && !log) {
      setHistLoading(true);
      try {
        const res = await authedFetch(`/api/directory/listing?listingId=${listing.id}`);
        const data = await res.json().catch(() => ({}));
        onPatch(listing.id, { activityLog: Array.isArray(data.activityLog) ? data.activityLog : [] });
      } catch { /* leave closed-empty on error */ }
      finally { setHistLoading(false); }
    }
  };

  const submit = async () => {
    if (!outcome && !nextAction && !followupDays.trim() && !note.trim()) { setLogOpen(false); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = { listingId: String(listing.id) };
      if (outcome) body.outcome = outcome;
      if (nextAction) body.nextAction = nextAction;
      if (note.trim()) body.note = note.trim();
      if (followupDays.trim()) body.followupDays = Number(followupDays) || 0;
      const res = await authedFetch("/api/directory/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { setError(data?.error || `Error ${res.status}`); return; }
      onPatch(listing.id, data.listing);
      setLogOpen(false); setOutcome(""); setNextAction(""); setFollowupDays(""); setNote("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`border-b text-[15px] transition-colors last:border-0 hover:bg-accent-soft/50 ${expanded ? "bg-accent-soft/30" : ""}`}>
      <div className="flex flex-col gap-1.5 px-4 py-2.5 sm:grid sm:min-h-[42px] sm:items-center sm:gap-2 sm:py-1.5" style={{ gridTemplateColumns: TEMPLATE }}>
        {/* Name + category + pipeline state chips */}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {listing.claimed
              ? <span title="Directory listing claimed" className="shrink-0 text-emerald-500"><I.check /></span>
              : <span title="Unclaimed listing" className="h-2 w-2 shrink-0 rounded-full border border-muted/50" />}
            {client ? (
              <button onClick={() => { if (isRealClick()) onOpenClient(client.id); }} title="Open this client"
                className="min-w-0 truncate text-left font-medium hover:text-accent hover:underline">{listing.name}</button>
            ) : contact ? (
              // Matched to a real GHL contact but no client yet — clicking
              // opens it immediately (silently creating one as a Lead), same
              // as the "+ Add as client" button. No confirm: being in GHL is
              // enough to work a business from here.
              <button onClick={() => { if (isRealClick()) onAddContact(contact); }} title="Open this business"
                className="min-w-0 truncate text-left font-medium hover:text-accent hover:underline">{listing.name}</button>
            ) : (
              <span className="min-w-0 truncate font-medium">{listing.name}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-5 text-[12px] text-muted">
            {listing.category && <span>{listing.category}</span>}
            {listing.outcomeLabel && <span className="rounded bg-background px-1.5 py-0.5 font-medium">{listing.outcomeLabel}</span>}
            {listing.nextActionLabel && <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">→ {listing.nextActionLabel}</span>}
            {due.label && <span className={due.overdue ? "font-medium text-danger" : ""}>{due.label}</span>}
            {listing.rep && <span>· {listing.rep}</span>}
            {callMsg && <span>· {callMsg}</span>}
          </div>
        </div>

        {/* Score */}
        <div className="pl-5 sm:pl-0 sm:text-center">
          {typeof listing.score === "number" && <span title="ClickUpLocal score" className="inline-block rounded bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted">{listing.score}</span>}
        </div>

        {/* Stage */}
        <div className="pl-5 sm:pl-0">
          {stages.length > 0 && listing.ghlContactId && (
            <select value={currentStageId ?? ""} onChange={(e) => e.target.value && onAdvance(listing.ghlContactId, e.target.value, listing.name)}
              title="Sales funnel stage (GHL Prospects pipeline)"
              className={`w-full max-w-[170px] rounded-md border px-1.5 py-1 text-[12px] font-medium outline-none focus:border-accent ${currentStageId ? "bg-accent-soft text-accent" : "bg-background text-muted"}`}>
              <option value="">Set stage…</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1.5 pl-5 sm:pl-0">
          {listing.phone && <button onClick={call} disabled={calling} title={`Bridge-call ${listing.phone}`} className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground disabled:opacity-40">{calling ? "…" : "Call"}</button>}
          <button onClick={toggleHistory} title="Outreach history" className={`shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium ${histOpen ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}>History</button>
          <button onClick={() => setLogOpen((o) => !o)} title="Log an outreach touch" className={`shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium ${logOpen ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}>Log</button>
        </div>

        {/* Client */}
        <div className="pl-5 sm:pl-0">
          {client && meta
            ? <button onClick={() => onOpenClient(client.id)} className="rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft"><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: meta.dot }} />✓ Client</button>
            : contact
              ? <button onClick={() => onAddContact(contact)} className="rounded-md border border-dashed px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">+ Add as client</button>
              : <span className="text-[11px] text-muted/60">no contact</span>}
        </div>
      </div>

      {/* Outreach history */}
      {histOpen && (
        <div className="space-y-1 border-t bg-background/40 px-4 py-2 pl-9 text-[12px]">
          {histLoading && <div className="text-muted">Loading history…</div>}
          {!histLoading && (!log || log.length === 0) && <div className="text-muted">No touches logged yet.</div>}
          {!histLoading && log && log.map((e) => (
            <div key={e.id} className="border-b border-border/60 pb-1 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {e.outcomeLabel && <span className="rounded bg-surface px-1.5 py-0.5 font-medium text-muted">{e.outcomeLabel}</span>}
                {e.nextActionLabel && <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">→ {e.nextActionLabel}</span>}
                {e.amountLabel && <span className="font-medium text-emerald-600">{e.amountLabel}</span>}
                <span className="ml-auto text-muted/70">{e.dateH}{e.user && ` · ${e.user}`}</span>
              </div>
              {e.note && <div className="mt-0.5 text-muted">{e.note}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Log-touch form */}
      {logOpen && (
        <div className="space-y-2 border-t bg-background/40 px-4 py-2 pl-9">
          <div className="flex flex-wrap gap-2">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="rounded-md border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent">
              <option value="">Outcome…</option>
              {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="rounded-md border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent">
              <option value="">Next action…</option>
              {NEXT_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={followupDays} onChange={(e) => setFollowupDays(e.target.value.replace(/\D/g, ""))} placeholder="Follow-up (days)" inputMode="numeric"
              className="w-32 rounded-md border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent" />
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-full rounded-md border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent" />
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setLogOpen(false)} className="rounded-md border px-2.5 py-1 text-[13px] font-medium hover:bg-surface">Cancel</button>
            <button onClick={submit} disabled={saving} className="rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-white disabled:opacity-40">{saving ? "Saving…" : "Log touch"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

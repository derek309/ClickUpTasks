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
import { clientStatusMeta, formatDue, isOverdue, STATUS_META, type Contact, type Client, type Task } from "@/lib/data";
import { I, Avatar } from "./ui";

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

// Name | Score | Stage | Tasks | Actions | Client
const TEMPLATE = "minmax(0,1fr) 56px 180px 104px 210px 150px";

// Module-scope cache so leaving a city and coming back (or switching tabs)
// shows the last-known data instantly instead of a loading flash — a lazy
// useState initializer reads it synchronously on mount. The fetch effect
// below always refreshes in the background on an interval, so the cache
// never really goes stale for long; it's just what renders while that
// background refresh is in flight.
const REFRESH_INTERVAL = 60_000;
type ListingsCacheEntry = { data: DirectoryListing[]; notConfigured: boolean; at: number };
const listingsCache = new Map<string, ListingsCacheEntry>();

// The GHL Prospects pipeline — the gameplan's locked 9-stage sales funnel
// (G2 SOP: New – Not Contacted → In Outreach → Engaged / Interested →
// Listing Claimed → First Visit Booked → In Trial → Won – Active, plus the
// Nurture and Lost off-ramps). Stages come live from GHL, so this list is
// whatever the pipeline says it is — never a hardcoded copy that can drift.
export type PipelineStage = { id: string; name: string };
export type OppRef = { opportunityId: string; stageId: string };
// One pipeline for every city (city-tagged, per the SOP), so this cache is
// module-scope and shared across territories rather than keyed per city.
let oppCache: { stages: PipelineStage[]; byContact: Record<string, OppRef>; at: number } | null = null;

export default function TerritoryDirectory({ city, state, contacts, clients, onAddContact, onSyncClients, onOpenClient, featuredClientIds, onFeature, sort, onSetSort, tasksByClient, onAddTask, onOpenTask }: {
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
  // Bulk auto-sync (see below). Optional so this component still degrades
  // gracefully if a caller doesn't wire it. Stage editing is NOT here: it
  // writes to the GHL Prospects pipeline via /api/directory/opportunity,
  // which this component owns directly (see the effect below).
  onSyncClients?: (contacts: Contact[]) => void;
  onOpenClient: (clientId: string) => void;
  // Newsletter feature motion (G2-SOP Stage 2/3). Optional so the admin
  // multi-city overview, which has no ambassador context, degrades to a
  // read-only list.
  featuredClientIds?: Set<string>;
  onFeature?: (opts: { clientId: string | null; contact: Contact | null; name: string; city: string; state: string }) => void;
  // Owned by the caller (TerritoryPanel) so the sort control can sit on the
  // same header line as the client/contact counts instead of its own row.
  sort: SortKey;
  onSetSort: (k: SortKey) => void;
  // Open tasks per business, keyed by client id. A city's businesses are all
  // clients already (see the bulk sync below), so their work exists — it just
  // wasn't visible from here without opening each one. Optional so the admin
  // multi-city overview degrades to the read-only list it is today.
  tasksByClient?: Map<string, Task[]>;
  onAddTask?: (clientId: string, title: string) => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const cacheKey = `${city}|${state}`;
  const warm = () => listingsCache.get(cacheKey);
  const [listings, setListings] = useState<DirectoryListing[] | null>(() => warm()?.data ?? null);
  const [loading, setLoading] = useState(() => !warm());
  const [err, setErr] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(() => warm()?.notConfigured ?? false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const [q, setQ] = useState("");
  const [stages, setStages] = useState<PipelineStage[]>(() => oppCache?.stages ?? []);
  const [oppByContact, setOppByContact] = useState<Record<string, OppRef>>(() => oppCache?.byContact ?? {});

  useEffect(() => {
    let alive = true;
    // A revisit with something already cached renders it instantly and
    // refreshes silently in the background (no spinner, no flash) — only a
    // true cold start (nothing cached yet for this city) blocks on the
    // "Loading directory…" state below.
    const fetchListings = (background: boolean) => {
      if (!background) { setLoading(true); setErr(null); setNotConfigured(false); }
      const qs = new URLSearchParams({ city, state });
      authedFetch(`/api/directory/listings?${qs.toString()}`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!alive) return;
          if (res.status === 501) { setNotConfigured(true); setListings((prev) => prev ?? []); listingsCache.set(cacheKey, { data: [], notConfigured: true, at: Date.now() }); return; }
          // A background refresh failing transiently shouldn't blow away
          // perfectly good data already on screen — only surface the error
          // (and clear the list) on a real foreground/cold load.
          if (!res.ok) { if (!background) { setErr((body?.error || `Directory error ${res.status}`) + (body?.detail ? ` — ${body.detail}` : "")); setListings([]); } return; }
          const data = Array.isArray(body.listings) ? body.listings : [];
          listingsCache.set(cacheKey, { data, notConfigured: false, at: Date.now() });
          setListings(data);
        })
        .catch((e) => { if (alive && !background) { setErr(String(e?.message ?? e)); setListings([]); } })
        .finally(() => { if (alive) setLoading(false); });
    };
    fetchListings(!!listingsCache.get(cacheKey));
    const interval = setInterval(() => fetchListings(true), REFRESH_INTERVAL);
    return () => { alive = false; clearInterval(interval); };
  }, [city, state, cacheKey]);

  // The Prospects pipeline (stages + who's in which stage). Deliberately its
  // own effect rather than folded into the listings fetch: it's one shared
  // pipeline across all cities, so it neither depends on nor should refetch
  // per city/state. Fails soft — a 501 (not configured) or an error just
  // leaves `stages` empty, which hides the Stage control instead of breaking
  // the whole territory view.
  useEffect(() => {
    let alive = true;
    const fetchOpps = () => {
      authedFetch("/api/directory/opportunity")
        .then(async (res) => {
          if (!res.ok) return;
          const body = await res.json().catch(() => ({}));
          if (!alive) return;
          const s: PipelineStage[] = Array.isArray(body.stages) ? body.stages : [];
          const b: Record<string, OppRef> = body.byContact ?? {};
          oppCache = { stages: s, byContact: b, at: Date.now() };
          setStages(s);
          setOppByContact(b);
        })
        .catch(() => { /* fail soft — Stage column just stays hidden */ });
    };
    fetchOpps();
    const interval = setInterval(fetchOpps, REFRESH_INTERVAL);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  // Move a business to a pipeline stage. Optimistic: the select reflects the
  // new stage immediately, and rolls back if GHL rejects it. Creates the
  // opportunity when the business isn't in the pipeline yet, which is how an
  // ambassador starts the funnel on an untouched listing from the field.
  const setStageFor = async (listing: DirectoryListing, stageId: string) => {
    const contactId = listing.ghlContactId;
    if (!contactId) return;
    const prev = oppByContact[contactId];
    const optimistic = { opportunityId: prev?.opportunityId ?? "", stageId };
    setOppByContact((m) => ({ ...m, [contactId]: optimistic }));
    try {
      const res = await authedFetch("/api/directory/opportunity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, stageId, name: listing.name, opportunityId: prev?.opportunityId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json().catch(() => ({}));
      const next: OppRef = { opportunityId: body.opportunityId ?? optimistic.opportunityId, stageId: body.stageId ?? stageId };
      setOppByContact((m) => {
        const updated = { ...m, [contactId]: next };
        if (oppCache) oppCache = { ...oppCache, byContact: updated };
        return updated;
      });
    } catch {
      // Roll back to whatever GHL last told us, so the UI never claims a
      // stage change that didn't land.
      setOppByContact((m) => {
        const updated = { ...m };
        if (prev) updated[contactId] = prev; else delete updated[contactId];
        return updated;
      });
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

  // Match each listing to a city contact — ghl_contact_id first (exact,
  // authoritative: WordPress already resolved and stores it per listing), then
  // phone → email → name as a fallback for listings that don't carry one yet.
  // The fallback chain alone isn't reliable: our synced `contacts` table is a
  // point-in-time snapshot, and a GHL-side contact merge can rewrite a
  // contact's phone/primary-email out from under it (a business's own contact
  // merged into an owner's personal one, business name → person name, its old
  // phone/email replaced) — exactly what happened to Claytown CrossFit,
  // silently un-matching an already-active client. ghlContactId is immune to
  // all of that: it's the same id on both sides regardless of what GHL did to
  // the contact's other fields.
  const { rows, matchedContactIds } = useMemo(() => {
    const byGhlId = new Map<string, Contact>();
    const byPhone = new Map<string, Contact>();
    const byEmail = new Map<string, Contact>();
    const byName = new Map<string, Contact>();
    for (const c of contacts) {
      if (c.ghlContactId) byGhlId.set(c.ghlContactId, c);
      const p = digits(c.phone); if (p) byPhone.set(p, c);
      const e = lc(c.email); if (e) byEmail.set(e, c);
      const n = lc(c.name); if (n && !byName.has(n)) byName.set(n, c);
    }
    const matched = new Set<string>();
    const out = (listings ?? []).map((l) => {
      const c = (l.ghlContactId && byGhlId.get(l.ghlContactId)) || byPhone.get(digits(l.phone)) || byEmail.get(lc(l.email)) || byName.get(lc(l.name)) || null;
      if (c) matched.add(c.id);
      const client = c && clientIds.has("cl_" + c.id) ? clients.find((cl) => cl.id === "cl_" + c.id) ?? null : null;
      return { listing: l, contact: c, client };
    });
    return { rows: out, matchedContactIds: matched };
  }, [listings, contacts, clients, clientIds]);

  // Every business actually in the ClickUpLocal directory for this city is
  // being worked in this territory — no manual "+ Add as client" step. Syncs
  // in bulk as a Lead the moment it's matched to a real GHL contact; once
  // `clients` reflects that (next render), the filter below is empty and
  // this settles — it does NOT include the "No listing" bucket (contacts
  // with no directory listing aren't "in the directory" yet).
  useEffect(() => {
    if (!onSyncClients) return;
    const toSync = rows.filter((r) => r.contact && !r.client).map((r) => r.contact!);
    if (toSync.length) onSyncClients(toSync);
  }, [rows, onSyncClients]);

  // "No listing" = city contacts that matched no directory listing.
  const noListing = useMemo(() => contacts.filter((c) => !matchedContactIds.has(c.id)), [contacts, matchedContactIds]);

  const sortRows = <T extends { listing: DirectoryListing }>(arr: T[]) =>
    [...arr].sort((a, b) => sort === "name"
      ? a.listing.name.localeCompare(b.listing.name)
      : (b.listing.score ?? -1) - (a.listing.score ?? -1) || a.listing.name.localeCompare(b.listing.name));

  // Free-text filter — by business/contact name, email, phone, or company.
  const ql = q.trim().toLowerCase();
  const qDigits = ql.replace(/\D/g, "");
  const matchRow = (r: { listing: DirectoryListing; contact: Contact | null }) => !ql
    || lc(r.listing.name).includes(ql)
    || (!!qDigits && digits(r.listing.phone).includes(qDigits))
    || (!!r.contact && (lc(r.contact.name).includes(ql) || lc(r.contact.email).includes(ql) || lc(r.contact.company).includes(ql) || (!!qDigits && digits(r.contact.phone).includes(qDigits))));
  const claimed = sortRows(rows.filter((r) => r.listing.claimed)).filter(matchRow);
  const unclaimed = sortRows(rows.filter((r) => !r.listing.claimed)).filter(matchRow);
  const total = claimed.length + unclaimed.length;
  // A territory business = a contact on the WordPress directory. Contacts with
  // no directory listing aren't businesses we prospect here (they're residents
  // / agency-side contacts), so they're deliberately NOT shown — just counted,
  // so nothing feels lost. (See noListing = contacts matching no listing.)
  const nonBusinessCount = noListing.length;

  if (loading) return <div className="bg-background p-4 py-10 text-center text-[13px] text-muted sm:p-5">Loading directory for {city}…</div>;

  const groups: { key: keyof typeof BUCKET_META; count: number }[] = [
    { key: "unclaimed", count: unclaimed.length },
    { key: "claimed", count: claimed.length },
  ];

  return (
    <div className="pt-1">
      {/* No extra padding here — the parent (TerritoryPanel) already gives
          the page px-5/py-3, so this only needs a small top gap under its
          header, not a second full padding block. The sort control lives in
          that same header row now (owned by TerritoryPanel), not here. */}

      {notConfigured && (
        <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800">
          Directory not connected yet — showing city contacts only. Set <code>CUL_WP_BASE_URL</code> + <code>CLICKUPTASKS_API_KEY</code> to pull listing/claimed status.
        </div>
      )}
      {err && (
        <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800">
          Directory listings are unavailable right now, so claimed/unclaimed status can&apos;t be shown — every contact below is grouped under &ldquo;No listing.&rdquo; You can still open and work them; the listing overlay returns once the directory is reachable. <span className="text-amber-800/60">({err})</span>
        </div>
      )}

      <div className="relative mb-2">
        <I.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${city} businesses…`}
          className="w-full rounded-lg border bg-surface py-1.5 pl-8 pr-8 text-[14px] outline-none focus:border-accent" />
        {q && <button onClick={() => setQ("")} title="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"><I.close /></button>}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-surface shadow-soft">
        <div className="hidden items-center gap-2 border-b bg-background/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted sm:grid" style={{ gridTemplateColumns: TEMPLATE }}>
          <span>Name</span>
          <span className="text-center">Score</span>
          <span>Stage</span>
          <span>Tasks</span>
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
                {isOpen && (g.key === "unclaimed" ? unclaimed : claimed).map((r) => (
                  <ListingRow key={r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient} onPatch={patchListing}
                    stages={stages} opp={oppByContact[r.listing.ghlContactId]} onSetStage={setStageFor}
                    featured={!!r.client && !!featuredClientIds?.has(r.client.id)}
                    canFeature={!!(r.client || r.contact)}
                    onFeature={onFeature && ((rr) => onFeature({ clientId: rr.client?.id ?? null, contact: rr.contact, name: rr.listing.name, city, state }))}
                    tasks={(r.client && tasksByClient?.get(r.client.id)) || []} onAddTask={onAddTask} onOpenTask={onOpenTask} />
                ))}
              </div>
            );
          })}
        </div>
        {total === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-muted">
            {ql ? `No businesses in ${city} match “${q}”.`
              : err ? `No directory businesses to show — the directory is unavailable right now.`
              : `No directory-listed businesses in ${city} yet.`}
          </div>
        )}
      </div>
      {nonBusinessCount > 0 && (
        <div className="mt-2 px-1 text-[12px] text-muted">
          {nonBusinessCount} other {nonBusinessCount === 1 ? "contact" : "contacts"} in {city} {nonBusinessCount === 1 ? "isn’t" : "aren’t"} on the business directory — those live on the agency side and aren’t shown here as territory prospects.
        </div>
      )}
    </div>
  );
}

function ListingRow({ row, onAddContact, onOpenClient, onPatch, stages, opp, onSetStage, featured, canFeature, onFeature, tasks, onAddTask, onOpenTask }: {
  row: { listing: DirectoryListing; contact: Contact | null; client: Client | null };
  onAddContact: (c: Contact) => void;
  onOpenClient: (id: string) => void;
  onPatch: (id: number | string, next: Partial<DirectoryListing>) => void;
  // The GHL Prospects pipeline for the Stage column: the ordered stages, this
  // business's current position (undefined = not in the pipeline yet), and the
  // mover.
  stages: PipelineStage[];
  opp?: OppRef;
  onSetStage: (listing: DirectoryListing, stageId: string) => void;
  // Newsletter feature motion: whether this business has already been run
  // through it, and the trigger that starts the Stage-3 touch sequence.
  featured: boolean;
  // False when nothing links this listing to GoHighLevel yet, so there's no
  // contact to hang a client (and therefore the tasks) off. Renders disabled
  // with a reason instead of a button that looks fine and does nothing.
  canFeature: boolean;
  onFeature?: (row: { listing: DirectoryListing; contact: Contact | null; client: Client | null }) => void;
  // This business's own open tasks (empty when it has no client row yet).
  tasks: Task[];
  onAddTask?: (clientId: string, title: string) => void;
  onOpenTask?: (taskId: string) => void;
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
  const [tasksOpen, setTasksOpen] = useState(false);
  const [newTask, setNewTask] = useState("");

  const due = fmtDue(listing.followupDue);
  const log = listing.activityLog;
  const expanded = logOpen || histOpen || tasksOpen;

  // Soonest due date across this business's open tasks — the one number worth
  // showing in a dense row, since "3 open" alone doesn't say whether anything
  // is late. Tasks with no due date never win the comparison.
  const openTasks = tasks.filter((t) => t.status !== "done");
  const nextDue = openTasks.reduce<string | null>((soonest, t) => (t.due && (!soonest || t.due < soonest) ? t.due : soonest), null);

  const addTask = () => {
    const title = newTask.trim();
    if (!title || !client || !onAddTask) return;
    onAddTask(client.id, title);
    setNewTask("");
  };

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

        {/* Stage — the GHL Prospects pipeline, i.e. the gameplan's locked
            9-stage sales funnel (G2 SOP). This is the outreach funnel, NOT
            the client lifecycle: these rows are directory businesses being
            worked, and GHL stays the source of truth for sales tracking. The
            client's own lifecycle (Lead → Active → Past) lives on the client
            header, where it belongs. Hidden when the pipeline isn't
            configured or the listing has no GHL contact to attach an
            opportunity to. */}
        <div className="pl-5 sm:pl-0">
          {stages.length > 0 && listing.ghlContactId ? (
            <select value={opp?.stageId ?? ""} onChange={(e) => onSetStage(listing, e.target.value)}
              title="Sales pipeline stage (GoHighLevel)" className="w-full max-w-[170px] rounded-md border px-1.5 py-1 text-[12px] font-medium outline-none focus:border-accent bg-accent-soft text-accent">
              {/* Not yet in the pipeline — picking any stage creates the
                  opportunity, so this placeholder is only ever the initial state. */}
              {!opp && <option value="">— not in pipeline —</option>}
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : null}
        </div>

        {/* Tasks — this business's own open work. Every matched business is
            already a client behind the scenes, so the tasks exist; this is
            what makes them visible without opening each business in turn. */}
        <div className="pl-5 sm:pl-0">
          {client && onAddTask ? (
            <button onClick={() => setTasksOpen((o) => !o)} title={openTasks.length ? `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}` : "No open tasks — click to add one"}
              className={`w-full rounded-md border px-2 py-1 text-left text-[12px] font-medium ${tasksOpen ? "bg-accent-soft text-accent" : openTasks.length ? "text-foreground hover:bg-surface" : "border-dashed text-muted hover:bg-surface hover:text-foreground"}`}>
              {openTasks.length ? `${openTasks.length} open` : "+ Task"}
              {nextDue && <span className={`ml-1 font-normal ${isOverdue(nextDue) ? "text-danger" : "text-muted"}`}>{formatDue(nextDue)}</span>}
            </button>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1.5 pl-5 sm:pl-0">
          {listing.phone && <button onClick={call} disabled={calling} title={`Bridge-call ${listing.phone}`} className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground disabled:opacity-40">{calling ? "…" : "Call"}</button>}
          <button onClick={toggleHistory} title="Outreach history" className={`shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium ${histOpen ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}>History</button>
          <button onClick={() => setLogOpen((o) => !o)} title="Log an outreach touch" className={`shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium ${logOpen ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}>Log</button>
          {/* The gameplan's opener: featuring the business is the give that
              earns the conversation, so this generates the whole Stage-3
              touch sequence rather than just tagging a row. */}
          {onFeature && (featured
            ? <span title="Already run through the newsletter feature motion" className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[12px] font-medium text-emerald-600">★ Featured</span>
            : <button onClick={() => onFeature(row)} disabled={!canFeature}
                title={canFeature ? "Feature in the newsletter — creates the Stage-3 outreach sequence" : "No GoHighLevel contact matched to this listing yet, so there's nothing to attach the sequence to"}
                className="shrink-0 rounded-md border border-dashed px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted">★ Feature</button>)}
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

      {/* This business's open tasks + one-line quick-add. Deliberately a
          read-and-add surface only — editing (assignee, due, checklist,
          comments) happens in the task itself, one click away, rather than
          rebuilding the task drawer inside a directory row. */}
      {tasksOpen && client && (
        <div className="space-y-1 border-t bg-background/40 px-4 py-2 pl-9 text-[13px]">
          {openTasks.length === 0 && <div className="text-[12px] text-muted">No open tasks for {listing.name} yet.</div>}
          {openTasks.map((t) => (
            <button key={t.id} onClick={() => onOpenTask?.(t.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_META[t.status].dot }} />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.due && <span className={`shrink-0 text-[12px] ${isOverdue(t.due) ? "font-medium text-danger" : "text-muted"}`}>{formatDue(t.due)}</span>}
              {t.assigneeId && <Avatar id={t.assigneeId} size={18} />}
            </button>
          ))}
          {/* Enter commits; deliberately NOT onBlur — these rows sit in a
              dense list where clicking away is the normal way to abandon a
              half-typed thought, and committing there creates junk tasks. */}
          <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
            placeholder="Add a task…  ↵" className="mt-1 w-full rounded-md border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent" />
        </div>
      )}

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

"use client";

// The /sales-style directory view for a single territory (city). Live-fetches
// the ClickUpLocal directory (GeoDirectory) listings for the city from the
// WordPress side via /api/directory/listings, matches each listing to a GHL
// contact/client, and groups them by where they actually are in the Playbook
// journey — Unclaimed → Invited → Claimed → Onboarding → Active Client →
// Nurture/Cancelled/Past Client — so opening this page reads as "here's the
// whole funnel, here's who needs work today," not a flat list.
//
// Rendered as one card matching GroupedList's own chrome (rounded-xl border
// bg-surface shadow-soft, a column header row, colored collapsible group
// headers with a count pill) so this reads as the same list format as
// Tasks/Projects instead of a bespoke layout.
//
// When the directory isn't configured (the endpoint 501s before Derek sets the
// WP env vars) or errors, it degrades to showing every city contact under
// "Unclaimed" — exactly the pre-directory behavior, just relabeled.
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { fetchPlannerWeeks } from "@/lib/db";
import { latestInviteStatus } from "@/lib/plannerPools";
import {
  formatDue, isOverdue, STATUS_META, playbookCompletion, salesCompletion,
  CLIENT_STATUS_META, CLIENT_STATUS_ORDER,
  type Contact, type Client, type ClientStatus, type Task, type PlannerInvite,
} from "@/lib/data";
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
  hasActiveEvents: boolean;
  // Wired through from WordPress's has_recent_post — false everywhere until
  // the Phase 2 WP work (post-to-listing linking) ships; safe default either way.
  hasRecentPost: boolean;
  url: string; // public listing page — "" if CUL_WP_BASE_URL isn't configured
  score: number | null;
  category: string;
  rep: string;          // assigned ambassador's name (read-only here)
  ghlContactId: string; // links to the GoHighLevel contact record
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

// The funnel every business is walked through, in order. Everyone always sits
// in exactly one of these — this is the Businesses page's whole reason for
// being: see where everyone is, and get everyone to Active Client.
//   Unclaimed  — listing nobody has claimed yet
//   Invited    — invited to claim it (Content Planner outreach), hasn't yet
//   Claimed    — claimed the listing, but not yet moved past Lead/Prospect
//   Onboarding / Active Client / Nurture / Cancelled / Past Client — the
//   client record's own lifecycle (ClientStatus), once a real client exists.
export type BusinessStage = "unclaimed" | "invited" | "claimed" | "onboarding" | "active_client" | "nurture" | "cancelled" | "past_client";
export const STAGE_ORDER: BusinessStage[] = ["unclaimed", "invited", "claimed", "onboarding", "active_client", "nurture", "cancelled", "past_client"];
export const STAGE_META: Record<BusinessStage, { label: string; color: string; hint: string }> = {
  unclaimed: { label: "Unclaimed", color: "#f59e0b", hint: "listing nobody has claimed yet — a prospect to invite or call" },
  invited: { label: "Invited", color: "#0ea5e9", hint: "invited to claim their listing, hasn't yet" },
  claimed: { label: "Claimed", color: "#10b981", hint: "claimed their listing, not yet moved past Lead/Prospect" },
  onboarding: { label: CLIENT_STATUS_META.onboarding.label, color: CLIENT_STATUS_META.onboarding.dot, hint: "actively being onboarded" },
  active_client: { label: CLIENT_STATUS_META.active_client.label, color: CLIENT_STATUS_META.active_client.dot, hint: "up and running — the goal state" },
  nurture: { label: CLIENT_STATUS_META.nurture.label, color: CLIENT_STATUS_META.nurture.dot, hint: "good standing, nothing actively due" },
  cancelled: { label: CLIENT_STATUS_META.cancelled.label, color: CLIENT_STATUS_META.cancelled.dot, hint: "cancelled engagement" },
  past_client: { label: CLIENT_STATUS_META.past_client.label, color: CLIENT_STATUS_META.past_client.dot, hint: "wrapped up" },
};
// The override group above the funnel: a business whose client has an open
// "conversation"-priority task — the exact same signal that bumps a client to
// the top of the Dashboard (Cockpit.tsx's hasOpenConversationTask). A business
// here ALSO still appears in its normal stage group below, so per-stage
// funnel counts stay a truthful pipeline snapshot.
const ATTENTION_META = { label: "Needs attention now", color: "#8b5cf6", hint: "replied by SMS, email, or newsletter invite — check in before anything else" };

export function computeBusinessStage(listing: DirectoryListing, client: Client | null, invite?: PlannerInvite): BusinessStage {
  if (!listing.claimed) return invite && invite.status !== "skipped" ? "invited" : "unclaimed";
  if (!client || client.status === "lead" || client.status === "prospect") return "claimed";
  return (client.status as BusinessStage);
}

// Name | Category | Stage | Links — "What's left" gets its own full-width
// line below this row (see ListingRow) rather than a cramped grid column;
// it wraps unpredictably depending on how much progress/next-step text a
// business has, and squeezed into ~250px it read as an afterthought instead
// of the primary reason to open the row.
const TEMPLATE = "minmax(0,1fr) 112px 148px 84px";

// Module-scope cache so leaving a city and coming back (or switching tabs)
// shows the last-known data instantly instead of a loading flash — a lazy
// useState initializer reads it synchronously on mount. The fetch effect
// below always refreshes in the background on an interval, so the cache
// never really goes stale for long; it's just what renders while that
// background refresh is in flight.
const REFRESH_INTERVAL = 60_000;
type ListingsCacheEntry = { data: DirectoryListing[]; notConfigured: boolean; at: number };
const listingsCache = new Map<string, ListingsCacheEntry>();

// Per-territory — keyed by territoryId so switching cities doesn't show a
// flash of the previous city's invite badges.
const inviteCache = new Map<string, { byGdPlaceId: Map<number, PlannerInvite>; at: number }>();

export default function TerritoryDirectory({ city, state, contacts, clients, onAddContact, onSyncClients, onOpenClient, featuredClientIds, onFeature, tasksByClient, onAddTask, onOpenTask, playbookTasksByClient, onOpenPlaybook, salesTasksByClient, onOpenSales, onSetClientStatus, ghlContactUrlFor, territoryId }: {
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
  // gracefully if a caller doesn't wire it.
  onSyncClients?: (contacts: Contact[]) => void;
  // tab="chat" opens straight to the client's Journal tab (see ListingRow).
  onOpenClient: (clientId: string, tab?: "chat") => void;
  // Newsletter feature motion. Optional so the admin multi-city overview,
  // which has no ambassador context, degrades to a read-only list.
  featuredClientIds?: Set<string>;
  onFeature?: (opts: { clientId: string | null; contact: Contact | null; name: string; city: string; state: string }) => void;
  // Open tasks per business, keyed by client id. A city's businesses are all
  // clients already (see the bulk sync below), so their work exists — it just
  // wasn't visible from here without opening each one. Optional so the admin
  // multi-city overview degrades to the read-only list it is today.
  tasksByClient?: Map<string, Task[]>;
  onAddTask?: (clientId: string, title: string) => void;
  onOpenTask?: (taskId: string) => void;
  // Owner Growth Plan tasks per business — optional so the admin multi-city
  // overview (which never passes this) degrades to no chip.
  playbookTasksByClient?: Map<string, Task[]>;
  onOpenPlaybook?: (clientId: string) => void;
  // Sales checklist tasks per business, and its navigate-to-it handler — same
  // shape as playbookTasksByClient/onOpenPlaybook. ListingRow shows this chip
  // instead of Playbook until the business is a real client on the Growth
  // Plan (stage past "claimed" — see the chip choice in ListingRow below).
  salesTasksByClient?: Map<string, Task[]>;
  onOpenSales?: (clientId: string) => void;
  // Editable Stage dropdown for a claimed business with a client record —
  // writes straight through the client header's own status setter. Optional
  // so the admin multi-city overview degrades to a read-only Stage label.
  onSetClientStatus?: (id: string, status: ClientStatus) => void;
  // GHL contact deep link for the Links column. Optional, same reason.
  ghlContactUrlFor?: (clientId: string) => string | null;
  // Wires the Content Planner's invite state into this view — a business
  // that's been invited shows it as "Invited" in the funnel instead of that
  // only being visible from inside the Planner. Optional, and undefined
  // outside a single-city page (the admin multi-city overview has no one
  // territory to scope planner_weeks to), where invites just never show.
  territoryId?: string;
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
  const [inviteByGdPlaceId, setInviteByGdPlaceId] = useState<Map<number, PlannerInvite>>(() => (territoryId && inviteCache.get(territoryId)?.byGdPlaceId) || new Map());

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

  // Invite status (invited/accepted/skipped) for this territory's own
  // businesses, from the same planner_weeks rows the Content Planner writes.
  // No new storage: PlannerInvite.gdPlaceId is the same GeoDirectory id as
  // DirectoryListing.id, so it joins directly. Undefined territoryId (the
  // admin multi-city overview) just skips this — no territory to scope to.
  useEffect(() => {
    if (!territoryId) return;
    let alive = true;
    const fetchInvites = () => {
      fetchPlannerWeeks(territoryId).then((weeks) => {
        if (!alive) return;
        const byGdPlaceId = latestInviteStatus(weeks);
        inviteCache.set(territoryId, { byGdPlaceId, at: Date.now() });
        setInviteByGdPlaceId(byGdPlaceId);
      }).catch(() => { /* fail soft — stays "Unclaimed" instead of "Invited" */ });
    };
    fetchInvites();
    const interval = setInterval(fetchInvites, REFRESH_INTERVAL);
    return () => { alive = false; clearInterval(interval); };
  }, [territoryId]);

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
  // this settles.
  useEffect(() => {
    if (!onSyncClients) return;
    const toSync = rows.filter((r) => r.contact && !r.client).map((r) => r.contact!);
    if (toSync.length) onSyncClients(toSync);
  }, [rows, onSyncClients]);

  // Contacts in this city that matched no directory listing — not a business
  // yet, just counted below so nothing feels lost.
  const noListing = useMemo(() => contacts.filter((c) => !matchedContactIds.has(c.id)), [contacts, matchedContactIds]);

  const sortRows = <T extends { listing: DirectoryListing }>(arr: T[]) => [...arr].sort((a, b) => a.listing.name.localeCompare(b.listing.name));

  // Free-text filter — by business/contact name, email, phone, or company.
  const ql = q.trim().toLowerCase();
  const qDigits = ql.replace(/\D/g, "");
  const matchRow = (r: { listing: DirectoryListing; contact: Contact | null }) => !ql
    || lc(r.listing.name).includes(ql)
    || (!!qDigits && digits(r.listing.phone).includes(qDigits))
    || (!!r.contact && (lc(r.contact.name).includes(ql) || lc(r.contact.email).includes(ql) || lc(r.contact.company).includes(ql) || (!!qDigits && digits(r.contact.phone).includes(qDigits))));

  const inviteFor = (listing: DirectoryListing) => inviteByGdPlaceId.get(typeof listing.id === "number" ? listing.id : Number(listing.id));
  const needsAttention = (r: { client: Client | null }) => !!(r.client && (tasksByClient?.get(r.client.id) ?? []).some((t) => t.status !== "done" && t.priority === "conversation"));

  const filtered = rows.filter(matchRow);
  const total = filtered.length;
  const nonBusinessCount = noListing.length;

  if (loading) return <div className="bg-background p-4 py-10 text-center text-[13px] text-muted sm:p-5">Loading directory for {city}…</div>;

  const attentionRows = sortRows(filtered.filter(needsAttention));
  const stageRows = new Map<BusinessStage, typeof filtered>();
  for (const key of STAGE_ORDER) stageRows.set(key, []);
  for (const r of filtered) stageRows.get(computeBusinessStage(r.listing, r.client, inviteFor(r.listing)))!.push(r);
  for (const key of STAGE_ORDER) stageRows.set(key, sortRows(stageRows.get(key)!));

  type Group = { key: string; label: string; color: string; hint: string; rows: typeof filtered };
  const groups: Group[] = [];
  if (attentionRows.length) groups.push({ key: "attention", label: ATTENTION_META.label, color: ATTENTION_META.color, hint: ATTENTION_META.hint, rows: attentionRows });
  for (const key of STAGE_ORDER) groups.push({ key, label: STAGE_META[key].label, color: STAGE_META[key].color, hint: STAGE_META[key].hint, rows: stageRows.get(key)! });

  return (
    <div className="pt-1">
      {/* No extra padding here — the parent (TerritoryPanel) already gives
          the page px-5/py-3, so this only needs a small top gap under its
          header. */}

      {notConfigured && (
        <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800">
          Directory not connected yet — showing city contacts only. Set <code>CUL_WP_BASE_URL</code> + <code>CLICKUPTASKS_API_KEY</code> to pull listing/claimed status.
        </div>
      )}
      {err && (
        <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800">
          Directory listings are unavailable right now, so claimed/stage status can&apos;t be shown — every contact below is grouped under &ldquo;Unclaimed.&rdquo; You can still open and work them; the listing overlay returns once the directory is reachable. <span className="text-amber-800/60">({err})</span>
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
          <span>Category</span>
          <span>Stage</span>
          <span>Links</span>
        </div>
        <div className="divide-y-8 divide-background">
          {groups.map((g) => {
            const isOpen = !collapsed.has(g.key);
            return (
              <div key={g.key}>
                <button onClick={() => toggleGroup(g.key)} className="flex w-full items-center gap-2 border-y px-4 py-2 text-left transition" style={{ background: g.color + "22", borderColor: g.color + "40" }}>
                  <I.chevron className={`text-muted transition ${isOpen ? "-rotate-90" : "rotate-180"}`} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                  <span className="text-[15px] font-bold">{g.label}</span>
                  <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.rows.length}</span>
                  <span className="truncate text-[12px] font-normal normal-case text-muted">{g.hint}</span>
                </button>
                {isOpen && g.rows.map((r) => (
                  <ListingRow key={g.key + r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient}
                    stage={computeBusinessStage(r.listing, r.client, inviteFor(r.listing))}
                    invite={inviteFor(r.listing)}
                    onSetClientStatus={onSetClientStatus} ghlContactUrlFor={ghlContactUrlFor}
                    featured={!!r.client && !!featuredClientIds?.has(r.client.id)}
                    canFeature={!!(r.client || r.contact)}
                    onFeature={onFeature && ((rr) => onFeature({ clientId: rr.client?.id ?? null, contact: rr.contact, name: rr.listing.name, city, state }))}
                    tasks={(r.client && tasksByClient?.get(r.client.id)) || []} onAddTask={onAddTask} onOpenTask={onOpenTask}
                    playbookTasks={(r.client && playbookTasksByClient?.get(r.client.id)) || []} onOpenPlaybook={onOpenPlaybook}
                    salesTasks={(r.client && salesTasksByClient?.get(r.client.id)) || []} onOpenSales={onOpenSales} />
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

function ListingRow({ row, onAddContact, onOpenClient, stage, invite, onSetClientStatus, ghlContactUrlFor, featured, canFeature, onFeature, tasks, onAddTask, onOpenTask, playbookTasks, onOpenPlaybook, salesTasks, onOpenSales }: {
  row: { listing: DirectoryListing; contact: Contact | null; client: Client | null };
  onAddContact: (c: Contact) => void;
  // tab="chat" opens straight to the client's Journal — the real activity
  // feed (GHL email/SMS conversation, task activity/completion, team notes)
  // instead of this page's old manual outreach log.
  onOpenClient: (id: string, tab?: "chat") => void;
  // This row's computed funnel position (see computeBusinessStage above).
  stage: BusinessStage;
  // This business's most recent Content Planner invite, if any — undefined
  // when it's never been invited (or territoryId wasn't passed down, e.g.
  // the admin multi-city overview).
  invite?: PlannerInvite;
  // Editable Stage dropdown (claimed businesses with a client record only).
  onSetClientStatus?: (id: string, status: ClientStatus) => void;
  ghlContactUrlFor?: (clientId: string) => string | null;
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
  // Owner Growth Plan tasks — same "empty when no client row yet" shape as tasks.
  playbookTasks: Task[];
  onOpenPlaybook?: (clientId: string) => void;
  // Sales checklist tasks — same shape, shown instead of Playbook until the
  // business is a real client on the Growth Plan (see `stage` below).
  salesTasks: Task[];
  onOpenSales?: (clientId: string) => void;
}) {
  const { listing, contact, client } = row;
  const [tasksOpen, setTasksOpen] = useState(false);
  const [newTask, setNewTask] = useState("");

  // Sales (getting them in) runs the funnel up through "claimed" — Playbook
  // (growing them) takes over once a real client status exists beyond
  // Lead/Prospect. Mirrors computeBusinessStage's own claimed-but-no-real-
  // status-yet logic, so the chip swap lines up exactly with the Stage cell.
  const onGrowthPlan = stage !== "unclaimed" && stage !== "invited" && stage !== "claimed";
  const playbook = client && onGrowthPlan ? playbookCompletion(client.id, playbookTasks) : null;
  const sales = client && !onGrowthPlan ? salesCompletion(client.id, salesTasks) : null;
  const expanded = tasksOpen;
  const ghlUrl = client ? ghlContactUrlFor?.(client.id) : null;

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

  return (
    <div className={`border-b text-[15px] transition-colors last:border-0 hover:bg-accent-soft/50 ${expanded ? "bg-accent-soft/30" : ""}`}>
      <div className="flex flex-col gap-1.5 px-4 py-2.5 sm:grid sm:min-h-[42px] sm:items-center sm:gap-2 sm:py-1.5" style={{ gridTemplateColumns: TEMPLATE }}>
        {/* Name + invite/outcome/due chips */}
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
            {invite && (
              <span title={`Content Planner invite, ${formatDue(invite.at)}`}
                className={`rounded px-1.5 py-0.5 font-medium ${invite.status === "accepted" ? "bg-emerald-100 text-emerald-700" : invite.status === "skipped" ? "bg-background text-muted" : "bg-accent-soft text-accent"}`}>
                {invite.status === "accepted" ? "✅ Accepted" : invite.status === "skipped" ? "⏭ Skipped" : "✉️ Invited"} {formatDue(invite.at)}
              </span>
            )}
            {listing.rep && <span>· {listing.rep}</span>}
          </div>
        </div>

        {/* Category */}
        <div className="pl-5 text-[12px] text-muted sm:pl-0">
          {listing.category ? <span className="truncate" title={listing.category}>{listing.category}</span> : <span className="text-muted/30">—</span>}
        </div>

        {/* Stage — a claimed business with a client record gets an editable
            dropdown over the client lifecycle (Lead → ... → Past Client);
            everything else (unclaimed, invited, or claimed with no client yet)
            is a plain read-only label. */}
        <div className="pl-5 sm:pl-0">
          {client && onSetClientStatus ? (
            <select value={client.status} onChange={(e) => onSetClientStatus(client.id, e.target.value as ClientStatus)}
              title="Business lifecycle stage" className="w-full max-w-[140px] rounded-md border px-1.5 py-1 text-[12px] font-medium outline-none focus:border-accent bg-accent-soft text-accent">
              {CLIENT_STATUS_ORDER.map((s) => <option key={s} value={s}>{CLIENT_STATUS_META[s].label}</option>)}
            </select>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: STAGE_META[stage].color }}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STAGE_META[stage].color }} />
              {STAGE_META[stage].label}
            </span>
          )}
        </div>

        {/* Links — GHL contact + the public listing page. Clicking the name
            already opens/creates the client record, so no "+ Add as client"
            affordance is needed here. */}
        <div className="flex flex-col items-start gap-0.5 pl-5 text-[11px] font-medium sm:pl-0">
          {ghlUrl && <a href={ghlUrl} target="_blank" rel="noopener noreferrer" title="Open in GoHighLevel" className="text-muted hover:text-accent hover:underline">GHL ↗</a>}
          {listing.url && <a href={listing.url} target="_blank" rel="noopener noreferrer" title="View public listing page" className="text-muted hover:text-accent hover:underline">Listing ↗</a>}
          {!ghlUrl && !listing.url && <span className="text-muted/30">—</span>}
        </div>
      </div>

      {/* What's left — Playbook/Sales progress + open tasks (the primary
          reason to open this row), on its own full-width line rather than a
          cramped grid column — it wraps unpredictably depending on how much
          progress/next-step text a business has, and needs room to breathe.
          Journal/Feature stay de-emphasized in a compact icon row beside it. */}
      {client && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-4 pb-2 pl-9 pt-1.5 sm:pl-9">
          {onOpenPlaybook && playbook && (
            <button onClick={() => onOpenPlaybook(client.id)} title={playbook.next ? `Playbook — next: ${playbook.next.label}` : "Playbook — all steps complete"}
              className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground">
              Playbook {playbook.doneCount}/{playbook.total}
              {playbook.next && <span className="ml-1 font-normal text-accent">· {playbook.next.label}</span>}
            </button>
          )}
          {onOpenSales && sales && (
            <button onClick={() => onOpenSales(client.id)} title={sales.next ? `Sales — next: ${sales.next.label}` : "Sales — all steps complete"}
              className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground">
              Sales {sales.doneCount}/{sales.total}
              {sales.next && <span className="ml-1 font-normal text-accent">· {sales.next.label}</span>}
            </button>
          )}
          {onAddTask ? (
            <button onClick={() => setTasksOpen((o) => !o)} title={openTasks.length ? `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}` : "No open tasks — click to add one"}
              className={`shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium ${tasksOpen ? "bg-accent-soft text-accent" : openTasks.length ? "text-foreground hover:bg-surface" : "border-dashed text-muted hover:bg-surface hover:text-foreground"}`}>
              {openTasks.length ? `${openTasks.length} task${openTasks.length === 1 ? "" : "s"}` : "+ Task"}
              {nextDue && <span className={`ml-1 font-normal ${isOverdue(nextDue) ? "text-danger" : "text-muted"}`}>{formatDue(nextDue)}</span>}
            </button>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-0.5 text-muted">
            {/* Real activity (calls/emails/SMS/notes) lives in the client's
                own Journal now — GHL conversation + task activity, not a
                manually-entered log — so this just jumps there. */}
            <button onClick={() => onOpenClient(client.id, "chat")} title="Open Journal — calls, emails, SMS, and notes for this business"
              className="shrink-0 rounded p-1 hover:bg-surface hover:text-foreground"><I.clock /></button>
            {onFeature && (featured
              ? <span title="Already run through the newsletter feature motion" className="shrink-0 rounded p-1 text-emerald-600"><I.star filled /></span>
              : <button onClick={() => onFeature(row)} disabled={!canFeature}
                  title={canFeature ? "Feature in the newsletter — creates the Stage-3 outreach sequence" : "No GoHighLevel contact matched to this listing yet, so there's nothing to attach the sequence to"}
                  className="shrink-0 rounded p-1 hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"><I.star /></button>)}
          </span>
        </div>
      )}

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
    </div>
  );
}

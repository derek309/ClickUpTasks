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
import { useEffect, useMemo, useRef, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { fetchPlannerWeeks } from "@/lib/db";
import { latestInviteStatus, inviteHistory, featureHistory, isDue } from "@/lib/plannerPools";
import {
  formatDue, playbookCompletion, salesCompletion,
  CLIENT_STATUS_META, CLIENT_STATUS_ORDER,
  type Contact, type Client, type ClientStatus, type Task, type PlannerInvite,
} from "@/lib/data";
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

// Guards the name click against a drag-to-select gesture ending on this same
// element (e.g. selecting the business name to copy it) — a mousedown+drag
// still fires a click on mouseup. Compares mousedown/mouseup position
// (not ambient page selection state — an earlier version checked
// window.getSelection() globally, which meant ANY leftover text selection
// anywhere on the page silently broke every name click on the whole list
// until it was cleared) so a real single click always works regardless of
// what's selected elsewhere.
const DRAG_THRESHOLD_PX = 4;
const isDragClick = (down: { x: number; y: number } | null, e: { clientX: number; clientY: number }) =>
  !!down && (Math.abs(e.clientX - down.x) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - down.y) > DRAG_THRESHOLD_PX);

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

// Name | Category | Stage — "What's left" (progress pills + GHL/Listing
// links + Feature) gets its own full-width line below this row (see
// ListingRow) rather than cramped grid columns. Category's own width is
// computed per render (see `template` in the component below) from the
// longest category currently on screen, in `ch` units (character-width,
// not a raw pixel guess) — a fixed px width was clipping longer categories
// ("Auto Glass & Windshield Repair" → "Auto Glass & Win…") since every row
// renders its own independent grid (not one shared table), so this has to
// be recomputed from the actual data instead of guessed once.
const CATEGORY_MIN_CH = 10;
const CATEGORY_MAX_CH = 30;

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
// flash of the previous city's invite badges. Also holds the invite/feature
// HISTORY (not just latest-invite-status) needed to compute "due for
// outreach" for the Priority sort — same planner_weeks fetch, just derived
// two more ways.
type PlannerActivityCacheEntry = {
  byGdPlaceId: Map<number, PlannerInvite>;
  invites: Map<number, { invited: number; accepted: number; skipped: number; lastAt: string }>;
  features: Map<string, { count: number; last: string }>;
  at: number;
};
const inviteCache = new Map<string, PlannerActivityCacheEntry>();

export default function TerritoryDirectory({ city, state, contacts, clients, onAddContact, onSyncClients, onOpenClient, featuredClientIds, onFeature, tasksByClient, playbookTasksByClient, onOpenPlaybook, salesTasksByClient, onOpenSales, otherListsByClient, onOpenProject, onSetClientStatus, ghlContactUrlFor, territoryId }: {
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
  onOpenClient: (clientId: string) => void;
  // Newsletter feature motion. Optional so the admin multi-city overview,
  // which has no ambassador context, degrades to a read-only list.
  featuredClientIds?: Set<string>;
  onFeature?: (opts: { clientId: string | null; contact: Contact | null; name: string; city: string; state: string }) => void;
  // This business's own tasks (any status, excluding Playbook/Sales
  // checklist steps), keyed by client id — feeds the "needs attention now"
  // scan below. Optional so the admin multi-city overview degrades to the
  // read-only list it is today.
  tasksByClient?: Map<string, Task[]>;
  // Owner Growth Plan tasks per business — optional so the admin multi-city
  // overview (which never passes this) degrades to no chip.
  playbookTasksByClient?: Map<string, Task[]>;
  onOpenPlaybook?: (clientId: string) => void;
  // A business's other (non-Sales/Playbook) lists, pre-computed with their
  // own done/total counts, and the navigate-to-it handler — one pill per
  // list on the row instead of one aggregated count.
  otherListsByClient?: Map<string, { id: string; name: string; done: number; total: number }[]>;
  onOpenProject?: (clientId: string, projectId: string) => void;
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
  // Clicking a stat pill hard-filters to just that stage (not a peek-while-
  // keeping-the-rest-visible expand) — the funnel-overview bar already shows
  // every stage's shape, so "drill into this one segment" is the more useful
  // action than expanding it inline among seven others. Click the same pill
  // again (or "Show all stages") to clear back to the full funnel.
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const filterToGroup = (key: string) => {
    setStageFilter((cur) => (cur === key ? null : key));
    setCollapsed((s) => { const n = new Set(s); n.delete(key); return n; }); // in case "Collapse all" left it closed
  };
  const [q, setQ] = useState("");
  // Sort within each stage group — Priority (default: due-for-outreach first,
  // per the Planner's own rotation window, so acquisition work the Planner
  // thinks needs a touch floats up without opening the Planner separately),
  // or Name/Category to browse a different way.
  const [sort, setSort] = useState<"priority" | "name" | "category">("priority");
  const [inviteByGdPlaceId, setInviteByGdPlaceId] = useState<Map<number, PlannerInvite>>(() => (territoryId && inviteCache.get(territoryId)?.byGdPlaceId) || new Map());
  const [inviteHistoryMap, setInviteHistoryMap] = useState<Map<number, { invited: number; accepted: number; skipped: number; lastAt: string }>>(() => (territoryId && inviteCache.get(territoryId)?.invites) || new Map());
  const [featureHistoryMap, setFeatureHistoryMap] = useState<Map<string, { count: number; last: string }>>(() => (territoryId && inviteCache.get(territoryId)?.features) || new Map());

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
        const invites = inviteHistory(weeks);
        const features = featureHistory(weeks);
        inviteCache.set(territoryId, { byGdPlaceId, invites, features, at: Date.now() });
        setInviteByGdPlaceId(byGdPlaceId);
        setInviteHistoryMap(invites);
        setFeatureHistoryMap(features);
      }).catch(() => { /* fail soft — stays "Unclaimed" instead of "Invited", Priority sort just falls back to Name */ });
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

  // This business's most recent Planner touch — an invite send or a
  // newsletter feature, whichever is later — feeding the Priority sort's
  // "due for outreach" check below. null = never touched (most urgent).
  const lastTouchedAt = (listing: DirectoryListing): string | null => {
    const inv = inviteHistoryMap.get(typeof listing.id === "number" ? listing.id : Number(listing.id))?.lastAt ?? null;
    const feat = featureHistoryMap.get(lc(listing.name))?.last ?? null;
    if (inv && feat) return inv > feat ? inv : feat;
    return inv ?? feat;
  };
  const todayIso = new Date().toISOString();
  const sortRows = <T extends { listing: DirectoryListing }>(arr: T[]) => [...arr].sort((a, b) => {
    if (sort === "priority") {
      const aLast = lastTouchedAt(a.listing);
      const bLast = lastTouchedAt(b.listing);
      const aDue = isDue(aLast, todayIso);
      const bDue = isDue(bLast, todayIso);
      if (aDue !== bDue) return aDue ? -1 : 1;
      // Both due (or both not) — the longer it's been (or never at all,
      // which sorts first since "" is the smallest string), the more urgent.
      const c = (aLast ?? "").localeCompare(bLast ?? "");
      if (c !== 0) return c;
    } else if (sort === "category") {
      const c = a.listing.category.localeCompare(b.listing.category);
      if (c !== 0) return c;
    }
    return a.listing.name.localeCompare(b.listing.name);
  });

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
  const categoryCh = Math.min(CATEGORY_MAX_CH, Math.max(CATEGORY_MIN_CH, ...filtered.map((r) => r.listing.category.length)));
  const template = `minmax(0,1fr) ${categoryCh}ch 148px`;

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
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));
  const toggleAllGroups = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)));

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

      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <I.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${city} businesses…`}
            className="w-full rounded-lg border bg-surface py-1.5 pl-8 pr-8 text-[14px] outline-none focus:border-accent" />
          {q && <button onClick={() => setQ("")} title="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"><I.close /></button>}
        </div>
        {/* Priority (default) surfaces who's due for a Planner touch first —
            same 90-day rotation the Planner itself uses to rank who to
            invite/feature next — so acquisition work shows up here without
            opening the Planner separately. Name/Category are just other ways
            to browse the same list. */}
        <span className="inline-flex shrink-0 overflow-hidden rounded-lg border text-[13px]">
          {(["priority", "name", "category"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)}
              title={s === "priority" ? "Sort by priority — due for outreach first" : s === "name" ? "Sort A–Z" : "Sort by category — groups businesses in the same category together"}
              className={`px-2.5 py-1.5 font-medium capitalize ${sort === s ? "bg-accent-soft text-accent" : "text-muted hover:bg-background"}`}>{s}</button>
          ))}
        </span>
        <button onClick={toggleAllGroups} title={allCollapsed ? "Expand every stage group" : "Collapse every stage group"}
          className="shrink-0 rounded-lg border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>

      {/* Funnel overview — every stage's count at a glance, and a hard
          filter: clicking a stat drills into just that one segment (hides
          every other group entirely) rather than peeking at it inline among
          seven others. Click the same stat again, or "Show all stages", to
          go back to the full funnel. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {groups.map((g) => {
          const active = stageFilter === g.key;
          return (
            <button key={g.key} onClick={() => filterToGroup(g.key)} title={active ? "Show all stages" : g.hint}
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] font-medium hover:bg-background"
              style={active ? { background: g.color + "22", borderColor: g.color, color: g.color } : { borderColor: g.color + "40" }}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.color }} />
              {g.label} <span className="font-semibold" style={!active ? { color: g.color } : undefined}>{g.rows.length}</span>
            </button>
          );
        })}
        {stageFilter && (
          <button onClick={() => setStageFilter(null)} className="text-[12px] font-medium text-muted hover:text-foreground hover:underline">Show all stages</button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-surface shadow-soft">
        <div className="hidden items-center gap-2 border-b bg-background/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted sm:grid" style={{ gridTemplateColumns: template }}>
          <span className="text-left">Name</span>
          <span className="text-left">Category</span>
          <span className="text-left">Stage</span>
        </div>
        <div className="divide-y-8 divide-background">
          {groups.filter((g) => !stageFilter || g.key === stageFilter).map((g) => {
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
                  <ListingRow key={g.key + r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient} template={template}
                    stage={computeBusinessStage(r.listing, r.client, inviteFor(r.listing))}
                    invite={inviteFor(r.listing)}
                    onSetClientStatus={onSetClientStatus} ghlContactUrlFor={ghlContactUrlFor}
                    featured={!!r.client && !!featuredClientIds?.has(r.client.id)}
                    canFeature={!!(r.client || r.contact)}
                    onFeature={onFeature && ((rr) => onFeature({ clientId: rr.client?.id ?? null, contact: rr.contact, name: rr.listing.name, city, state }))}
                    playbookTasks={(r.client && playbookTasksByClient?.get(r.client.id)) || []} onOpenPlaybook={onOpenPlaybook}
                    salesTasks={(r.client && salesTasksByClient?.get(r.client.id)) || []} onOpenSales={onOpenSales}
                    otherLists={(r.client && otherListsByClient?.get(r.client.id)) || []} onOpenProject={onOpenProject} />
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

function ListingRow({ row, onAddContact, onOpenClient, template, stage, invite, onSetClientStatus, ghlContactUrlFor, featured, canFeature, onFeature, playbookTasks, onOpenPlaybook, salesTasks, onOpenSales, otherLists, onOpenProject }: {
  row: { listing: DirectoryListing; contact: Contact | null; client: Client | null };
  onAddContact: (c: Contact) => void;
  onOpenClient: (id: string) => void;
  // Grid column widths for this render — Category's width is computed by the
  // parent from the longest category currently on screen (see `template` in
  // the main component), so every row lines up even though each renders its
  // own independent grid.
  template: string;
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
  // Owner Growth Plan tasks — empty when it has no client row yet.
  playbookTasks: Task[];
  onOpenPlaybook?: (clientId: string) => void;
  // Sales checklist tasks — same shape, shown instead of Playbook until the
  // business is a real client on the Growth Plan (see `stage` below).
  salesTasks: Task[];
  onOpenSales?: (clientId: string) => void;
  // This business's other (non-Sales/Playbook) lists, pre-computed with
  // their own done/total counts — one pill per list, click-through to that
  // list rather than an inline expand. Empty when it has none (or no client yet).
  otherLists: { id: string; name: string; done: number; total: number }[];
  onOpenProject?: (clientId: string, projectId: string) => void;
}) {
  const { listing, contact, client } = row;
  const nameMouseDown = useRef<{ x: number; y: number } | null>(null);

  // Sales (getting them in) runs the funnel up through "claimed" — Playbook
  // (growing them) takes over once a real client status exists beyond
  // Lead/Prospect. Mirrors computeBusinessStage's own claimed-but-no-real-
  // status-yet logic, so the chip swap lines up exactly with the Stage cell.
  const onGrowthPlan = stage !== "unclaimed" && stage !== "invited" && stage !== "claimed";
  const playbook = client && onGrowthPlan ? playbookCompletion(client.id, playbookTasks) : null;
  const sales = client && !onGrowthPlan ? salesCompletion(client.id, salesTasks) : null;
  const ghlUrl = client ? ghlContactUrlFor?.(client.id) : null;

  return (
    <div className="border-b text-[15px] transition-colors last:border-0 hover:bg-accent-soft/50">
      <div className="flex flex-col gap-1.5 px-4 py-2.5 sm:grid sm:min-h-[42px] sm:items-center sm:gap-2 sm:py-1.5" style={{ gridTemplateColumns: template }}>
        {/* Name + invite/outcome/due chips */}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {listing.claimed ? (
              <span title="Directory listing claimed" className="shrink-0 text-emerald-500"><I.check /></span>
            ) : onFeature && featured ? (
              <span title="Already run through the newsletter feature motion" className="shrink-0 text-emerald-600"><I.star filled /></span>
            ) : onFeature ? (
              <button onClick={() => onFeature(row)} disabled={!canFeature}
                title={canFeature ? "Feature in the newsletter — creates the Stage-3 outreach sequence" : "No GoHighLevel contact matched to this listing yet, so there's nothing to attach the sequence to"}
                className="shrink-0 text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"><I.star /></button>
            ) : (
              <span title="Unclaimed listing" className="h-2 w-2 shrink-0 rounded-full border border-muted/50" />
            )}
            {client ? (
              <button onMouseDown={(e) => { nameMouseDown.current = { x: e.clientX, y: e.clientY }; }}
                onClick={(e) => { if (!isDragClick(nameMouseDown.current, e)) onOpenClient(client.id); }} title="Open this client"
                className="min-w-0 truncate text-left font-medium hover:text-accent hover:underline">{listing.name}</button>
            ) : contact ? (
              // Matched to a real GHL contact but no client yet — clicking
              // opens it immediately (silently creating one as a Lead), same
              // as the "+ Add as client" button. No confirm: being in GHL is
              // enough to work a business from here.
              <button onMouseDown={(e) => { nameMouseDown.current = { x: e.clientX, y: e.clientY }; }}
                onClick={(e) => { if (!isDragClick(nameMouseDown.current, e)) onAddContact(contact); }} title="Open this business"
                className="min-w-0 truncate text-left font-medium hover:text-accent hover:underline">{listing.name}</button>
            ) : (
              <span className="min-w-0 truncate font-medium">{listing.name}</span>
            )}
            {ghlUrl && <a href={ghlUrl} target="_blank" rel="noopener noreferrer" title="Open in GoHighLevel" className="shrink-0 rounded p-0.5 text-muted hover:bg-surface hover:text-accent"><I.bolt /></a>}
            {listing.url && <a href={listing.url} target="_blank" rel="noopener noreferrer" title="View public listing page" className="shrink-0 rounded p-0.5 text-muted hover:bg-surface hover:text-accent"><I.link /></a>}
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

        {/* Category — min-w-0 is load-bearing here: a CSS grid item's default
            min-width is auto (content-based), so without it long category
            text overflowed into the Stage column instead of truncating,
            despite the column's own fixed track width. */}
        <div className="min-w-0 pl-5 text-[12px] text-muted sm:pl-0">
          {listing.category ? <span className="block truncate" title={listing.category}>{listing.category}</span> : <span className="text-muted/30">—</span>}
        </div>

        {/* Stage — a claimed business with a client record gets an editable
            dropdown over the client lifecycle (Lead → ... → Past Client);
            everything else (unclaimed, invited, or claimed with no client yet)
            is a plain read-only label. */}
        <div className="pl-5 sm:pl-0">
          {client && onSetClientStatus && stage !== "unclaimed" && stage !== "invited" ? (
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

      </div>

      {/* What's left — Playbook/Sales progress + this business's other lists
          (the primary reason to open this row), on its own full-width line
          rather than a cramped grid column — it wraps unpredictably
          depending on how much progress/next-step text a business has, and
          needs room to breathe. GHL/Listing links now sit inline next to the
          name instead of leading this line. */}
      {client && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 pl-9 pt-1.5 sm:pl-9">
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
          {/* Every other list this business has (excluding Playbook/Sales,
              which get their own pill above) — one pill per list, same X/Y
              format, click jumps straight to that list. Hidden entirely when
              a list has no tasks yet — nothing to jump to. */}
          {otherLists.map((l) => (
            <button key={l.id} onClick={() => onOpenProject?.(client.id, l.id)} title={`Open “${l.name}”`}
              className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground">
              {l.name} {l.done}/{l.total}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

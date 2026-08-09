"use client";

// The /sales-style directory view for a single territory (city). Live-fetches
// the ClickUpLocal directory (GeoDirectory) listings for the city from the
// WordPress side via /api/directory/listings, matches each listing to a GHL
// contact/client, and groups them by where they actually are in the Playbook
// journey — Unclaimed → Invited → Claimed → Interview → Onboarding →
// Active Client → Nurture/Cancelled/Past Client — so opening this page reads
// as "here's the whole funnel, here's who needs work today," not a flat list.
//
// Rendered as one card matching GroupedList's own chrome (rounded-xl border
// bg-surface shadow-soft, a column header row, colored collapsible group
// headers with a count pill) so this reads as the same list format as
// Tasks/Projects instead of a bespoke layout.
//
// When the directory isn't configured (the endpoint 501s before Derek sets the
// WP env vars) or errors, it degrades to showing every city contact under
// "Unclaimed" — exactly the pre-directory behavior, just relabeled.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { fetchPlannerWeeks, upsertPlannerWeek } from "@/lib/db";
import { latestInviteStatus, inviteHistory, featureHistory, isDue, allInvitesByGdPlaceId } from "@/lib/plannerPools";
import { zonedDateString, BUSINESS_TZ, AUTO_INVITE_START_HOUR } from "@/lib/businessHours";
import {
  formatDue, playbookCompletion, plannerWeekOf, todayIso as todayIsoDate,
  CLIENT_STATUS_META, CLIENT_STATUS_ORDER, STEP_STALL_DAYS,
  type Contact, type Client, type ClientStatus, type Task, type PlannerInvite, type PlannerWeek,
} from "@/lib/data";
import { I } from "./ui";
import { TouchPanel, type TouchResult, type OutcomeKey } from "./TouchLogger";
// Types only (erased at build) — the lib itself is server-only.
import type { JoinFunnelStep, JoinFunnelEntry } from "@/lib/joinFunnelServer";

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
  // wp-admin edit-post screen for this listing — "" if CUL_WP_BASE_URL isn't
  // configured. Requires being logged into WP as an admin/editor; this app
  // has no way to deep-auth into it, so it's a plain link, same as View listing.
  editUrl: string;
  // GHL contact record for a business that hasn't claimed yet, resolved
  // against the shared pre-claim sub-account (clients.id = 'c_directory') —
  // "" when the directory location or this listing's ghlContactId isn't
  // resolvable.
  ghlUrl: string;
  // Raw location id behind ghlUrl — needed to actually send an email/SMS via
  // /api/ghl/message, not just link out to GHL. "" under the same conditions
  // ghlUrl is "".
  ghlLocationId: string;
  // Public booking widget for this city's GHL interview calendar — null when
  // no calendar exists yet for this city (only Tracy/Lincoln do as of
  // 2026-08-08) or the location/token didn't resolve. Whole-city, not
  // per-listing — every row in the same fetch shares one value.
  bookingUrl: string | null;
  score: number | null;
  category: string;
  rep: string;          // assigned ambassador's name (read-only here)
  ghlContactId: string; // links to the GoHighLevel contact record
  // Outreach tracking, straight off WordPress /sales (the pipeline's source
  // of truth). directoryListingsServer.ts has always mapped these six out of
  // the light listing row, but they were never declared here, so nothing
  // could read them and every touch WP recorded was invisible to this app.
  // outcome/nextAction are WP's own key sets (called|emailed|sms|visited|
  // presented|posted|won|lost and email|call|sms|visit|present|close); the
  // *Label variants are WP's rendered text for them, used as-is so the two
  // front ends never word the same touch differently.
  outcome: string;
  outcomeLabel: string;
  nextAction: string;
  nextActionLabel: string;
  /** Unix seconds; 0 = no follow-up scheduled. */
  followupDue: number;
  /** Unix seconds; 0 = never touched. */
  lastTouched: number;
};

// Last 10 digits — normalizes (555) 123-4567 / +1 555 123 4567 / 5551234567 to
// the same key so a listing and a GHL contact match despite formatting.
// WordPress stores the weekly invite email as one blob per (city, week) whose
// first line is "Subject: ...". Split/join here are presentation only — a
// human editing subject and body as two fields, not a storage format change —
// so anything else that reads the saved value (the send path, the Sales tool)
// keeps working untouched. joinTemplate(...splitTemplate(t)) === t whenever t
// already follows that convention, since split keeps the body's exact bytes
// (including a leading blank line, if the generator wrote one) and join only
// ever prepends the subject line back onto it.
function splitTemplate(text: string): [string, string] {
  const m = text.match(/^Subject:[ \t]*(.*)\r?\n?/);
  if (!m) return ["", text];
  return [m[1], text.slice(m[0].length)];
}
function joinTemplate(subject: string, body: string): string {
  return `Subject: ${subject}\n${body}`;
}
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
export type BusinessStage = "unclaimed" | "invited" | "claimed" | "interview" | "onboarding" | "active_client" | "nurture" | "cancelled" | "past_client";
export const STAGE_ORDER: BusinessStage[] = ["unclaimed", "invited", "claimed", "interview", "onboarding", "active_client", "nurture", "cancelled", "past_client"];
// Same nine keys as a lookup — the group loop below has to tell a real funnel
// group apart from an override group (attention/followed up/engagement ladder)
// by key alone, and does it once per row.
const STAGE_KEYS = new Set<string>(STAGE_ORDER);
export const STAGE_META: Record<BusinessStage, { label: string; color: string; hint: string }> = {
  unclaimed: { label: "Unclaimed", color: "#f59e0b", hint: "listing nobody has claimed yet — a prospect to invite or call" },
  invited: { label: "Claim Your Free Marketing Package", color: "#0ea5e9", hint: "invited to claim their listing, hasn't yet" },
  claimed: { label: CLIENT_STATUS_META.claimed.label, color: "#10b981", hint: "claimed their listing — work the Playbook with them" },
  interview: { label: CLIENT_STATUS_META.interview.label, color: CLIENT_STATUS_META.interview.dot, hint: "phone/Zoom interview (doubles as verification), then the in-person visit to finalize their profile" },
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
const ATTENTION_META = { label: "Needs attention now", color: "#8b5cf6", hint: "replied by SMS, email, or newsletter invite, or has gone quiet mid pipeline. Check in before anything else" };
// The other half of that same group: a business someone has already reached
// out to (walk-in, call, email) and is now waiting to hear back from. Same
// open conversation task, just with its due date pushed out by the Followed
// up button below — so it reads as worked, not cold, until that date comes
// around and it drops back into "Needs attention now" on its own. Deliberately
// a calm slate rather than another hot color: the whole point is that a rep
// scanning this page can see at a glance which of these still need a first
// touch.
const FOLLOWED_UP_META = { label: "Followed up, waiting to hear back", color: "#64748b", hint: "someone already reached out, so we check back in if nothing comes of it" };
// Three more override groups, purely from invite engagement (status/openedAt/
// clickedAt on the latest invite — see PlannerInvite) — NOT tasks, so none of
// these ever touch the Dashboard ("that's for active clients," Derek, Aug 3).
// A daily call/visit ladder ranked by how strong the signal is: answered the
// 3 questions (real intent) is hotter than a link click, which is hotter than
// just opening the email. Each business sits in exactly ONE of these three —
// the strongest tier it qualifies for — so the page reads as "who to work
// today," not the same names stacked three times (Derek, Aug 4: "bring the
// important things to the top so we can focus on the right businesses").
const ACCEPTED_META = { label: "Accepted, hasn't claimed", color: "#059669", hint: "answered the intake questions — the hottest lead that hasn't claimed yet, call or visit today" };
const CLICKED_META = { label: "Clicked, hasn't answered", color: "#2563eb", hint: "clicked the invite link but didn't finish the questions — a nudge might close it" };
const OPENED_META = { label: "Opened, hasn't clicked", color: "#0891b2", hint: "read the invite but hasn't clicked through yet — worth a call or a visit" };

export function computeBusinessStage(listing: DirectoryListing, client: Client | null, invite?: PlannerInvite): BusinessStage {
  // A matched client can carry real funnel progress (e.g. a booked
  // interview) even when the WordPress listing itself was never formally
  // "claimed" — that flag specifically means a verified WordPress-account
  // ownership claim (post_author transfer, staff review flag, the works —
  // see functions.php's claim-listing handler), which the AI-chat interview
  // booking flow deliberately never touches since nobody logged into
  // WordPress to book a call. Trust client.status once it shows real
  // progress past the bare "claimed" baseline, so a booked interview (or
  // anything further) surfaces under its own stage instead of hiding behind
  // an ownership flag it has nothing to do with — and so the Stage dropdown,
  // gated on this same computed stage, becomes visible to fix it by hand too.
  if (client && client.status !== "claimed") return client.status as BusinessStage;
  if (!listing.claimed) return invite && invite.status !== "skipped" ? "invited" : "unclaimed";
  if (!client) return "claimed";
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
  // The raw rows too (not just derived maps) — the invite queue below needs
  // to read/write "this week"'s own invited/dismissed arrays directly.
  weeks: PlannerWeek[];
  at: number;
};
const inviteCache = new Map<string, PlannerActivityCacheEntry>();

// Same treatment for the invite chat funnel (WordPress's own per business step
// tracking, proxied through /api/directory/funnel) — keyed by territoryId so
// switching cities never shows the previous city's funnel.
type FunnelCacheEntry = { steps: JoinFunnelStep[]; byGdPlaceId: Record<number, JoinFunnelEntry>; at: number };
const funnelCache = new Map<string, FunnelCacheEntry>();

export default function TerritoryDirectory({ city, state, contacts, clients, onAddContact, onSyncClients, onOpenClient, featuredClientIds, onFeature, tasksByClient, playbookTasksByClient, onOpenPlaybook, otherListsByClient, onOpenProject, onSetClientStatus, canAdmin, ghlContactUrlFor, territoryId, dailyInviteCap, highlightListingId, onHighlightConsumed }: {
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
  // Editable Stage dropdown for a claimed business with a client record —
  // writes straight through the client header's own status setter. Optional
  // so the admin multi-city overview degrades to a read-only Stage label.
  onSetClientStatus?: (id: string, status: ClientStatus) => void;
  // Locked to admins — an ambassador sees the same read-only Stage label a
  // claimed-but-not-yet-moved business already shows, just never the
  // dropdown, regardless of onSetClientStatus being wired.
  canAdmin?: boolean;
  // GHL contact deep link for the Links column. Optional, same reason.
  ghlContactUrlFor?: (clientId: string) => string | null;
  // Wires the Content Planner's invite state into this view — a business
  // that's been invited shows it as "Invited" in the funnel instead of that
  // only being visible from inside the Planner. Optional, and undefined
  // outside a single-city page (the admin multi-city overview has no one
  // territory to scope planner_weeks to), where invites just never show.
  territoryId?: string;
  // This territory's auto-invite setting (Territories admin panel) — lets
  // this page preview exactly who the daily cron would send to next.
  // null/0 = auto-invite is off. Optional so the admin multi-city overview
  // (which has no one territory) just skips the preview.
  dailyInviteCap?: number | null;
  // Scrolls straight to this listing and expands its group, when set — the
  // Territory Dashboard's "Open in Businesses" instead of the top of the
  // whole city. Consumed once via onHighlightConsumed.
  highlightListingId?: number | null;
  onHighlightConsumed?: () => void;
}) {
  const cacheKey = `${city}|${state}`;
  const warm = () => listingsCache.get(cacheKey);
  const [listings, setListings] = useState<DirectoryListing[] | null>(() => warm()?.data ?? null);
  const [loading, setLoading] = useState(() => !warm());
  const [err, setErr] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(() => warm()?.notConfigured ?? false);
  // Collapsed by default — the group keys are a fixed, known set (not
  // data-dependent), so this doesn't need to wait for listings to load.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(["attention", "followed_up", "accepted", "clicked", "opened", ...STAGE_ORDER]),
  );
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
  // "Open in Businesses" deep link: expand everything and clear any stage
  // filter so the target row is guaranteed to actually be in the DOM, then
  // scroll to and flash it — otherwise it's dumped at the top of a long city
  // like a plain sidebar click, exactly the thing this was built to fix.
  // Declared here (must run unconditionally every render — the `if (loading)
  // return` a bit further down means anything declared after it would be a
  // real rules-of-hooks violation, not a lint false positive) rather than
  // down by `groups`, so it can't reference that computed value; checking
  // raw `listings` for existence instead is enough and avoids duplicating
  // groups' own tier logic just for this.
  const [highlightedRowId, setHighlightedRowId] = useState<number | null>(null);
  useEffect(() => {
    if (highlightListingId == null || !listings) return;
    if (!listings.some((l) => Number(l.id) === highlightListingId)) return; // not in this city
    setCollapsed(new Set());
    setStageFilter(null);
    setHighlightedRowId(highlightListingId);
    onHighlightConsumed?.();
    const t = setTimeout(() => {
      document.getElementById(`listing-row-${highlightListingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50); // one tick so the just-expanded groups have rendered their rows first
    const clear = setTimeout(() => setHighlightedRowId(null), 4000);
    return () => { clearTimeout(t); clearTimeout(clear); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightListingId, listings]);
  const [q, setQ] = useState("");
  // Sort within each stage group — Priority (default: due-for-outreach first,
  // per the Planner's own rotation window, so acquisition work the Planner
  // thinks needs a touch floats up without opening the Planner separately),
  // or Name/Category to browse a different way.
  const [sort, setSort] = useState<"priority" | "name" | "category">("priority");
  const [inviteByGdPlaceId, setInviteByGdPlaceId] = useState<Map<number, PlannerInvite>>(() => (territoryId && inviteCache.get(territoryId)?.byGdPlaceId) || new Map());
  const [inviteHistoryMap, setInviteHistoryMap] = useState<Map<number, { invited: number; accepted: number; skipped: number; lastAt: string }>>(() => (territoryId && inviteCache.get(territoryId)?.invites) || new Map());
  const [featureHistoryMap, setFeatureHistoryMap] = useState<Map<string, { count: number; last: string }>>(() => (territoryId && inviteCache.get(territoryId)?.features) || new Map());
  const [plannerWeeks, setPlannerWeeks] = useState<PlannerWeek[]>(() => (territoryId && inviteCache.get(territoryId)?.weeks) || []);
  const [funnelSteps, setFunnelSteps] = useState<JoinFunnelStep[]>(() => (territoryId && funnelCache.get(territoryId)?.steps) || []);
  const [funnelByGdPlaceId, setFunnelByGdPlaceId] = useState<Record<number, JoinFunnelEntry>>(() => (territoryId && funnelCache.get(territoryId)?.byGdPlaceId) || {});
  // Same "build every write from the latest row, not a stale render's
  // snapshot" reasoning as PlannerPanel's own weeksRef — two invite actions
  // in a row (e.g. Skip then Invite on a different row) would otherwise each
  // start from the same pre-render weeks array and the second write would
  // clobber the first.
  const plannerWeeksRef = useRef<PlannerWeek[]>(plannerWeeks);
  useEffect(() => { plannerWeeksRef.current = plannerWeeks; }, [plannerWeeks]);

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
  // Pulled out to a stable callback (not just an effect-local closure) so the
  // "Send now" auto-invite action below can force an immediate refresh after
  // it posts, instead of waiting up to REFRESH_INTERVAL to see its own result.
  const refreshInviteHistory = useCallback(() => {
    if (!territoryId) return Promise.resolve();
    return fetchPlannerWeeks(territoryId).then((weeks) => {
      const byGdPlaceId = latestInviteStatus(weeks);
      const invites = inviteHistory(weeks);
      const features = featureHistory(weeks);
      inviteCache.set(territoryId, { byGdPlaceId, invites, features, weeks, at: Date.now() });
      setInviteByGdPlaceId(byGdPlaceId);
      setInviteHistoryMap(invites);
      setFeatureHistoryMap(features);
      setPlannerWeeks(weeks);
    }).catch(() => { /* fail soft — stays "Unclaimed" instead of "Invited", Priority sort just falls back to Name */ });
  }, [territoryId]);
  useEffect(() => {
    if (!territoryId) return;
    let alive = true;
    const tick = () => { if (alive) refreshInviteHistory(); };
    tick();
    const interval = setInterval(tick, REFRESH_INTERVAL);
    return () => { alive = false; clearInterval(interval); };
  }, [territoryId, refreshInviteHistory]);

  // The invite chat funnel for this city — how far each business got through
  // the /join conversation, straight from WordPress's own step tracking (it
  // already resolves one furthest step per business across every week, so
  // nothing is re-derived here). Same 60s refresh and same fail-soft rule as
  // the invites fetch above: an error leaves this empty, which hides the panel
  // entirely. A funnel panel must never blank the page.
  useEffect(() => {
    if (!territoryId) return;
    let alive = true;
    const fetchFunnel = () => {
      authedFetch(`/api/directory/funnel?territoryId=${encodeURIComponent(territoryId)}`)
        .then((r) => r.json())
        .then((j) => {
          // A 401/501/502 body carries steps: [] — falling through here on an
          // empty steps array covers "not configured" and "errored" alike,
          // and keeps whatever was already on screen.
          if (!alive || !Array.isArray(j?.steps) || j.steps.length === 0) return;
          const steps = j.steps as JoinFunnelStep[];
          const byGdPlaceId = (j.byGdPlaceId ?? {}) as Record<number, JoinFunnelEntry>;
          funnelCache.set(territoryId, { steps, byGdPlaceId, at: Date.now() });
          setFunnelSteps(steps);
          setFunnelByGdPlaceId(byGdPlaceId);
        })
        .catch(() => {});
    };
    fetchFunnel();
    const interval = setInterval(fetchFunnel, REFRESH_INTERVAL);
    return () => { alive = false; clearInterval(interval); };
  }, [territoryId]);

  // Invite/skip actions always target THIS week (auto-created if it doesn't
  // exist yet) — same anchor runPlannerAutoInvite uses server-side, so a
  // manual send here and an automatic one land in the identical place.
  // Invites aren't really a weekly concept, but the underlying storage
  // (planner_weeks.picks.__invited) still is, and a bigger schema change to
  // move invite history off weeks entirely is a separate piece of work.
  const todayWeekIso = plannerWeekOf(todayIsoDate());
  const ensureThisWeek = async (): Promise<PlannerWeek> => {
    const existing = plannerWeeksRef.current.find((w) => w.week === todayWeekIso);
    if (existing) return existing;
    const w: PlannerWeek = {
      id: "pw_" + crypto.randomUUID(), territoryId: territoryId!, week: todayWeekIso, themeOverride: "", themeDescription: "", categories: [], notes: "", weatherNote: "",
      picks: {}, dismissed: [], invited: [], supportLocalExcluded: [], supportLocalAdded: [], archived: false, sentDate: null, wpPushedAt: null, createdAt: new Date().toISOString(),
    };
    plannerWeeksRef.current = [w, ...plannerWeeksRef.current];
    setPlannerWeeks(plannerWeeksRef.current);
    await upsertPlannerWeek(w);
    return w;
  };
  const patchThisWeek = async (patch: Partial<PlannerWeek> | ((w: PlannerWeek) => Partial<PlannerWeek>)) => {
    const w = await ensureThisWeek();
    const merged: PlannerWeek = { ...w, ...(typeof patch === "function" ? patch(w) : patch) };
    plannerWeeksRef.current = plannerWeeksRef.current.map((x) => (x.id === w.id ? merged : x));
    setPlannerWeeks(plannerWeeksRef.current);
    await upsertPlannerWeek(merged);
  };
  const bringBackBusiness = async (gdPlaceId: number) => {
    const w = await ensureThisWeek();
    let idx = -1;
    w.invited.forEach((inv, i) => { if (inv.gdPlaceId === gdPlaceId) idx = i; });
    if (idx !== -1 && w.invited[idx].status === "skipped") await patchThisWeek((cur) => ({ invited: cur.invited.map((inv, i) => (i === idx ? { ...inv, status: "invited" as const } : inv)) }));
    else if (w.dismissed.includes(gdPlaceId)) await patchThisWeek((cur) => ({ dismissed: cur.dismissed.filter((id) => id !== gdPlaceId) }));
  };
  // Sending again is allowed — a business might miss the first email, or a
  // rep might want to follow up. Every send appends its own {gdPlaceId, at}
  // entry (not deduped), so week.invited also doubles as a send count.
  const [inviteState, setInviteState] = useState<Partial<Record<number, "sending" | string>>>({});
  const [inviteArmed, setInviteArmed] = useState<number | null>(null);
  const humanizeInviteError = (err: string | undefined) =>
    err === "no_email" ? "No email on file for this listing."
    : err === "ghl_not_connected" ? "GoHighLevel isn't connected for this city yet."
    : err === "outside_business_hours" ? "Outside business hours (8am–6pm Mon–Fri) — nothing was sent, try again in the morning."
    : err || "Invite failed.";
  const sendInvite = async (gdPlaceId: number) => {
    setInviteArmed(null);
    setInviteState((m) => ({ ...m, [gdPlaceId]: "sending" }));
    try {
      const w = await ensureThisWeek();
      const res = await authedFetch("/api/planner/invite/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId, week: w.week, gdPlaceId, themeDescription: "" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setInviteState((m) => { const n = { ...m }; delete n[gdPlaceId]; return n; });
        await patchThisWeek((cur) => ({ invited: [...cur.invited, { gdPlaceId, at: new Date().toISOString(), status: "invited" as const }] }));
        return;
      }
      setInviteState((m) => ({ ...m, [gdPlaceId]: humanizeInviteError(j.error) }));
    } catch (e) {
      setInviteState((m) => ({ ...m, [gdPlaceId]: e instanceof Error ? e.message : "Invite failed." }));
    }
  };
  // One row's touch panel open at a time — same reasoning as the Territory
  // Dashboard's version: a list with several of these expanded stops being
  // scannable. Patches the one listing in place from what
  // /api/directory/activity echoes back rather than refetching the whole
  // city, so logging a touch is instant instead of waiting on a round trip.
  // touchOutcome null = closed, "manual" = opened via the plain "Log a
  // touch" trigger with nothing pre-picked, otherwise the outcome key of
  // whichever Call Now/Send Email/Send SMS/Book Meeting link was clicked —
  // same pattern as the Territory Dashboard's version of this row.
  const [touchOpenId, setTouchOpenId] = useState<number | null>(null);
  const [touchOutcome, setTouchOutcome] = useState<OutcomeKey | "manual" | null>(null);
  const openTouch = (gdPlaceId: number, outcome: OutcomeKey | "manual") => { setTouchOpenId(gdPlaceId); setTouchOutcome(outcome); };
  const patchListingTouch = (gdPlaceId: number, result: TouchResult) => {
    setTouchOpenId(null);
    setListings((prev) => (prev ?? []).map((l) => (String(l.id) === String(gdPlaceId) ? { ...l, ...result } : l)));
  };
  // The public "I'm interested" link per business — the same page the invite
  // email points at, so a rep can hand it over directly (text it, read it out
  // on a call) instead of only being able to trigger an email. Fetched for
  // every unclaimed/invited business at once, same as the old Planner queue.
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  useEffect(() => {
    if (!territoryId || !listings) return;
    const ids = listings.filter((l) => !l.claimed).map((l) => (typeof l.id === "number" ? l.id : parseInt(String(l.id), 10))).filter((id) => Number.isFinite(id));
    if (ids.length === 0) return;
    let alive = true;
    authedFetch("/api/planner/invite/links", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ territoryId, week: todayWeekIso, gdPlaceIds: ids }),
    })
      .then((r) => r.json())
      .then((j) => { if (alive && j?.links) setInviteLinks(j.links); })
      .catch(() => {});
    return () => { alive = false; };
  }, [territoryId, listings, todayWeekIso]);
  const copyInviteLink = (gdPlaceId: number) => {
    const url = inviteLinks[String(gdPlaceId)];
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLinkId(gdPlaceId);
      setTimeout(() => setCopiedLinkId((c) => (c === gdPlaceId ? null : c)), 2000);
    }).catch(() => {});
  };

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
  // newsletter feature, whichever is later. null = never touched (most urgent).
  const lastTouchedAt = (listing: DirectoryListing): string | null => {
    const inv = inviteHistoryMap.get(typeof listing.id === "number" ? listing.id : Number(listing.id))?.lastAt ?? null;
    const feat = featureHistoryMap.get(lc(listing.name))?.last ?? null;
    if (inv && feat) return inv > feat ? inv : feat;
    return inv ?? feat;
  };
  // The Priority sort's single signal, whichever actually applies to this
  // row's stage: Unclaimed/Invited are Planner's job (due for an outreach
  // touch, from lastTouchedAt above); Claimed+ are working the Playbook
  // (starts right at claim, not Onboarding — see computeBusinessStage/
  // ListingRow's onGrowthPlan) — so a business stuck on the same step for
  // STEP_STALL_DAYS+ (playbookLastProgressAt, bumped by patchTask) is just
  // as much "due" as an unclaimed prospect Planner hasn't touched. Same
  // isDue/todayIso either way.
  const priorityLastAt = (r: { listing: DirectoryListing; client: Client | null }, stage: BusinessStage): string | null => {
    if (stage === "unclaimed" || stage === "invited") return lastTouchedAt(r.listing);
    if (!r.client) return null;
    return r.client.playbookLastProgressAt ?? null;
  };
  // The comment above always said Claimed+ due-ness should use
  // STEP_STALL_DAYS (14, a real stuck-mid-pipeline signal) — but every actual
  // caller was just passing priorityLastAt straight into isDue(), which
  // silently used isDue's own default, ROTATION_WINDOW_DAYS (90, the
  // cold-prospect touch cadence). A business could sit stalled on "Pitch
  // meeting booked" for two months before either the sort or the Needs
  // attention group (below) ever noticed. This is the one place that decides
  // which window applies, by stage, so the sort and the attention group can't
  // drift onto two different definitions of "stalled."
  const isDueForStage = (lastAt: string | null, stage: BusinessStage, today: string) =>
    stage === "claimed" || stage === "interview" || stage === "onboarding"
      ? isDue(lastAt, today, STEP_STALL_DAYS)
      : isDue(lastAt, today);
  const todayIso = new Date().toISOString();
  // Exactly what runPlannerAutoInvite (plannerAutoInviteServer.ts) would pick
  // next: unclaimed only (the auto-invite is "come claim your listing," not
  // a feature invite), due for a touch, most-overdue first, capped at this
  // territory's daily_invite_cap.
  const autoInviteQueue = useMemo(() => {
    if (!dailyInviteCap || dailyInviteCap <= 0 || !listings) return [];
    return listings
      .filter((l) => !l.claimed)
      .map((l) => ({ listing: l, lastAt: lastTouchedAt(l) }))
      .filter((c) => isDue(c.lastAt, todayIso))
      .sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? ""))
      .slice(0, dailyInviteCap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, inviteHistoryMap, featureHistoryMap, dailyInviteCap, todayIso]);
  // Auto-invite status strip — the cron only ever gets one shot a day (Vercel
  // Hobby only allows a daily schedule, see plannerAutoInviteServer.ts), so
  // when that one run misses (a deploy mid-window, a transient error) there's
  // no retry and nothing goes out. This surfaces whether today's batch has
  // actually sent, and gives an admin a manual way to force it.
  const listingNameByGdPlaceId = useMemo(() => {
    const m = new Map<number, string>();
    (listings ?? []).forEach((l) => {
      const id = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
      if (Number.isFinite(id)) m.set(id, l.name);
    });
    return m;
  }, [listings]);
  const todayLocalDate = zonedDateString(new Date(), BUSINESS_TZ);
  const todayWeekEntry = useMemo(() => plannerWeeks.find((w) => w.week === todayWeekIso) ?? null, [plannerWeeks, todayWeekIso]);
  const sentAutoToday = useMemo(() => (todayWeekEntry?.invited ?? [])
    .filter((inv) => inv.by === "auto" && zonedDateString(new Date(inv.at), BUSINESS_TZ) === todayLocalDate)
    .sort((a, b) => a.at.localeCompare(b.at)), [todayWeekEntry, todayLocalDate]);
  const formatSendTime = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const formatHour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;
  const scheduledTimeLabel = formatHour12(AUTO_INVITE_START_HOUR);
  const scheduledTimePassed = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "2-digit", hour12: false }).format(new Date()), 10) % 24 >= AUTO_INVITE_START_HOUR;
  const [autoSendState, setAutoSendState] = useState<"sending" | string | null>(null);
  // The send response already carries exactly which entries it just wrote
  // (runPlannerAutoInvite's `entries` field) — merging those into local state
  // directly updates both status boxes the instant the send finishes, with no
  // extra fetchPlannerWeeks round trip (what refreshInviteHistory needs a
  // network call for) standing between "done sending" and "UI shows it."
  const mergeSentEntriesLocally = (entries: PlannerWeek["invited"]) => {
    if (!territoryId || !entries.length) return;
    const existing = plannerWeeksRef.current.find((w) => w.week === todayWeekIso);
    const merged: PlannerWeek = existing
      ? { ...existing, invited: [...existing.invited, ...entries] }
      : { id: "pw_" + crypto.randomUUID(), territoryId, week: todayWeekIso, themeOverride: "", themeDescription: "", categories: [], notes: "", weatherNote: "", picks: {}, dismissed: [], invited: entries, supportLocalExcluded: [], supportLocalAdded: [], archived: false, sentDate: null, wpPushedAt: null, createdAt: new Date().toISOString() };
    const weeks = existing ? plannerWeeksRef.current.map((w) => (w.id === existing.id ? merged : w)) : [merged, ...plannerWeeksRef.current];
    plannerWeeksRef.current = weeks;
    setPlannerWeeks(weeks);
    // Same derivations refreshInviteHistory pulls from a fresh fetch — run
    // here on the already-merged local weeks so due-ness (autoInviteQueue)
    // and invite status update in lockstep with the sent-today record above,
    // not a refresh cycle behind it.
    const byGdPlaceId = latestInviteStatus(weeks);
    const invites = inviteHistory(weeks);
    const features = featureHistory(weeks);
    inviteCache.set(territoryId, { byGdPlaceId, invites, features, weeks, at: Date.now() });
    setInviteByGdPlaceId(byGdPlaceId);
    setInviteHistoryMap(invites);
    setFeatureHistoryMap(features);
  };
  const sendAutoBatchNow = async () => {
    if (!territoryId) return;
    setAutoSendState("sending");
    try {
      const res = await authedFetch("/api/cron/planner-auto-invite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId, force: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setAutoSendState(j?.error || `Send failed (${res.status}).`); return; }
      if (j?.ran === false) { setAutoSendState("Nothing to send."); return; }
      const mine = (j?.territories ?? []).find((t: { territoryId: string }) => t.territoryId === territoryId);
      if (mine?.error) { setAutoSendState(humanizeInviteError(mine.error)); return; }
      setAutoSendState(null);
      mergeSentEntriesLocally(mine?.entries ?? []);
    } catch (e) {
      setAutoSendState(e instanceof Error ? e.message : "Send failed.");
    }
  };
  const sortRows = <T extends { listing: DirectoryListing; client: Client | null }>(arr: T[]) => [...arr].sort((a, b) => {
    if (sort === "priority") {
      const aStage = computeBusinessStage(a.listing, a.client, inviteFor(a.listing));
      const bStage = computeBusinessStage(b.listing, b.client, inviteFor(b.listing));
      const aLast = priorityLastAt(a, aStage);
      const bLast = priorityLastAt(b, bStage);
      const aDue = isDueForStage(aLast, aStage, todayIso);
      const bDue = isDueForStage(bLast, bStage, todayIso);
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
  // Same id coercion as inviteFor — the GeoDirectory place id is the join key
  // on both sides. Undefined when this business never started the chat.
  const funnelFor = (listing: DirectoryListing) => funnelByGdPlaceId[typeof listing.id === "number" ? listing.id : Number(listing.id)];
  // The open Conversation-priority task that puts a business in the attention
  // group — the same scan needsAttention has always run, just returning the
  // task itself so its due date can sub-bucket the row (see attentionRows
  // below) and its id can be handed to the Followed up action.
  const conversationTaskFor = (r: { client: Client | null }) =>
    (r.client && (tasksByClient?.get(r.client.id) ?? []).find((t) => t.status !== "done" && t.priority === "conversation")) || null;
  // The group's second trigger, next to an inbound reply: a business already
  // being worked (claimed through onboarding — not a cold prospect Planner's
  // invite queue already owns, not yet won, not parked in nurture/cancelled)
  // whose Playbook hasn't moved in STEP_STALL_DAYS. "Verification call
  // booked" that's been sitting untouched for three weeks is exactly as much
  // a "check on this" signal as an inbound reply — nothing surfaced it before
  // this, a rep had to notice on their own.
  const isStalled = (r: { listing: DirectoryListing; client: Client | null }) => {
    if (!r.client || r.client.type === "client") return false;
    const stage = computeBusinessStage(r.listing, r.client, inviteFor(r.listing));
    if (stage !== "claimed" && stage !== "interview" && stage !== "onboarding") return false;
    return isDueForStage(r.client.playbookLastProgressAt ?? null, stage, todayIso);
  };
  const needsAttention = (r: { listing: DirectoryListing; client: Client | null }) => !!conversationTaskFor(r) || isStalled(r);
  // The few words a flag row carries next to the business name: why this one
  // is up here at all. A row with no open conversation task can only be here
  // via isStalled — say that plainly rather than falling through the
  // reply-shaped checks below, which would either miss (nothing to find) or
  // resurface a stale signal from a much older reply. Otherwise, strongest
  // real signal first: how far it actually got through the invite chat
  // (WordPress's own step label), then plain invite engagement, and only
  // then the generic fact that it replied, which is what put it in the group
  // in the first place (see ATTENTION_META). Never a placeholder: a rep
  // scanning the group is deciding who to call from this line alone.
  const flagReasonFor = (r: { listing: DirectoryListing; client: Client | null }) => {
    if (!conversationTaskFor(r)) {
      const stage = computeBusinessStage(r.listing, r.client, inviteFor(r.listing));
      return `Quiet on ${STAGE_META[stage].label} for ${STEP_STALL_DAYS}+ days`;
    }
    const step = funnelFor(r.listing);
    if (step?.label) return step.label;
    const inv = inviteFor(r.listing);
    if (inv?.clickedAt) return "Clicked the invite";
    if (inv?.openedAt) return "Opened the invite";
    return "Replied";
  };
  // "We reached out, now we're waiting to hear back." Keyed by conversation
  // task id: the date the server just set, held locally so the row moves to
  // the followed-up bucket the moment the call returns instead of waiting on
  // the Realtime echo of the task row and the parent re-deriving
  // tasksByClient from it. `from` is the due date the task showed when the
  // button was clicked — the optimistic value applies only while the row
  // still shows that, so the instant it catches up (our own write echoing
  // back, or an inbound reply bumping due to today, see
  // upsertConversationTask) the task's own date takes over again and a
  // snooze can never mask a business that has since answered. Same shape as
  // inviteState above for the busy/error half: "saving", or an error string
  // to show inline with a Dismiss.
  const [followUpDue, setFollowUpDue] = useState<Record<string, { from: string | null; to: string }>>({});
  const [followUpState, setFollowUpState] = useState<Record<string, "saving" | string>>({});
  const nextCheckInFor = (r: { client: Client | null }) => {
    const t = conversationTaskFor(r);
    if (!t) return null;
    const pending = followUpDue[t.id];
    return pending && t.due === pending.from ? pending.to : t.due;
  };
  const markFollowedUp = async (taskId: string, from: string | null) => {
    setFollowUpState((m) => ({ ...m, [taskId]: "saving" }));
    try {
      const res = await authedFetch("/api/tasks/follow-up", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok && j.due) {
        setFollowUpDue((m) => ({ ...m, [taskId]: { from, to: j.due } }));
        setFollowUpState((m) => { const n = { ...m }; delete n[taskId]; return n; });
        return;
      }
      setFollowUpState((m) => ({ ...m, [taskId]: j.error || `Couldn't save that follow up (${res.status}).` }));
    } catch (e) {
      setFollowUpState((m) => ({ ...m, [taskId]: e instanceof Error ? e.message : "Couldn't save that follow up." }));
    }
  };

  // Full invite history — every send this territory has ever made, not just
  // the latest per business (that's inviteByGdPlaceId above). Feeds the
  // per-row "show history" expand and the city-wide log below.
  const invitesByGdPlaceId = useMemo(() => allInvitesByGdPlaceId(plannerWeeks), [plannerWeeks]);
  const nameByGdPlaceId = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of listings ?? []) {
      const id = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
      if (Number.isFinite(id)) m.set(id, l.name);
    }
    return m;
  }, [listings]);
  // City-wide log, grouped by the day each batch went out — newest first,
  // each day's sends newest-first within it. Capped to the most recent 20
  // days by default (see `logDaysShown` below) so a territory with months of
  // history doesn't render a huge list up front.
  const inviteLogByDay = useMemo(() => {
    const byDay = new Map<string, { gdPlaceId: number; name: string; status: PlannerInvite["status"]; by: PlannerInvite["by"] }[]>();
    for (const [gdPlaceId, invites] of invitesByGdPlaceId) {
      const name = nameByGdPlaceId.get(gdPlaceId) ?? `#${gdPlaceId}`;
      for (const inv of invites) {
        const day = inv.at.slice(0, 10);
        const list = byDay.get(day) ?? [];
        list.push({ gdPlaceId, name, status: inv.status, by: inv.by });
        byDay.set(day, list);
      }
    }
    return Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, entries]) => ({ day, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [invitesByGdPlaceId, nameByGdPlaceId]);
  const [logOpen, setLogOpen] = useState(false);
  const [logDaysShown, setLogDaysShown] = useState(20);

  // How many businesses this territory has ever invited. NOTE: this comes from
  // planner_weeks — this app's own invite log — so it counts only invites sent
  // from here and misses any sent from WordPress's own outreach board. It's
  // the top of the funnel below, which is why the "never opened it" number
  // there is clamped at zero rather than trusted to be exact.
  const invitedCount = useMemo(() => {
    let n = 0;
    for (const rec of inviteHistoryMap.values()) if (rec.invited > 0) n += 1;
    return n;
  }, [inviteHistoryMap]);
  // One row per chat step, in WordPress's own order (that order IS the funnel
  // order). `stopped` = businesses whose furthest step is exactly this one;
  // `reached` = the suffix sum, i.e. everyone who got at least this far.
  const funnelRows = useMemo(() => {
    const stoppedByStep = new Map<string, number>();
    for (const e of Object.values(funnelByGdPlaceId)) stoppedByStep.set(e.step, (stoppedByStep.get(e.step) ?? 0) + 1);
    const out = funnelSteps.map((s) => ({ value: s.value, label: s.label, stopped: stoppedByStep.get(s.value) ?? 0, reached: 0 }));
    let running = 0;
    for (let i = out.length - 1; i >= 0; i--) { running += out[i].stopped; out[i].reached = running; }
    return out;
  }, [funnelSteps, funnelByGdPlaceId]);
  const funnelTracked = funnelRows[0]?.reached ?? 0;
  // Bars are proportional to the top of the funnel, so every step reads as a
  // share of everyone who was invited (not of whoever happened to open).
  const funnelBase = Math.max(invitedCount, funnelTracked);
  const neverOpened = Math.max(0, invitedCount - funnelTracked);

  // This week's invite email — the actual copy that goes out to every business
  // in the city, stored by WordPress as one blob per (city, week) whose first
  // line is the subject. Admin only, same bar as the daily invite cap control.
  const [tplOpen, setTplOpen] = useState(false);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [tplSaved, setTplSaved] = useState("");   // last value the server confirmed, joined
  const [tplSubject, setTplSubject] = useState(""); // the two fields shown to a human
  const [tplBody, setTplBody] = useState("");
  const tplDraft = joinTemplate(tplSubject, tplBody); // what actually gets saved/compared
  const [tplBusy, setTplBusy] = useState<"saving" | "generating" | null>(null);
  // Loaded once per week, not on every expand — collapsing the panel with
  // unsaved edits and reopening it shouldn't silently throw them away.
  const tplLoadedWeek = useRef<string | null>(null);
  useEffect(() => {
    if (!tplOpen || !territoryId || !canAdmin) return;
    if (tplLoadedWeek.current === todayWeekIso) return;
    let alive = true;
    setTplLoading(true);
    setTplErr(null);
    authedFetch(`/api/planner/template?territoryId=${encodeURIComponent(territoryId)}&week=${todayWeekIso}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setTplErr(j?.error || `Couldn't load this week's email (${r.status}).`); return; }
        tplLoadedWeek.current = todayWeekIso;
        setTplSaved(j.email ?? "");
        const [subj, body] = splitTemplate(j.email ?? "");
        setTplSubject(subj);
        setTplBody(body);
      })
      .catch((e) => { if (alive) setTplErr(String(e?.message ?? e)); })
      .finally(() => { if (alive) setTplLoading(false); });
    return () => { alive = false; };
  }, [tplOpen, territoryId, canAdmin, todayWeekIso]);
  const saveTemplate = async () => {
    if (!territoryId) return;
    setTplBusy("saving");
    setTplErr(null);
    try {
      const res = await authedFetch("/api/planner/template", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId, week: todayWeekIso, value: tplDraft }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setTplErr(j?.error || `Save failed (${res.status}).`); return; }
      setTplSaved(tplDraft);
    } catch (e) {
      setTplErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setTplBusy(null);
    }
  };
  // Replaces the textarea contents only — nothing is written until Save, so a
  // regenerate that comes back worse is one undo (reload) away.
  const regenerateTemplate = async () => {
    if (!territoryId) return;
    setTplBusy("generating");
    setTplErr(null);
    try {
      const res = await authedFetch("/api/planner/template/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId, week: todayWeekIso }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok || !j.text) { setTplErr(j?.error || `Couldn't draft a new email (${res.status}).`); return; }
      const [subj, body] = splitTemplate(j.text);
      setTplSubject(subj);
      setTplBody(body);
    } catch (e) {
      setTplErr(e instanceof Error ? e.message : "Couldn't draft a new email.");
    } finally {
      setTplBusy(null);
    }
  };

  const filtered = rows.filter(matchRow);
  const total = filtered.length;
  const nonBusinessCount = noListing.length;
  const categoryCh = Math.min(CATEGORY_MAX_CH, Math.max(CATEGORY_MIN_CH, ...filtered.map((r) => r.listing.category.length)));
  const template = `minmax(0,1fr) ${categoryCh}ch 148px`;

  if (loading) return <div className="bg-background p-4 py-10 text-center text-[13px] text-muted sm:p-5">Loading directory for {city}…</div>;

  // The attention group splits in two on its own conversation task's due
  // date, which on these tasks doubles as "last touched" (see
  // upsertConversationTask): no due date, or one that's today or older, means
  // nobody has reached out yet — or the follow-up window ran out and it's
  // gone cold again — so it needs a first touch today. A due date still in
  // the future means a rep already reached out (the Followed up button set
  // it) and is waiting to hear back, which is worked, not urgent. Every
  // business here lands in exactly one of the two, same as the engagement
  // ladder below.
  const todayDate = todayIsoDate();
  const attentionAll = filtered.filter(needsAttention);
  const attentionRows = sortRows(attentionAll.filter((r) => { const d = nextCheckInFor(r); return !d || d <= todayDate; }));
  const followedUpRows = sortRows(attentionAll.filter((r) => { const d = nextCheckInFor(r); return !!d && d > todayDate; }));
  // The engagement ladder — each business sits in exactly the strongest tier
  // it qualifies for (accepted > clicked > opened), never more than one, so
  // these three groups partition the unclaimed/invited pool instead of
  // overlapping.
  const acceptedNotClaimed = (r: { listing: DirectoryListing }) => !r.listing.claimed && inviteFor(r.listing)?.status === "accepted";
  const clickedNotAnswered = (r: { listing: DirectoryListing }) => {
    const inv = inviteFor(r.listing);
    return !r.listing.claimed && !!inv && inv.status !== "accepted" && !!inv.clickedAt;
  };
  const openedNotClicked = (r: { listing: DirectoryListing }) => {
    const inv = inviteFor(r.listing);
    return !r.listing.claimed && !!inv && inv.status !== "accepted" && !inv.clickedAt && !!inv.openedAt;
  };
  const acceptedRows = sortRows(filtered.filter(acceptedNotClaimed));
  const clickedRows = sortRows(filtered.filter(clickedNotAnswered));
  const openedRows = sortRows(filtered.filter(openedNotClicked));
  const stageRows = new Map<BusinessStage, typeof filtered>();
  for (const key of STAGE_ORDER) stageRows.set(key, []);
  for (const r of filtered) stageRows.get(computeBusinessStage(r.listing, r.client, inviteFor(r.listing)))!.push(r);
  for (const key of STAGE_ORDER) stageRows.set(key, sortRows(stageRows.get(key)!));

  type Group = { key: string; label: string; color: string; hint: string; rows: typeof filtered };
  const groups: Group[] = [];
  if (attentionRows.length) groups.push({ key: "attention", label: ATTENTION_META.label, color: ATTENTION_META.color, hint: ATTENTION_META.hint, rows: attentionRows });
  if (followedUpRows.length) groups.push({ key: "followed_up", label: FOLLOWED_UP_META.label, color: FOLLOWED_UP_META.color, hint: FOLLOWED_UP_META.hint, rows: followedUpRows });
  if (acceptedRows.length) groups.push({ key: "accepted", label: ACCEPTED_META.label, color: ACCEPTED_META.color, hint: ACCEPTED_META.hint, rows: acceptedRows });
  if (clickedRows.length) groups.push({ key: "clicked", label: CLICKED_META.label, color: CLICKED_META.color, hint: CLICKED_META.hint, rows: clickedRows });
  if (openedRows.length) groups.push({ key: "opened", label: OPENED_META.label, color: OPENED_META.color, hint: OPENED_META.hint, rows: openedRows });
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

      {/* Auto-invite status strip — did today's 9am Pacific run actually go
          out? It only gets one shot a day with no retry (see
          plannerAutoInviteServer.ts), so this is the "did it happen, and if
          not, make it happen" surface: once any auto sends land today it
          holds up here as a record of who got sent and when, rather than
          disappearing back into the queue box below. */}
      {territoryId && dailyInviteCap && dailyInviteCap > 0 && (sentAutoToday.length > 0 || autoInviteQueue.length > 0) && (
        <div className="mb-2 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2.5">
          {sentAutoToday.length > 0 && (
            <div className={autoInviteQueue.length > 0 ? "mb-2 border-b border-accent/20 pb-2" : ""}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-emerald-700">Today&apos;s auto-invite batch, sent</div>
                <div className="text-[12px] font-medium text-emerald-700">{sentAutoToday.length} invite{sentAutoToday.length === 1 ? "" : "s"} at {formatSendTime(sentAutoToday[0].at)}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sentAutoToday.map((inv, i) => (
                  <span key={inv.gdPlaceId + "-" + i} className="rounded-full border border-emerald-400/40 bg-surface px-2 py-0.5 text-[12px] font-medium text-emerald-800">
                    {listingNameByGdPlaceId.get(inv.gdPlaceId) ?? `#${inv.gdPlaceId}`}
                  </span>
                ))}
              </div>
            </div>
          )}
          {autoInviteQueue.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-accent">
                {sentAutoToday.length > 0 ? `${autoInviteQueue.length} more ready to send` : `${autoInviteQueue.length} of ${dailyInviteCap} slots ready`}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-medium ${scheduledTimePassed && sentAutoToday.length === 0 ? "text-amber-700" : "text-muted"}`}>
                  {scheduledTimePassed && sentAutoToday.length === 0 ? "Didn't send automatically, scheduled for " : "Scheduled for "}{scheduledTimeLabel} Pacific
                </span>
                {canAdmin && (
                  <button
                    onClick={sendAutoBatchNow}
                    disabled={autoSendState === "sending"}
                    className="rounded-md border border-accent/40 bg-surface px-2 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-60"
                  >
                    {autoSendState === "sending" ? "Sending…" : "Send now"}
                  </button>
                )}
              </div>
            </div>
          )}
          {autoSendState && autoSendState !== "sending" && (
            <div className="mt-1.5 text-[12px] text-red-600">{autoSendState}</div>
          )}
        </div>
      )}

      {/* The invite queue itself lives in the Unclaimed/Invited stage groups
          below (Invite/Skip/Copy-link on each row) — this secondary box is
          just the standing preview of who is queued for the next auto-invite
          run, independent of whether today's batch above has already sent:
          before it sends, this is the same list; after, it is whoever is
          next in line (the just-sent businesses are no longer due). */}
      {territoryId && (
        dailyInviteCap && dailyInviteCap > 0 ? (
          <div className="mb-2 rounded-lg border bg-surface px-3 py-2.5">
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Next auto-invite batch, {autoInviteQueue.length} of {dailyInviteCap} slots</div>
            {autoInviteQueue.length === 0 ? (
              <div className="text-[13px] text-muted">Nothing due right now — nobody unclaimed is overdue for a touch.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {autoInviteQueue.map((c) => (
                  <span key={c.listing.id} title={c.lastAt ? `Last invited ${c.lastAt.slice(0, 10)}` : "Never invited"} className="rounded-full border border-accent/40 bg-surface px-2 py-0.5 text-[12px] font-medium">
                    {c.listing.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : canAdmin ? (
          <div className="mb-2 rounded-lg border bg-background/40 px-3 py-2 text-[12px] text-muted">Auto-invite is off for {city} — set a daily cap in Settings → Territories to turn it on.</div>
        ) : null
      )}

      {/* Invite chat funnel — of everyone invited, how far they got through
          the /join conversation. "Stopped here" carries the visual weight on
          purpose: it's the number that answers "which chat screen do I fix
          next". Hidden entirely when WordPress isn't reachable or isn't
          configured (funnelRows stays empty), never an error state. */}
      {territoryId && funnelRows.length > 0 && (
        <div className="mb-2 rounded-lg border bg-surface px-3 py-2.5">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">Invite chat funnel — where {city} businesses stop</div>
          <div className="mb-2 text-[12px] text-muted">Reached counts everyone who got at least this far. Stopped here is the screen they never got past.</div>
          <div className="mb-1 grid gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted" style={{ gridTemplateColumns: "minmax(0,1fr) 84px" }}>
            <span>Step</span>
            <span className="text-right">Stopped here</span>
          </div>
          <div className="space-y-1.5">
            {/* Top of the funnel, from this app's own invite log rather than
                WordPress's step tracking — see invitedCount above. */}
            <div className="grid items-center gap-2 border-b pb-1.5" style={{ gridTemplateColumns: "minmax(0,1fr) 84px" }}>
              <div className="flex min-w-0 items-baseline gap-1.5 text-[12px]">
                <span className="truncate font-medium text-foreground">Invited</span>
                <span className="shrink-0 text-muted">{invitedCount} sent</span>
              </div>
              <div className="text-right" title="Invited but never opened the chat. Counted from invites sent here, so an invite sent from the WordPress board isn't in it.">
                <span className={`text-[13px] font-bold ${neverOpened > 0 ? "text-amber-600" : "text-muted"}`}>{neverOpened}</span>
                <span className="ml-1 text-[12px] text-muted">never opened</span>
              </div>
            </div>
            {funnelRows.map((s) => (
              <div key={s.value} className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0,1fr) 84px" }}>
                <div className="min-w-0">
                  <div className="mb-0.5 flex min-w-0 items-baseline gap-1.5 text-[12px]">
                    <span className="truncate font-medium text-foreground">{s.label}</span>
                    <span className="shrink-0 text-muted">{s.reached} reached</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                    <div className="h-full rounded-full bg-accent/70" style={{ width: `${funnelBase ? (s.reached / funnelBase) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="text-right text-[13px]">
                  <span className={s.stopped > 0 ? "font-bold text-amber-600" : "text-muted"}>{s.stopped}</span>
                </div>
              </div>
            ))}
          </div>
          {funnelTracked === 0 && (
            <div className="mt-2 text-[12px] text-muted">No chat steps recorded yet — step tracking only just went live, so this fills in as businesses open their invites.</div>
          )}
        </div>
      )}

      {/* Every invite this territory has ever sent, grouped by day — "will
          there be a history of invites sent" (Derek, Aug 3). Collapsed by
          default; a business's own row also shows its individual history
          (see ListingRow's invite chip below). */}
      {territoryId && inviteLogByDay.length > 0 && (
        <div className="mb-2 rounded-lg border bg-surface">
          <button onClick={() => setLogOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-muted hover:text-foreground">
            <I.chevron className={`shrink-0 transition ${logOpen ? "-rotate-90" : "rotate-90"}`} />
            Invite history — {inviteLogByDay.reduce((n, d) => n + d.entries.length, 0)} sent total
          </button>
          {logOpen && (
            <div className="max-h-96 overflow-y-auto border-t px-3 py-2">
              {inviteLogByDay.slice(0, logDaysShown).map(({ day, entries }) => (
                <div key={day} className="mb-2.5 last:mb-0">
                  <div className="mb-1 text-[12px] font-semibold text-foreground">{formatDue(day)} <span className="font-normal text-muted">— {entries.length} sent</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {entries.map((e, i) => (
                      <span key={e.gdPlaceId + "-" + i} title={e.by === "auto" ? "Auto-sent" : "Sent manually"}
                        className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${e.status === "accepted" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : e.status === "skipped" ? "border-border bg-background text-muted" : "border-accent/30 bg-accent-soft/40 text-accent"}`}>
                        {e.name}{e.by === "auto" && " ⚙️"}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {inviteLogByDay.length > logDaysShown && (
                <button onClick={() => setLogDaysShown((n) => n + 20)} className="mt-1 text-[12px] font-medium text-accent hover:underline">Show older days</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* This week's invite email — the copy every business in the city
          receives. WordPress stores it as ONE blob per (city, week) whose
          first line is "Subject: ...", but a human editing it wants two
          fields, not one box with the subject buried in line one — split for
          display, rejoined into that same one-blob format on save (see
          splitTemplate/joinTemplate above). Same week the panels above use;
          there's deliberately no week picker. Admin only, matching the daily
          invite cap control. */}
      {territoryId && canAdmin && (
        <div className="mb-2 rounded-lg border bg-surface">
          <button onClick={() => setTplOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-muted hover:text-foreground">
            <I.chevron className={`shrink-0 transition ${tplOpen ? "-rotate-90" : "rotate-90"}`} />
            This week&apos;s invite email — the copy every {city} business gets
          </button>
          {tplOpen && (
            <div className="border-t px-3 py-2.5">
              {tplErr && <div className="mb-2 rounded-md border border-amber-400/40 bg-amber-50/50 px-2 py-1.5 text-[12px] text-amber-800">{tplErr}</div>}
              {tplLoading ? (
                <div className="py-4 text-center text-[13px] text-muted">Loading this week&apos;s email…</div>
              ) : (
                <>
                  <div className="mb-1.5 text-[12px] text-muted">
                    Keep the placeholders below intact; each one is filled in per business when the email sends.
                  </div>
                  <div className="mb-1.5 flex flex-wrap gap-1.5 text-[12px]">
                    {[
                      { tag: "{{business}}", what: "the business name" },
                      { tag: "{{invite_link}}", what: "their own chat link" },
                      { tag: "{{listing_link}}", what: "their public listing page" },
                      { tag: "{{user.email_signature}}", what: "the ambassador's signature" },
                    ].map((p) => (
                      <span key={p.tag} title={p.what} className="rounded border bg-background px-1.5 py-0.5 font-medium text-muted">
                        <code>{p.tag}</code> <span className="font-normal">{p.what}</span>
                      </span>
                    ))}
                  </div>
                  <label className="mb-2 block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Subject</span>
                    <input value={tplSubject} onChange={(e) => setTplSubject(e.target.value)} spellCheck
                      placeholder="A free feature for {{business}}"
                      className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Body</span>
                    <textarea value={tplBody} onChange={(e) => setTplBody(e.target.value)} rows={13} spellCheck
                      placeholder={"Hi there,\n…"}
                      className="w-full rounded-lg border bg-background px-2.5 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-accent" />
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button onClick={saveTemplate} disabled={tplDraft === tplSaved || tplBusy !== null}
                      title={tplDraft === tplSaved ? "Nothing to save yet" : "Save this copy for the week"}
                      className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                      {tplBusy === "saving" ? "Saving…" : "Save"}
                    </button>
                    <button onClick={regenerateTemplate} disabled={tplBusy !== null}
                      title="Draft a fresh email from this week's theme — replaces what's in the box, saves nothing until you click Save"
                      className="rounded-lg border bg-surface px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                      {tplBusy === "generating" ? "Drafting…" : "Regenerate"}
                    </button>
                    <span className="text-[12px] text-muted">
                      {tplDraft !== tplSaved ? "Unsaved changes" : tplSaved ? "Saved" : "Nothing saved yet — an email is drafted automatically at send time until you write one."}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
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
                {isOpen && g.rows.map((r) => {
                  const rawId = typeof r.listing.id === "number" ? r.listing.id : parseInt(String(r.listing.id), 10);
                  const gdPlaceId = Number.isFinite(rawId) ? rawId : null;
                  // Invite/Skip/Copy-link only make sense for a real listing
                  // id, scoped to a single territory — the admin multi-city
                  // overview (no territoryId) stays a read-only list.
                  const inviteActions = gdPlaceId != null && territoryId ? {
                    gdPlaceId,
                    state: inviteState[gdPlaceId],
                    armed: inviteArmed === gdPlaceId,
                    onArm: () => setInviteArmed(gdPlaceId),
                    onSend: () => sendInvite(gdPlaceId),
                    onDismissError: () => setInviteState((m) => { const n = { ...m }; delete n[gdPlaceId]; return n; }),
                    onBringBack: () => bringBackBusiness(gdPlaceId),
                    link: inviteLinks[String(gdPlaceId)],
                    onCopyLink: () => copyInviteLink(gdPlaceId),
                    copied: copiedLinkId === gdPlaceId,
                  } : null;
                  // The two attention groups are flags pointing down at a real
                  // listing, not a second copy of it: they render a one line
                  // FlagRow instead of the full card, and the real row in the
                  // business's own stage group carries a small "flagged above"
                  // tag back up to them. Everything else (the engagement
                  // ladder, every funnel stage) renders exactly as before.
                  const isFlagGroup = g.key === "attention" || g.key === "followed_up";
                  const convo = conversationTaskFor(r);
                  // Only in the two attention groups, the same way the
                  // invite actions above only render for the two stages they
                  // apply to — an attention row also appears in its normal
                  // stage group below, and the button belongs where a rep is
                  // actually working the replies, not on both copies.
                  const convoTask = isFlagGroup ? convo : null;
                  const convoDue = convoTask ? nextCheckInFor(r) : null;
                  const followUp = convoTask ? {
                    // Only a date still ahead of us is a live "we're waiting
                    // on them" promise — a lapsed one is why this row is back
                    // in "Needs attention now", so it says nothing useful on
                    // the row and the history stays in the task's comments.
                    nextCheckIn: convoDue && convoDue > todayDate ? convoDue : null,
                    state: followUpState[convoTask.id],
                    onFollowUp: () => markFollowedUp(convoTask.id, convoTask.due),
                    onDismissError: () => setFollowUpState((m) => { const n = { ...m }; delete n[convoTask.id]; return n; }),
                  } : null;
                  const stage = computeBusinessStage(r.listing, r.client, inviteFor(r.listing));
                  if (isFlagGroup) {
                    return (
                      <FlagRow key={g.key + r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient}
                        stage={stage}
                        // Followed up already reached out, so the date it comes
                        // back is the headline and the button steps aside.
                        waiting={g.key === "followed_up"}
                        reason={g.key === "followed_up" ? null : flagReasonFor(r)}
                        followUp={followUp} />
                    );
                  }
                  return (
                    <ListingRow key={g.key + r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient} template={template}
                      stage={stage}
                      flaggedAbove={STAGE_KEYS.has(g.key) && needsAttention(r)}
                      invite={inviteFor(r.listing)}
                      funnelStep={funnelFor(r.listing)}
                      inviteHistoryList={gdPlaceId != null ? invitesByGdPlaceId.get(gdPlaceId) ?? [] : []}
                      onSetClientStatus={onSetClientStatus} canAdmin={canAdmin} ghlContactUrlFor={ghlContactUrlFor}
                      featured={!!r.client && !!featuredClientIds?.has(r.client.id)}
                      canFeature={!!(r.client || r.contact)}
                      onFeature={onFeature && ((rr) => onFeature({ clientId: rr.client?.id ?? null, contact: rr.contact, name: rr.listing.name, city, state }))}
                      playbookTasks={(r.client && playbookTasksByClient?.get(r.client.id)) || []} onOpenPlaybook={onOpenPlaybook}
                      otherLists={(r.client && otherListsByClient?.get(r.client.id)) || []} onOpenProject={onOpenProject}
                      inviteActions={inviteActions} followUp={followUp}
                      touch={gdPlaceId != null ? {
                        gdPlaceId,
                        outcome: touchOpenId === gdPlaceId ? touchOutcome : null,
                        onPick: (outcome) => openTouch(gdPlaceId, outcome),
                        onClose: () => setTouchOpenId(null),
                        onLogged: (result) => patchListingTouch(gdPlaceId, result),
                      } : null}
                      highlighted={gdPlaceId != null && highlightedRowId === gdPlaceId} />
                  );
                })}
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

// The connector from a flag down to the real listing it points at — a stem
// with an arrowhead rather than a bare chevron, so the line reads as a thread
// between two places on the page instead of a collapse toggle.
const ThreadArrow = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden className="shrink-0 text-border">
    <path d="M5 0V10M5 10L1 6M5 10L9 6" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

// One line in "Needs attention now" / "Followed up, waiting to hear back".
// These two groups are the only ones whose rows are not really listings: the
// same business always renders again in its own funnel stage below, so a full
// ListingRow here (icons, chips, a stack of buttons) read as an accidental
// duplicate rather than as what it is — a pin on one real listing. So: a pin,
// the name, why it's flagged, one action, and a thread naming the stage the
// real row is sitting in. Everything else about that business stays on the
// real row; this is a pointer, not a card.
function FlagRow({ row, onAddContact, onOpenClient, stage, reason, waiting, followUp }: {
  row: { listing: DirectoryListing; contact: Contact | null; client: Client | null };
  onAddContact: (c: Contact) => void;
  onOpenClient: (id: string) => void;
  // Where the real row lives, so the thread below can name it.
  stage: BusinessStage;
  // Why this business is flagged, in a few words (see flagReasonFor). null in
  // the followed up group, where the group header already says it and the
  // check back date is the point of the row.
  reason: string | null;
  // Followed up bucket: somebody already reached out, so the row is
  // informational. The check back date leads and the button stays available
  // but quiet, since clicking it again just buys another few days.
  waiting: boolean;
  // Same wiring the full row uses — see ListingRow's own followUp prop.
  followUp?: {
    nextCheckIn: string | null;
    state: "saving" | string | undefined;
    onFollowUp: () => void;
    onDismissError: () => void;
  } | null;
}) {
  const { listing, contact, client } = row;
  const nameMouseDown = useRef<{ x: number; y: number } | null>(null);
  const openThis = client ? () => onOpenClient(client.id) : contact ? () => onAddContact(contact) : null;

  return (
    <div className="border-b last:border-0">
      <div className="grid items-center gap-2.5 px-4 py-2 transition-colors hover:bg-accent-soft/50" style={{ gridTemplateColumns: "16px minmax(0,1fr) auto" }}>
        <span title="Flagged from its listing below" className="text-[13px] leading-none">📌</span>
        <div className="min-w-0 truncate text-[13px]">
          {openThis ? (
            <button onMouseDown={(e) => { nameMouseDown.current = { x: e.clientX, y: e.clientY }; }}
              onClick={(e) => { if (!isDragClick(nameMouseDown.current, e)) openThis(); }} title="Open this business"
              className="text-left font-semibold hover:text-accent hover:underline">{listing.name}</button>
          ) : (
            <span className="font-semibold">{listing.name}</span>
          )}
          {reason && <span className="text-muted"> · <span className="font-medium text-foreground">{reason}</span></span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {followUp && (
            followUp.state === "saving" ? (
              <span className="text-[12px] text-muted">Saving…</span>
            ) : followUp.state ? (
              <span className="flex items-center gap-1.5 text-[12px]">
                <span className="text-danger">{followUp.state}</span>
                <button onClick={followUp.onDismissError} className="font-medium text-muted hover:text-foreground">Dismiss</button>
              </span>
            ) : waiting ? (
              <>
                {followUp.nextCheckIn && (
                  <span title="When this business comes back to “Needs attention now” if we still haven’t heard back"
                    className="rounded-md bg-background px-2 py-1 text-[12px] font-medium text-muted">
                    Check back {formatDue(followUp.nextCheckIn)}
                  </span>
                )}
                <button onClick={followUp.onFollowUp}
                  title="Reached out again? This pushes the check back date out another three days."
                  className="text-[12px] font-medium text-muted hover:text-foreground hover:underline">
                  ↩ Followed up
                </button>
              </>
            ) : (
              <button onClick={followUp.onFollowUp}
                title="Record that you reached out. This business moves out of the way for three days, then comes back if nothing happens."
                className="rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground">
                ↩ Followed up
              </button>
            )
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 bg-background/40 px-4 py-1 pl-[42px] text-[12px] text-muted">
        <ThreadArrow />
        full listing is below, in {STAGE_META[stage].label}
      </div>
    </div>
  );
}

function ListingRow({ row, onAddContact, onOpenClient, template, stage, flaggedAbove, invite, funnelStep, inviteHistoryList, onSetClientStatus, canAdmin, ghlContactUrlFor, featured, canFeature, onFeature, playbookTasks, onOpenPlaybook, otherLists, onOpenProject, inviteActions, followUp, touch, highlighted }: {
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
  // True when this business is also flagged up top (it has an open
  // conversation task, so a FlagRow points down at this row) — shows a quiet
  // tag saying so, since scrolling straight past the top groups shouldn't
  // hide that somebody is mid conversation with them. Only ever set on the
  // real stage row: inside the flag groups the row already IS the flag.
  flaggedAbove?: boolean;
  // This business's most recent Content Planner invite, if any — undefined
  // when it's never been invited (or territoryId wasn't passed down, e.g.
  // the admin multi-city overview).
  invite?: PlannerInvite;
  // The furthest step this business ever reached in the invite chat, from
  // WordPress's own tracking. Undefined when it never started the chat (or
  // the funnel isn't reachable) — no chip in that case. Lives on the sub-line
  // with the other engagement chips rather than in a grid column: that grid
  // is a computed three-track template whose width math is already fragile.
  funnelStep?: JoinFunnelEntry;
  // Every invite ever sent to this business, newest first (invite above is
  // just the first entry of this same list) — click-to-expand full history.
  // Empty when never invited or no valid listing id.
  inviteHistoryList: PlannerInvite[];
  // Editable Stage dropdown (claimed businesses with a client record only,
  // and only for admins — canAdmin gates it below).
  onSetClientStatus?: (id: string, status: ClientStatus) => void;
  canAdmin?: boolean;
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
  // This business's other (non-Playbook) lists, pre-computed with
  // their own done/total counts — one pill per list, click-through to that
  // list rather than an inline expand. Empty when it has none (or no client yet).
  otherLists: { id: string; name: string; done: number; total: number }[];
  onOpenProject?: (clientId: string, projectId: string) => void;
  // Invite/Skip/Copy-link for this row — null when there's no valid listing
  // id or no territory to scope the send to (the admin multi-city overview).
  inviteActions?: {
    gdPlaceId: number;
    state: "sending" | string | undefined;
    armed: boolean;
    onArm: () => void;
    onSend: () => void;
    onDismissError: () => void;
    onBringBack: () => void;
    link: string | undefined;
    onCopyLink: () => void;
    copied: boolean;
  } | null;
  // "Followed up" for this row's open conversation task — null everywhere
  // except the two attention groups (nothing to snooze anywhere else).
  // nextCheckIn is that task's due date, i.e. when this business comes back
  // to "Needs attention now" if nothing has happened by then; null when
  // nobody has followed up yet.
  followUp?: {
    nextCheckIn: string | null;
    state: "saving" | string | undefined;
    onFollowUp: () => void;
    onDismissError: () => void;
  } | null;
  // Log a call/email/SMS/visit/appointment against this listing, same panel
  // the Territory Dashboard uses — null when there's no valid listing id to
  // key the write by.
  touch?: {
    gdPlaceId: number;
    // null = panel closed. "manual" = opened via the plain trigger with
    // nothing pre-picked, otherwise which Call Now/Send Email/Send
    // SMS/Book Meeting link was clicked.
    outcome: OutcomeKey | "manual" | null;
    onPick: (outcome: OutcomeKey | "manual") => void;
    onClose: () => void;
    onLogged: (result: TouchResult) => void;
  } | null;
  // Briefly flashed true when this row is the deep-link target of "Open in
  // Businesses" from the Territory Dashboard — fades on its own, see the
  // parent's highlightListingId effect.
  highlighted?: boolean;
}) {
  const { listing, contact, client } = row;
  const nameMouseDown = useRef<{ x: number; y: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // The whole point of this page once a business claims is working through
  // the Playbook with them (Derek, Aug 4) — the Sales checklist that used to
  // run pre-claim is retired, so Playbook shows for any claimed+ business.
  const onGrowthPlan = stage !== "unclaimed" && stage !== "invited";
  const playbook = client && onGrowthPlan ? playbookCompletion(client.id, playbookTasks) : null;
  const ghlUrl = client ? ghlContactUrlFor?.(client.id) : null;

  return (
    <div id={`listing-row-${listing.id}`}
      className={`border-b text-[15px] transition-colors last:border-0 hover:bg-accent-soft/50 ${highlighted ? "bg-accent-soft ring-2 ring-inset ring-accent" : ""}`}>
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
            {/* Client's own GHL contact (a real sub-account) wins once one
                exists; listing.ghlUrl is the pre-claim fallback, resolved
                against the shared directory sub-account — same contact
                either way, just a different location until it claims. */}
            {(ghlUrl || listing.ghlUrl) && <a href={ghlUrl || listing.ghlUrl} target="_blank" rel="noopener noreferrer" title="Open in GoHighLevel" className="shrink-0 rounded p-0.5 text-muted hover:bg-surface hover:text-accent"><I.bolt /></a>}
            {listing.url && <a href={listing.url} target="_blank" rel="noopener noreferrer" title="View public listing page" className="shrink-0 rounded p-0.5 text-muted hover:bg-surface hover:text-accent"><I.link /></a>}
            {listing.editUrl && <a href={listing.editUrl} target="_blank" rel="noopener noreferrer" title="Edit business profile (WordPress admin)" className="shrink-0 rounded p-0.5 text-muted hover:bg-surface hover:text-accent"><I.pencil /></a>}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-5 text-[12px] text-muted">
            {flaggedAbove && (
              <span title="Someone replied, so this business is also flagged in the group at the top of the page"
                className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700">
                📌 flagged above
              </span>
            )}
            {invite && (
              inviteHistoryList.length > 1 ? (
                <button onClick={() => setHistoryOpen((v) => !v)}
                  title={`Sent ${inviteHistoryList.length} times — click to see every send`}
                  className={`rounded px-1.5 py-0.5 font-medium hover:underline ${invite.status === "accepted" ? "bg-emerald-100 text-emerald-700" : invite.status === "skipped" ? "bg-background text-muted" : "bg-accent-soft text-accent"}`}>
                  {invite.status === "accepted" ? "✅ Accepted" : invite.status === "skipped" ? "⏭ Skipped" : "✉️ Invited"} {formatDue(invite.at)} · {inviteHistoryList.length}×
                </button>
              ) : (
                <span title={`Content Planner invite, ${formatDue(invite.at)}`}
                  className={`rounded px-1.5 py-0.5 font-medium ${invite.status === "accepted" ? "bg-emerald-100 text-emerald-700" : invite.status === "skipped" ? "bg-background text-muted" : "bg-accent-soft text-accent"}`}>
                  {invite.status === "accepted" ? "✅ Accepted" : invite.status === "skipped" ? "⏭ Skipped" : "✉️ Invited"} {formatDue(invite.at)}
                </span>
              )
            )}
            {invite && invite.status !== "accepted" && (invite.clickedAt || invite.openedAt) && (
              <span title={invite.clickedAt ? `Clicked the invite link ${formatDue(invite.clickedAt)}` : `Opened the invite email ${formatDue(invite.openedAt!)}`}
                className="rounded bg-cyan-100 px-1.5 py-0.5 font-medium text-cyan-700">
                {invite.clickedAt ? "🖱️ Clicked" : "👀 Opened"}
              </span>
            )}
            {funnelStep && (
              <span title={`Furthest step in the invite chat${funnelStep.at ? `, ${formatDue(new Date(funnelStep.at * 1000).toISOString())}` : ""}`}
                className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700">
                💬 {funnelStep.label}
              </span>
            )}
            {listing.rep && <span>· {listing.rep}</span>}
          </div>
          {historyOpen && inviteHistoryList.length > 1 && (
            <div className="ml-5 mt-1 space-y-0.5 rounded-md border bg-background/60 px-2 py-1.5 text-[12px]">
              {inviteHistoryList.map((h, i) => (
                <div key={i} className="flex items-center gap-1.5 text-muted">
                  <span className="font-medium text-foreground">{formatDue(h.at)}</span>
                  <span>{h.status === "accepted" ? "✅ Accepted" : h.status === "skipped" ? "⏭ Skipped" : "✉️ Invited"}</span>
                  {h.by === "auto" && <span title="Auto-sent">⚙️ Auto</span>}
                </div>
              ))}
            </div>
          )}
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
          {client && onSetClientStatus && canAdmin && stage !== "unclaimed" && stage !== "invited" ? (
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
          {/* Every other list this business has (excluding Playbook, which
              gets its own pill above) — one pill per list, same X/Y
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

      {/* "Followed up" — the one action for a business that replied. It does
          NOT close the conversation task (closing is what already existed,
          and it throws away the fact that we're still waiting on an answer):
          it pushes the task's due date out three days, which moves this row
          into "Followed up, waiting to hear back" until that date passes and
          it resurfaces on its own. Available in both attention groups, so a
          second touch on a business that still hasn't answered buys another
          three days rather than needing the row closed. */}
      {followUp && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 pl-9 pt-1.5 sm:pl-9">
          {followUp.state === "saving" ? (
            <span className="shrink-0 text-[12px] text-muted">Saving…</span>
          ) : followUp.state ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[12px]">
              <span className="text-danger">{followUp.state}</span>
              <button onClick={followUp.onDismissError} className="font-medium text-muted hover:text-foreground">Dismiss</button>
            </span>
          ) : (
            <button onClick={followUp.onFollowUp}
              title="Record that you reached out. This business moves out of the way for three days, then comes back if nothing happens."
              className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground">
              ↩ Followed up
            </button>
          )}
          {followUp.nextCheckIn && (
            <span title="When this business comes back to “Needs attention now” if we still haven’t heard back"
              className="shrink-0 rounded-md bg-background px-2 py-1 text-[12px] font-medium text-muted">
              Check back {formatDue(followUp.nextCheckIn)}
            </span>
          )}
        </div>
      )}

      {/* The invite queue's own actions — Copy-link and a two-click
          Invite/Confirm (mirrors WP's own caution around a button that sends
          a real email) — only for the two stages it applies to. Skip is
          retired (Derek, Aug 4); "↺ Bring back" stays only to un-stick any
          business skipped before that. Once claimed, this business's "what's
          left" is Playbook progress above, not invite state. */}
      {(inviteActions || touch) && (stage === "unclaimed" || stage === "invited") && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 pl-9 pt-1.5 sm:pl-9">
          {inviteActions && (
            invite?.status === "skipped" ? (
              <button onClick={inviteActions.onBringBack} className="shrink-0 text-[12px] font-semibold text-accent hover:underline">↺ Bring back</button>
            ) : (
              <>
                {invite?.status === "accepted" && <span className="shrink-0 rounded-md bg-emerald-100 px-2 py-1 text-[12px] font-semibold text-emerald-700">Accepted</span>}
                {inviteActions.link && (
                  <button onClick={inviteActions.onCopyLink} title={inviteActions.link} className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground">
                    {inviteActions.copied ? "Copied ✓" : "🔗 Copy link"}
                  </button>
                )}
                {inviteActions.state === "sending" ? (
                  <span className="shrink-0 text-[12px] text-muted">Sending…</span>
                ) : inviteActions.state ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-[12px]">
                    <span className="text-danger">{inviteActions.state}</span>
                    <button onClick={inviteActions.onDismissError} className="font-medium text-muted hover:text-foreground">Dismiss</button>
                  </span>
                ) : inviteActions.armed ? (
                  <button onClick={inviteActions.onSend} className="shrink-0 rounded-md border border-danger px-2 py-1 text-[12px] font-semibold text-danger hover:bg-danger/10">Confirm{invite ? " resend" : ""}?</button>
                ) : (
                  <button onClick={inviteActions.onArm} className="shrink-0 rounded-md border border-accent px-2 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft">✉️ {invite ? "Invite again" : "Invite"}</button>
                )}
              </>
            )
          )}
          {/* Call/email/SMS/appointment, straight to WordPress /sales — the
              same touch actions the Territory Dashboard uses, sitting beside
              the invite actions rather than replacing them: inviting is
              Planner's automated ladder, this is a rep's own manual outreach,
              and a business can have both going at once. Call Now and Book
              Meeting are always real links; Send Email/SMS send for real
              through GHL when this listing has a matched contact, falling
              back to a plain mailto:/sms: link otherwise. Either way, opens
              the panel below pre-selected on that outcome. */}
          {touch && !touch.outcome && (
            <>
              {listing.phone && (
                <a href={`tel:${listing.phone}`} onClick={() => touch.onPick("called")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent px-2 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft">
                  <I.phone className="h-3 w-3" /> Call Now
                </a>
              )}
              {listing.email && (
                listing.ghlContactId && listing.ghlLocationId ? (
                  <button onClick={() => touch.onPick("emailed")}
                    className="shrink-0 rounded-md border border-accent px-2 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    Send Email
                  </button>
                ) : (
                  <a href={`mailto:${listing.email}`} onClick={() => touch.onPick("emailed")}
                    className="shrink-0 rounded-md border border-accent px-2 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    Send Email
                  </a>
                )
              )}
              {listing.phone && (
                listing.ghlContactId && listing.ghlLocationId ? (
                  <button onClick={() => touch.onPick("sms")}
                    className="shrink-0 rounded-md border border-accent px-2 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    Send SMS
                  </button>
                ) : (
                  <a href={`sms:${listing.phone}`} onClick={() => touch.onPick("sms")}
                    className="shrink-0 rounded-md border border-accent px-2 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    Send SMS
                  </a>
                )
              )}
              {listing.bookingUrl && (
                <a href={listing.bookingUrl} target="_blank" rel="noopener noreferrer" onClick={() => touch.onPick("presented")}
                  className="shrink-0 rounded-md border border-accent px-2 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft">
                  Book Meeting
                </a>
              )}
              <button onClick={() => touch.onPick("manual")} className="shrink-0 rounded-md border px-2 py-1 text-[16px] font-medium text-muted hover:bg-surface hover:text-foreground">
                Log a touch
              </button>
            </>
          )}
        </div>
      )}
      {touch?.outcome && (
        <div className="px-4 pb-2 pl-9 sm:pl-9">
          <TouchPanel key={touch.outcome} listingId={touch.gdPlaceId} phone={listing.phone || null} email={listing.email || null} bookingUrl={listing.bookingUrl}
            ghlContactId={listing.ghlContactId} ghlLocationId={listing.ghlLocationId}
            initialOutcome={touch.outcome === "manual" ? undefined : touch.outcome}
            onLogged={touch.onLogged} onCancel={touch.onClose} />
        </div>
      )}
    </div>
  );
}

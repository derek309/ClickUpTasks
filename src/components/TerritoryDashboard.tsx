"use client";

// The territory-work equivalent of the client Dashboard: log in and know
// exactly what to do today across every territory you're assigned to,
// without opening each city's Businesses tab one at a time — and ordered by
// what actually makes money, not just whatever happens to still be open.
// "Super focus on money making activities and sales" (Derek) drove the tier
// order below: answer real replies first, close warm prospects who already
// engaged, nudge the lukewarm ones, then keep already claimed businesses
// moving.
//
// Big pivot (Derek, 2026-08-08): this used to be its own experience — an
// inline expand-per-row panel with Call Now/Send Email/SMS/Book Meeting and
// a touch logger living right on the dashboard. Not anymore. "I don't want
// them to be different flows" — a row here now behaves EXACTLY like a row on
// ClientsBoard: one line, click it, land on that business's task list, click
// a task, leave your note there. The only thing that's still different from
// the Client Dashboard is what gets you onto this page in the first place:
// sorted by activity/sales triggers (accepted an invite, clicked one,
// overdue on a promised follow-up) instead of ClientsBoard's own message/due-
// date signals. All of the call/email/SMS/booking tooling from the prior
// version moved to (and stayed on) the Businesses page, which is explicitly
// a different, separate thing — a funnel-stage view of a whole city, not a
// personal priority list.
//
// The mechanical piece this pivot needed: a prospect tier (Ready to close /
// Nudge these / Follow up due) is built from raw WordPress listings, which
// have no Client/Task to click into — there's nowhere for "click it, land on
// the task list" to go. TerritoryDirectory.tsx already solved this exact
// problem for the Businesses page (silently promoting any listing matched to
// a real GHL contact into a real Client, via syncTerritoryClients in
// Cockpit.tsx) — this just runs that same, already-proven mechanism here
// too, scoped to the businesses that actually earned a spot on this page,
// instead of reinventing a second promotion path.
import { useEffect, useMemo, useState } from "react";
import {
  playbookCompletion, normalizeState, formatDue, CLIENT_STATUS_META, STEP_STALL_DAYS, todayIso as todayIsoDate,
  type Client, type Contact, type Task, type Territory, type ClientStatus, type PlannerInvite,
} from "@/lib/data";
import { isDue, latestInviteStatus } from "@/lib/plannerPools";
import { fetchPlannerWeeks } from "@/lib/db";
import { authedFetch } from "@/lib/supabase";
import { TerritoryBoard, type TerritoryBoardGroup, type BusinessRow } from "./cockpit/TerritoryBoard";
import { type DirectoryListing } from "./cockpit/TerritoryDirectory";

const DASHBOARD_STATUSES: ClientStatus[] = ["claimed", "interview", "onboarding", "active_client"];
// Only these two ever go stale in the prospecting sense isStalled checks —
// an active_client's health is tracked elsewhere (account status, not
// playbook cadence), so it never age out into "Keep them moving" this way,
// same carve-out TerritoryDirectory.tsx's own isStalled already makes.
const STALL_ELIGIBLE: ClientStatus[] = ["claimed", "interview", "onboarding"];

const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

// Same fallback chain TerritoryDirectory.tsx uses to match a raw WP listing
// to a synced GHL contact — ghlContactId first (authoritative, immune to a
// GHL-side contact merge rewriting phone/email out from under a match), then
// phone/email/name. Duplicated here rather than imported: TerritoryDirectory
// computes it inline as a component-scoped useMemo, not an exported utility.
function matchContactMaps(contacts: Contact[]) {
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
  return { byGhlId, byPhone, byEmail, byName };
}
function matchListing(l: DirectoryListing, maps: ReturnType<typeof matchContactMaps>): Contact | null {
  return (l.ghlContactId && maps.byGhlId.get(l.ghlContactId)) || maps.byPhone.get(digits(l.phone)) || maps.byEmail.get(lc(l.email)) || maps.byName.get(lc(l.name)) || null;
}

export function TerritoryDashboard({ me, territories, contacts, clients, tasks, onOpenClient, onOpenTerritory, onSyncClients }: {
  me: { id: string };
  territories: Territory[];
  contacts: Contact[];
  clients: Client[];
  tasks: Task[];
  onOpenClient: (id: string) => void;
  // Fallback only, for the rare business that qualified for a tier but has
  // no matched GHL contact to promote (nothing to click into yet) —
  // listingId deep-links straight to that row on the Businesses page instead
  // of the top of the whole city.
  onOpenTerritory: (territoryId: string, listingId?: number) => void;
  // Same bulk promoter the Businesses page already uses (syncTerritoryClients
  // in Cockpit.tsx) — turns a matched-but-unclaimed contact into a real
  // Client so a tier row here always has somewhere real to send you.
  onSyncClients: (contacts: Contact[]) => void;
}) {
  // Always the logged-in user's own ambassador territories — no "viewing
  // work for" picker. This is a personal work list, not an admin overview
  // tool (Settings → Territories already covers "see everyone's assignment");
  // Derek: log in as Derek, see Derek's; Justin logs in, sees Justin's.
  const myTerritories = useMemo(() => territories.filter((t) => (t.assignedTo ?? []).includes(me.id)), [territories, me.id]);

  // Invite engagement (accepted/clicked) and the businesses that carry it
  // both come from WordPress + planner_weeks, per city — the exact same two
  // fetches TerritoryDirectory.tsx makes when you open one city, just run
  // for every assigned territory at once here instead of one at a time. No
  // cheaper Supabase-only path exists for this — the `claimed` flag and
  // listing name/phone/category only ever come from the WP listings endpoint.
  const [byTerritory, setByTerritory] = useState<Record<string, { listings: DirectoryListing[]; invites: Map<number, PlannerInvite> }>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(myTerritories.map(async (t) => {
      const [listingsRes, weeks] = await Promise.all([
        authedFetch(`/api/directory/listings?${new URLSearchParams({ city: t.city, state: t.state })}`).then((r) => r.json()).catch(() => ({ listings: [] })),
        fetchPlannerWeeks(t.id).catch(() => []),
      ]);
      return [t.id, { listings: Array.isArray(listingsRes?.listings) ? listingsRes.listings : [], invites: latestInviteStatus(weeks) }] as const;
    })).then((entries) => { if (alive) setByTerritory(Object.fromEntries(entries)); });
    return () => { alive = false; };
  }, [myTerritories]);

  // Which raw listings actually qualify for a tier here — computed once,
  // shared by both the promotion effect below and the row builder, so the
  // two can never disagree about who's a candidate.
  const candidateListings = useMemo(() => {
    const now = nowUnix();
    const out: { territory: Territory; listing: DirectoryListing; invite: PlannerInvite | undefined }[] = [];
    for (const t of myTerritories) {
      const entry = byTerritory[t.id];
      if (!entry) continue;
      for (const l of entry.listings) {
        if (l.claimed || l.outcome === "lost") continue;
        const gdId = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
        const inv = entry.invites.get(gdId);
        const dueSoon = l.followupDue > 0 && l.followupDue <= now;
        if (dueSoon || inv?.status === "accepted" || inv?.clickedAt) out.push({ territory: t, listing: l, invite: inv });
      }
    }
    return out;
  }, [myTerritories, byTerritory]);

  // Promote every tier candidate matched to a real GHL contact into a real
  // Client — same mechanism (and same "claimed"/"prospect" shape) the
  // Businesses page already uses in bulk for a whole city. Without this,
  // "Ready to close"/"Nudge these"/"Follow up due" would have nothing to
  // click into.
  useEffect(() => {
    const maps = matchContactMaps(contacts);
    const clientIds = new Set(clients.map((c) => c.id));
    const seen = new Set<string>();
    const toSync: Contact[] = [];
    for (const { listing } of candidateListings) {
      const contact = matchListing(listing, maps);
      if (contact && !clientIds.has("cl_" + contact.id) && !seen.has(contact.id)) {
        seen.add(contact.id);
        toSync.push(contact);
      }
    }
    if (toSync.length) onSyncClients(toSync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateListings, contacts, clients]);

  const tasksByClient = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.playbookStepKey) continue;
      const list = m.get(t.clientId);
      if (list) list.push(t); else m.set(t.clientId, [t]);
    }
    return m;
  }, [tasks]);

  const conversationTaskFor = (clientId: string) => (tasksByClient.get(clientId) ?? []).find((t) => t.status !== "done" && t.priority === "conversation") ?? null;
  const isStalled = (c: Client) => STALL_ELIGIBLE.includes(c.status) && isDue(c.playbookLastProgressAt ?? null, todayIsoDate(), STEP_STALL_DAYS);
  // "Followed up" now happens by editing the task's own due date in
  // TaskDrawer (same InlineDue control every other client's tasks already
  // use), not a dashboard-local action — so the task's real `due` is the
  // only source of truth here, no optimistic local override needed anymore.
  const nextCheckInFor = (c: Client) => conversationTaskFor(c.id)?.due ?? null;

  // Claimed+ businesses — split into two distinct signals instead of one
  // combined "needs attention": a real inbound reply sitting unanswered is a
  // different, more urgent job than a business that's just gone quiet.
  type ClaimedRow = {
    id: string; name: string; client: Client; city: string;
    stageLabel: string; stageColor: string;
    playbook: ReturnType<typeof playbookCompletion>;
    meta: string | null; metaDanger: boolean;
    hasReply: boolean; stalledOnly: boolean; followedUp: boolean;
  };
  const claimedRows = useMemo((): ClaimedRow[] => {
    const territorySet = new Set(myTerritories.map((t) => `${t.city.toLowerCase()}|${normalizeState(t.state)}`));
    const clientById = new Map(clients.map((c) => [c.id, c] as const));
    const todayDate = todayIsoDate();
    return contacts
      .map((contact): ClaimedRow | null => {
        if (!contact.city || !contact.state) return null;
        if (!territorySet.has(`${contact.city.trim().toLowerCase()}|${normalizeState(contact.state)}`)) return null;
        const c = clientById.get("cl_" + contact.id);
        if (!c || !DASHBOARD_STATUSES.includes(c.status)) return null;
        const convo = conversationTaskFor(c.id);
        const stalled = isStalled(c);
        const attention = !!convo || stalled;
        const nextCheckIn = nextCheckInFor(c);
        const followedUp = attention && !!nextCheckIn && nextCheckIn > todayDate;
        return {
          id: c.id, name: c.name, client: c,
          city: `${contact.city}, ${contact.state}`,
          stageLabel: CLIENT_STATUS_META[c.status].label,
          stageColor: CLIENT_STATUS_META[c.status].dot,
          playbook: playbookCompletion(c.id, tasks),
          meta: convo && !followedUp ? "Needs reply" : followedUp && nextCheckIn ? `Back ${formatDue(nextCheckIn)}` : stalled && !followedUp ? `Quiet ${STEP_STALL_DAYS}+ days` : null,
          metaDanger: !!convo && !followedUp,
          hasReply: !!convo && !followedUp,
          stalledOnly: !convo && stalled && !followedUp,
          followedUp,
        };
      })
      .filter((r): r is ClaimedRow => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTerritories, contacts, clients, tasks, tasksByClient]);

  const replyRows = claimedRows.filter((r) => r.hasReply);
  // A client with a real inbound reply is already captured above — showing
  // them again in a prospect tier below would be the same business twice on
  // one page for two different reasons.
  const repliedClientIds = useMemo(() => new Set(replyRows.map((r) => r.client.id)), [replyRows]);

  // Prospect engagement rows — accepted or clicked an invite, or overdue on
  // a promised follow-up. Resolved to the SAME real Client the promotion
  // effect above just ensured exists (matched via contact), so clicking one
  // of these behaves identically to clicking a claimed row: land on that
  // business's task list. The rare listing with no GHL contact match at all
  // (nothing to promote) falls back to opening the Businesses page instead
  // of a client page that can't exist yet.
  const { dueRows, acceptedRows, clickedRows } = useMemo(() => {
    const maps = matchContactMaps(contacts);
    const clientById = new Map(clients.map((c) => [c.id, c] as const));
    const now = nowUnix();
    const due: BusinessRow[] = [];
    const accepted: BusinessRow[] = [];
    const clicked: BusinessRow[] = [];
    for (const { territory: t, listing: l, invite: inv } of candidateListings) {
      const contact = matchListing(l, maps);
      const client = contact ? clientById.get("cl_" + contact.id) ?? null : null;
      if (client && repliedClientIds.has(client.id)) continue; // already in Reply needed
      const gdId = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
      const base: BusinessRow = client
        ? {
            id: client.id, name: client.name, client,
            city: `${t.city}, ${t.state}`,
            stageLabel: CLIENT_STATUS_META[client.status].label,
            stageColor: CLIENT_STATUS_META[client.status].dot,
            playbook: playbookCompletion(client.id, tasks),
            meta: null,
          }
        : {
            id: `${t.id}|${l.id}`, name: l.name, client: null,
            city: `${t.city}, ${t.state}`,
            stageLabel: l.category || "Unclaimed", stageColor: "#94a3b8",
            playbook: null, meta: null,
            fallbackTerritoryId: t.id, fallbackListingId: Number.isFinite(gdId) ? gdId : null,
          };
      if (l.followupDue > 0 && l.followupDue <= now) {
        const overdueDays = Math.floor((now - l.followupDue) / 86400);
        due.push({ ...base, meta: overdueDays >= 1 ? `${overdueDays} days late` : "Due today", metaDanger: true });
      } else if (inv?.status === "accepted") {
        accepted.push({ ...base, meta: `Accepted ${timeAgoShort(inv.respondedAt ?? inv.at)}` });
      } else if (inv?.clickedAt) {
        clicked.push({ ...base, meta: `Clicked ${timeAgoShort(inv.clickedAt)}` });
      }
    }
    return { dueRows: due, acceptedRows: accepted, clickedRows: clicked };
  }, [candidateListings, contacts, clients, tasks, repliedClientIds]);

  // A promoted business (now sitting in one of the three tiers above) is
  // more specifically actionable than the generic "quiet" or "followed up"
  // buckets below — exclude it from those so it shows up exactly once, in
  // its most specific tier, same "never double count" rule the invite ladder
  // itself already follows.
  const prospectTierClientIds = useMemo(
    () => new Set([...dueRows, ...acceptedRows, ...clickedRows].map((r) => r.client?.id).filter((id): id is string => !!id)),
    [dueRows, acceptedRows, clickedRows],
  );
  const keepMovingRows = claimedRows.filter((r) => r.stalledOnly && !prospectTierClientIds.has(r.client.id));
  const followedUpRows = claimedRows.filter((r) => r.followedUp && !prospectTierClientIds.has(r.client.id));
  // Everyone else claimed+ and caught up — deliberately not rendered as
  // rows (that was the wall-of-stuff problem). Just a count, so a quiet
  // territory still confirms it checked everyone rather than looking broken.
  const quietCount = claimedRows.length - replyRows.length - keepMovingRows.length - followedUpRows.length
    - claimedRows.filter((r) => prospectTierClientIds.has(r.client.id) && !r.hasReply && !r.stalledOnly && !r.followedUp).length;

  const groups: TerritoryBoardGroup[] = [];
  if (replyRows.length) groups.push({ key: "reply", label: "Reply needed", color: "#ef4444", rows: replyRows });
  if (dueRows.length) groups.push({ key: "followup_due", label: "Follow up due", color: "#f97316", rows: dueRows });
  if (acceptedRows.length) groups.push({ key: "accepted", label: "Ready to close", color: "#059669", rows: acceptedRows });
  if (clickedRows.length) groups.push({ key: "clicked", label: "Nudge these", color: "#2563eb", rows: clickedRows });
  if (keepMovingRows.length) groups.push({ key: "keep_moving", label: "Keep them moving", color: "#f59e0b", rows: keepMovingRows });
  if (followedUpRows.length) groups.push({ key: "followed_up", label: "Followed up, waiting to hear back", color: "#64748b", rows: followedUpRows });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-4 py-2.5">
        <span className="text-[16px] text-muted">Everything that needs you across your assigned territories</span>
        {quietCount > 0 && (
          <span className="ml-auto text-[13px] text-muted">{quietCount} other claimed business{quietCount === 1 ? "" : "es"} moving through the Playbook, nothing urgent today</span>
        )}
      </div>
      <TerritoryBoard groups={groups} onOpenClient={onOpenClient} onOpenTerritory={onOpenTerritory} />
    </div>
  );
}

// Module scope on purpose: react-hooks/purity flags Date.now() written
// inside a component or hook body, even where it only ever runs in a memo.
function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// Compact "2d ago" / "3h ago" style relative time for the invite engagement
// meta text — timeAgo() in data.ts renders a longer human sentence meant for
// a full activity feed line, not a short right-column label.
function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

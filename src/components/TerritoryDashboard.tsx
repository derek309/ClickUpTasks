"use client";

// The territory-work equivalent of the client Dashboard: log in and know
// exactly what to do today across every territory you're assigned to,
// without opening each city's Businesses tab one at a time — and ordered by
// what actually makes money, not just whatever happens to still be open.
// "Super focus on money making activities and sales" (Derek) drove the tier
// order below: answer real replies first, close warm prospects who already
// engaged, nudge the lukewarm ones, then keep already claimed businesses
// moving. A first cut of this page just listed every claimed+ business
// sorted by staleness — since nothing on a brand new territory rollout had
// tripped either trigger yet, that meant a flat wall of hundreds of rows
// with no way to tell what actually needed a human. This version pulls in
// the same invite engagement signals (accepted/clicked) TerritoryDirectory.tsx
// already tracks per city, drops the untriaged full roster entirely (that's
// what each city's own Businesses tab is for), and gives every row a
// one line reason it's here.
import { useEffect, useMemo, useState } from "react";
import {
  users, userById, playbookCompletion, normalizeState, CLIENT_STATUS_META, STEP_STALL_DAYS, todayIso as todayIsoDate,
  type Client, type Contact, type Task, type Territory, type ClientStatus, type PlannerInvite,
} from "@/lib/data";
import { isDue, latestInviteStatus } from "@/lib/plannerPools";
import { fetchPlannerWeeks } from "@/lib/db";
import { authedFetch } from "@/lib/supabase";
import { TerritoryBoard, type TerritoryBoardGroup, type BusinessRow } from "./cockpit/TerritoryBoard";
import { type TouchResult } from "./cockpit/TouchLogger";
import { type DirectoryListing } from "./cockpit/TerritoryDirectory";

const DASHBOARD_STATUSES: ClientStatus[] = ["claimed", "interview", "onboarding", "active_client"];
// Only these two ever go stale in the prospecting sense isStalled checks —
// an active_client's health is tracked elsewhere (account status, not
// playbook cadence), so it never age out into "Keep them moving" this way,
// same carve-out TerritoryDirectory.tsx's own isStalled already makes.
const STALL_ELIGIBLE: ClientStatus[] = ["claimed", "interview", "onboarding"];

export function TerritoryDashboard({ me, canAdmin, territories, contacts, clients, tasks, onOpenClient, onOpenTerritory, onOpenPlaybook }: {
  me: { id: string };
  canAdmin: boolean;
  territories: Territory[];
  contacts: Contact[];
  clients: Client[];
  tasks: Task[];
  onOpenClient: (id: string) => void;
  onOpenTerritory: (territoryId: string) => void;
  onOpenPlaybook: (id: string) => void;
}) {
  const [viewingUser, setViewingUser] = useState(me.id);
  const [followUpState, setFollowUpState] = useState<Record<string, "saving" | string>>({});
  // Same optimistic-snooze idiom TerritoryDirectory.tsx's markFollowedUp
  // uses: keyed by conversation-task id (or the client id when a task gets
  // created on the fly), holds the due date the row showed before the
  // click so it stops overriding once the server's own value catches up
  // (an inbound reply bumping due back to today must win over a stale
  // snooze, never the other way around).
  const [followUpDue, setFollowUpDue] = useState<Record<string, { from: string | null; to: string }>>({});

  const myTerritories = useMemo(() => territories.filter((t) => (t.assignedTo ?? []).includes(viewingUser)), [territories, viewingUser]);

  // Invite engagement (accepted/clicked/opened) and the businesses that
  // carry it both come from WordPress + planner_weeks, per city — the exact
  // same two fetches TerritoryDirectory.tsx makes when you open one city,
  // just run for every assigned territory at once here instead of one at a
  // time. No cheaper Supabase-only path exists for this (confirmed against
  // TerritoryDirectory's own data model) — the `claimed` flag and listing
  // name/phone/category only ever come from the WP listings endpoint.
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
  const nextCheckInFor = (c: Client) => {
    const t = conversationTaskFor(c.id);
    if (!t) return null;
    const pending = followUpDue[t.id];
    return pending && t.due === pending.from ? pending.to : t.due;
  };
  const lastTouchFor = (clientId: string): BusinessRow["lastTouch"] => {
    let latest: { authorId: string; body: string; at: string } | null = null;
    for (const t of tasksByClient.get(clientId) ?? []) for (const c of t.comments) {
      if (!latest || c.at > latest.at) latest = { authorId: c.authorId, body: c.body, at: c.at };
    }
    return latest ? { authorName: userById(latest.authorId)?.name ?? "Someone", body: latest.body, at: latest.at } : null;
  };

  // Claimed+ businesses — same source as before (Supabase only, no WP call),
  // split into two distinct signals instead of one combined "needs
  // attention": a real inbound reply sitting unanswered is a different, more
  // urgent job than a business that's just gone quiet on its own.
  type ClaimedRow = BusinessRow & { hasReply: boolean; stalledOnly: boolean };
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
          lastTouch: lastTouchFor(c.id),
          flagReason: attention && !followedUp ? (convo ? convo.title : `Quiet on ${CLIENT_STATUS_META[c.status].label} for ${STEP_STALL_DAYS}+ days`) : null,
          nextCheckIn: followedUp ? nextCheckIn : null,
          needsAttention: attention,
          followedUp,
          taskId: convo?.id ?? null,
          followUpKey: convo?.id ?? c.id,
          // A real inbound reply is a different, more urgent job than a
          // business that's just gone quiet on its own — split into two
          // groups below instead of one combined "needs attention".
          hasReply: !!convo && !followedUp,
          stalledOnly: !convo && stalled && !followedUp,
        };
      })
      .filter((r): r is ClaimedRow => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTerritories, contacts, clients, tasks, tasksByClient, followUpDue]);

  // Prospect engagement rows — accepted or clicked an invite but hasn't
  // claimed yet. Built straight from the WP listings + invite map (no
  // contact/client matching needed, unlike claimedRows above): a
  // DirectoryListing already carries every field a row needs (name, phone,
  // category, public url), and these businesses may not even have a Client
  // row yet. Same "strongest tier it qualifies for" predicates
  // TerritoryDirectory.tsx's own engagement ladder uses (accepted > clicked),
  // so a business never double counts across both.
  const { dueRows, acceptedRows, clickedRows } = useMemo(() => {
    const due: BusinessRow[] = [];
    const accepted: BusinessRow[] = [];
    const clicked: BusinessRow[] = [];
    const now = nowUnix();
    for (const t of myTerritories) {
      const entry = byTerritory[t.id];
      if (!entry) continue;
      const cityLabel = `${t.city}, ${t.state}`;
      for (const l of entry.listings) {
        if (l.claimed) continue;
        // A rep marked them not interested. WP parks the outcome on "lost"
        // and clears any follow-up, and this is the one place that has to
        // honor it: a hard no that keeps resurfacing is worse than no
        // dashboard at all.
        if (l.outcome === "lost") continue;
        const gdId = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
        const inv = entry.invites.get(gdId);
        // No invite engagement and nobody has reached out: that's the
        // untriaged roster, which is each city's own Businesses tab's job.
        if (!inv && !l.lastTouched) continue;
        const base: BusinessRow = {
          id: `${t.id}|${l.id}`, name: l.name, client: null, city: cityLabel,
          stageLabel: l.category || "Unclaimed", stageColor: "#94a3b8",
          playbook: null, lastTouch: null, flagReason: null, nextCheckIn: null,
          needsAttention: false, followedUp: false, taskId: null, followUpKey: `${t.id}|${l.id}`,
          phone: l.phone || null, listingUrl: l.url || null,
          listingId: Number.isFinite(gdId) ? gdId : null,
          touchLabel: l.outcomeLabel || null, touchedAt: l.lastTouched, followupDue: l.followupDue,
        };
        // A scheduled follow-up outranks both invite signals below, and its
        // date is the ONLY thing that decides when the business comes back:
        // due or overdue puts them at the top, a future date keeps them off
        // the board entirely until then. That's what makes the process
        // uniform — every touch sets a date, and the date does the rest,
        // instead of a business staying permanently "hot" because it once
        // clicked an email.
        if (l.followupDue > 0) {
          if (l.followupDue <= now) {
            const overdueDays = Math.floor((now - l.followupDue) / 86400);
            due.push({ ...base, flagReason: overdueDays >= 1 ? `Follow up is ${overdueDays}d overdue.` : "Follow up is due today." });
          }
          continue;
        }
        if (inv?.status === "accepted") {
          accepted.push({ ...base, flagReason: `Accepted the invite ${timeAgoShort(inv.respondedAt ?? inv.at)}. Call or visit to close.` });
        } else if (inv?.clickedAt) {
          clicked.push({ ...base, flagReason: `Clicked ${timeAgoShort(inv.clickedAt)} but hasn't finished. A nudge might close it.` });
        }
      }
    }
    return { dueRows: due, acceptedRows: accepted, clickedRows: clicked };
  }, [myTerritories, byTerritory]);

  // Patch just the one listing in place from the response the activity route
  // echoes back, rather than refetching the whole city: the row re-tiers off
  // followupDue on the next render, so logging a touch visibly moves the
  // business off the board immediately.
  const onTouchLogged = (row: BusinessRow, result: TouchResult) => {
    const territoryId = row.id.split("|")[0];
    setByTerritory((prev) => {
      const entry = prev[territoryId];
      if (!entry) return prev;
      return {
        ...prev,
        [territoryId]: {
          ...entry,
          listings: entry.listings.map((l) => (String(l.id) === String(row.listingId) ? { ...l, ...result } : l)),
        },
      };
    });
  };

  const replyRows = claimedRows.filter((r) => r.hasReply);
  const keepMovingRows = claimedRows.filter((r) => r.stalledOnly);
  const followedUpRows = claimedRows.filter((r) => r.followedUp);
  // Everyone else claimed+ and caught up — deliberately not rendered as
  // rows (that was the wall-of-stuff problem). Just a count, so a quiet
  // territory still confirms it checked everyone rather than looking broken.
  const quietCount = claimedRows.length - replyRows.length - keepMovingRows.length - followedUpRows.length;

  const groups: TerritoryBoardGroup[] = [];
  if (replyRows.length) groups.push({ key: "reply", label: "Reply needed", color: "#ef4444", rows: replyRows });
  if (dueRows.length) groups.push({ key: "followup_due", label: "Follow up due", color: "#f97316", rows: dueRows });
  if (acceptedRows.length) groups.push({ key: "accepted", label: "Ready to close", color: "#059669", rows: acceptedRows });
  if (clickedRows.length) groups.push({ key: "clicked", label: "Nudge these", color: "#2563eb", rows: clickedRows });
  if (keepMovingRows.length) groups.push({ key: "keep_moving", label: "Keep them moving", color: "#f59e0b", rows: keepMovingRows });
  if (followedUpRows.length) groups.push({ key: "followed_up", label: "Followed up, waiting to hear back", color: "#64748b", rows: followedUpRows });

  const onFollowUp = async (row: BusinessRow, note: string) => {
    if (!row.client) return; // prospect rows have no task to attach a follow up to yet
    setFollowUpState((m) => ({ ...m, [row.followUpKey]: "saving" }));
    try {
      const res = await authedFetch("/api/tasks/follow-up", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row.taskId ? { taskId: row.taskId, note } : { clientId: row.client.id, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok && j.due) {
        const resolvedKey = j.taskId ?? row.followUpKey;
        setFollowUpDue((m) => ({ ...m, [resolvedKey]: { from: row.taskId ? tasksByClient.get(row.client!.id)?.find((t) => t.id === row.taskId)?.due ?? null : null, to: j.due } }));
        setFollowUpState((m) => { const n = { ...m }; delete n[row.followUpKey]; return n; });
        return;
      }
      setFollowUpState((m) => ({ ...m, [row.followUpKey]: j.error || `Couldn't save that follow up (${res.status}).` }));
    } catch {
      setFollowUpState((m) => ({ ...m, [row.followUpKey]: "Network error. Try again." }));
    }
  };
  const onDismissError = (row: BusinessRow) => setFollowUpState((m) => { const n = { ...m }; delete n[row.followUpKey]; return n; });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-4 py-2.5">
        {canAdmin ? (
          <>
            <span className="text-[13px] text-muted">Viewing work for</span>
            <select value={viewingUser} onChange={(e) => setViewingUser(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === "va" ? " (VA)" : ""}</option>)}
            </select>
          </>
        ) : (
          <span className="text-[13px] text-muted">Everything that needs you across your assigned territories</span>
        )}
        {quietCount > 0 && (
          <span className="ml-auto text-[13px] text-muted">{quietCount} other claimed business{quietCount === 1 ? "" : "es"} moving through the Playbook, nothing urgent today</span>
        )}
      </div>
      <TerritoryBoard groups={groups} followUpState={followUpState} onOpenClient={onOpenClient} onOpenTerritory={onOpenTerritory} onOpenPlaybook={onOpenPlaybook} onFollowUp={onFollowUp} onTouchLogged={onTouchLogged} onDismissError={onDismissError} />
    </div>
  );
}

// Compact "2d ago" / "3h ago" style relative time for the invite engagement
// flag lines — timeAgo() in data.ts renders a longer human sentence meant
// for a full activity feed line, not a short reason clause.
// Module scope on purpose: react-hooks/purity flags Date.now() written inside
// a component or hook body, even where it only ever runs in an event handler
// or a memo. Same carve-out timeAgoShort below already needs.
function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

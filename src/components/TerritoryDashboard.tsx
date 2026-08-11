"use client";

// The territory-work equivalent of the client Dashboard: log in and know
// exactly what to do today across every territory you're assigned to,
// without opening each city's Businesses tab one at a time — and ordered by
// what actually makes money, not just whatever happens to still be open.
//
// Big pivot #1 (Derek, 2026-08-08 — "Follow Up" is the new name): a row here
// behaves EXACTLY like a row on ClientsBoard. One line, click it, land on
// that business's task list, click a task, leave your note there. No inline
// panel, no separate flow to learn. The only thing that's still different
// from the Client Dashboard is what gets a business ONTO this page: activity
// and sales triggers (an engagement signal, a stalled Playbook step) instead
// of ClientsBoard's own message/due-date signals.
//
// Big pivot #2 (Derek, 2026-08-09 — task-driven, not signal-derived): "when
// there's an activity like a click or an open or anything, it needs to
// create a task for us to follow up... very clear: they clicked the email,
// call them... they started the chat but didn't complete it... they'll be
// sorted based on those tasks." Every engagement signal (opened/clicked an
// invite, accepted one, started-but-didn't-finish the interview chat) now
// creates a real Conversation task naming exactly what happened, at the
// moment it happens — see handleEmailEngagement (ghl/webhook/route.ts),
// planner-interest/route.ts, and /api/directory/ensure-engagement-tasks
// (the one signal with no inbound webhook to hang this off, so it's ensured
// from here instead — see that route's own comment). That collapses this
// page back down to exactly the same shape claimedRows/replyRows already
// were: no separate WP-signal-derived tiers to keep in sync with reality,
// no second "is this business already counted elsewhere" bookkeeping. A row
// shows up here because it has an open Conversation task, full stop, same
// as any other client — the task's own title is what makes it "very clear,"
// not a computed dashboard label.
//
// Big pivot #3 (Derek, 2026-08-11 — grouped by date, not by tier): "I want
// the follow up to be what I need to focus on today, tomorrow, this week,
// next week, this month, just like My Work. My Work is for active clients
// and Follow Up is for sales." The old Reply needed / Keep them moving /
// Followed up tiers collapsed into the same due-date buckets My Work uses
// (DUE_BUCKETS/dueBucketOf in data.ts, shared by both) — those three tiers
// were really "now," "now," and "later" under different names, and none of
// them answered "which day." A snoozed follow-up now simply reappears in
// the bucket for the day it's due, instead of sitting in a parked list.
import { useEffect, useMemo } from "react";
import {
  playbookCompletion, normalizeState, CLIENT_STATUS_META, STEP_STALL_DAYS, todayIso as todayIsoDate,
  conversationSignalRank, DUE_BUCKETS, dueBucketOf, type DueBucket,
  type Client, type Contact, type Task, type Territory, type ClientStatus,
} from "@/lib/data";
import { isDue } from "@/lib/plannerPools";
import { authedFetch } from "@/lib/supabase";
import { TerritoryBoard, type TerritoryBoardGroup } from "./cockpit/TerritoryBoard";

// See the ensure-engagement-tasks effect below for why this exists.
const ENSURE_ENGAGEMENT_COOLDOWN_MS = 10 * 60 * 1000;
const ensureEngagementLastRun = new Map<string, number>();

const DASHBOARD_STATUSES: ClientStatus[] = ["claimed", "interview", "onboarding", "active_client"];
// Only these two ever go stale in the prospecting sense isStalled checks —
// an active_client's health is tracked elsewhere (account status, not
// playbook cadence), so it never age out into "Keep them moving" this way,
// same carve-out TerritoryDirectory.tsx's own isStalled already makes.
const STALL_ELIGIBLE: ClientStatus[] = ["claimed", "interview", "onboarding"];

export function TerritoryDashboard({ me, territories, contacts, clients, tasks, onOpenClient }: {
  me: { id: string };
  territories: Territory[];
  contacts: Contact[];
  clients: Client[];
  tasks: Task[];
  onOpenClient: (id: string) => void;
}) {
  // Always the logged-in user's own ambassador territories — no "viewing
  // work for" picker. This is a personal work list, not an admin overview
  // tool (Settings → Territories already covers "see everyone's assignment");
  // Derek: log in as Derek, see Derek's; Justin logs in, sees Justin's.
  const myTerritories = useMemo(() => territories.filter((t) => (t.assignedTo ?? []).includes(me.id)), [territories, me.id]);

  // The one engagement signal with no inbound webhook to create its task in
  // real time (WordPress only exposes a read-only funnel rollup — see that
  // route's own comment for why). Every other signal (opened/clicked/
  // accepted an invite) already creates its task at the webhook, the instant
  // it happens, so there's nothing to poll for those.
  //
  // Cooldown (Derek, 2026-08-09 — "3 second delay on every click"): this
  // route does a live WordPress fetch + a GHL funnel fetch + a serial
  // per-candidate DB loop, real backend work, not a cheap read. With no
  // throttle it re-fired on every mount of this page, and Vercel logs showed
  // it stacking up every ~10 seconds (each remount, e.g. someone re-clicking
  // the nav while waiting), which was competing with every other request for
  // the same Supabase connections. The chat-funnel signal it catches moves
  // slowly (a business doesn't start-then-abandon the interview chat twice a
  // minute), so a per-territory, per-tab cooldown is safe. Module scope, not
  // state, so it survives this component unmounting/remounting within the
  // same tab — a sessionStorage-free, no-bloat throttle, same spirit as the
  // 20s visibility-refetch cooldown above in Cockpit.tsx.
  useEffect(() => {
    const now = Date.now();
    myTerritories.forEach((t) => {
      const last = ensureEngagementLastRun.get(t.id) ?? 0;
      if (now - last < ENSURE_ENGAGEMENT_COOLDOWN_MS) return;
      ensureEngagementLastRun.set(t.id, now);
      authedFetch("/api/directory/ensure-engagement-tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId: t.id, city: t.city, state: t.state }),
      }).catch(() => {});
      // "Keep them moving" used to be a pure computed signal with no task
      // behind it — nothing to click into (Derek, 2026-08-09). Same cooldown
      // gate, purely Supabase-driven so it's cheap alongside the call above.
      authedFetch("/api/directory/ensure-stalled-tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryId: t.id, city: t.city, state: t.state }),
      }).catch(() => {});
    });
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
  // A null playbookLastProgressAt means "never started the Playbook yet,"
  // not "stalled" — isDue treats null as always-due (correct for its other
  // callers, e.g. "never invited" should be due for an invite), but that's
  // wrong here: a business bulk-promoted moments ago with zero progress
  // isn't stalled, it just hasn't begun. Only a real, actually-old timestamp
  // counts.
  const isStalled = (c: Client) => STALL_ELIGIBLE.includes(c.status) && !!c.playbookLastProgressAt && isDue(c.playbookLastProgressAt, todayIsoDate(), STEP_STALL_DAYS);

  // Every claimed+ business in an assigned territory, split into the tiers
  // that earn a spot on this page: a real open Conversation task (any
  // engagement signal — opened, clicked, accepted, started-not-finished, or
  // a genuine inbound reply, they all land here the same way now) is a
  // different, more urgent job than a business that's just gone quiet on
  // its own with nothing open.
  type ClaimedRow = {
    id: string; name: string; client: Client; city: string;
    stageLabel: string; stageColor: string;
    playbook: ReturnType<typeof playbookCompletion>;
    meta: string | null; metaDanger: boolean;
    /** Whether this business earns a spot at all — a real open Conversation
     * task, or a Playbook that's gone quiet. Everyone else is just "moving
     * along fine" and stays a count, not a row. */
    attention: boolean;
    bucket: DueBucket; due: string | null;
    rank: number; lastActivityAt: string | null;
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
        const due = convo?.due ?? null;
        return {
          id: c.id, name: c.name, client: c,
          city: `${contact.city}, ${contact.state}`,
          stageLabel: CLIENT_STATUS_META[c.status].label,
          stageColor: CLIENT_STATUS_META[c.status].dot,
          playbook: playbookCompletion(c.id, tasks),
          // The task's own title carries the specific "very clear" reason
          // ("Clicked the invite email — call or visit to close", "Started
          // the interest chat... didn't finish", or a real "Reply to
          // {name}") — shown as-is rather than a generic "Needs reply"
          // placeholder, so the row says exactly what happened. The old
          // "Back {date}" variant is gone: which bucket the row sits in now
          // says when it's due, so repeating it in the meta was noise.
          meta: convo ? convo.title : stalled ? `Quiet ${STEP_STALL_DAYS}+ days` : null,
          attention,
          // Everything the row needs to place itself on the calendar. A
          // freshly-fired signal is due today (lands in Today); snoozing the
          // task's own due date forward moves the row to that day's bucket,
          // which is what replaced the old "Followed up, waiting to hear
          // back" tier — a scheduled follow-up simply shows up on the day
          // it's scheduled for, instead of in a separate parked list.
          bucket: dueBucketOf(due),
          due,
          // Only red once it's actually due — a follow-up scheduled for next
          // week isn't behind, it's planned.
          metaDanger: !!convo && !!due && due <= todayDate,
          rank: convo ? conversationSignalRank(convo.title) : 0,
          // lastActivityAt is full-precision (set by upsertConversationTask);
          // due is date-only and predates it, so it's the fallback for any
          // task upsertConversationTask hasn't touched since this shipped —
          // still real progress over no date signal at all, just coarser.
          lastActivityAt: convo?.lastActivityAt ?? convo?.due ?? null,
        };
      })
      .filter((r): r is ClaimedRow => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTerritories, contacts, clients, tasks, tasksByClient]);

  // Grouped by when it's due, exactly like My Work's task list — My Work is
  // for active clients, Follow Up is the same idea for sales (Derek,
  // 2026-08-11). Replaces the old Reply needed / Keep them moving /
  // Followed up split: those three were really "now," "now," and "later"
  // wearing different names, and none of them told you WHICH day.
  const actionRows = claimedRows.filter((r) => r.attention);
  // Everyone else claimed+ and caught up — deliberately not rendered as
  // rows (that was the wall-of-stuff problem). Just a count, so a quiet
  // territory still confirms it checked everyone rather than looking broken.
  const quietCount = claimedRows.length - actionRows.length;

  // Soonest first within a bucket (oldest-overdue first at the top of
  // Overdue), then strongest signal, then most recent activity — so a day
  // with several follow-ups still leads with the one most worth the call.
  const groups: TerritoryBoardGroup[] = DUE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    color: b.color,
    rows: actionRows
      .filter((r) => r.bucket === b.key)
      .sort((x, y) => (x.due ?? "").localeCompare(y.due ?? "") || y.rank - x.rank || (y.lastActivityAt ?? "").localeCompare(x.lastActivityAt ?? "")),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-4 py-2.5">
        <span className="text-[16px] text-muted">Everything that needs you across your assigned territories</span>
        {quietCount > 0 && (
          <span className="ml-auto text-[13px] text-muted">{quietCount} other claimed business{quietCount === 1 ? "" : "es"} moving through the Playbook, nothing urgent today</span>
        )}
      </div>
      <TerritoryBoard groups={groups} onOpenClient={onOpenClient} />
    </div>
  );
}

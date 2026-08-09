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
import { useEffect, useMemo } from "react";
import {
  playbookCompletion, normalizeState, formatDue, CLIENT_STATUS_META, STEP_STALL_DAYS, todayIso as todayIsoDate,
  type Client, type Contact, type Task, type Territory, type ClientStatus,
} from "@/lib/data";
import { isDue } from "@/lib/plannerPools";
import { authedFetch } from "@/lib/supabase";
import { TerritoryBoard, type TerritoryBoardGroup } from "./cockpit/TerritoryBoard";

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
  useEffect(() => {
    myTerritories.forEach((t) => {
      authedFetch("/api/directory/ensure-engagement-tasks", {
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
  const isStalled = (c: Client) => STALL_ELIGIBLE.includes(c.status) && isDue(c.playbookLastProgressAt ?? null, todayIsoDate(), STEP_STALL_DAYS);
  // "Followed up" happens by editing the task's own due date in TaskDrawer
  // (same InlineDue control every other client's tasks already use), not a
  // dashboard-local action — the task's real `due` is the only source of
  // truth here, no optimistic local override needed.
  const nextCheckInFor = (c: Client) => conversationTaskFor(c.id)?.due ?? null;

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
          // The task's own title carries the specific "very clear" reason
          // ("Clicked the invite email — call or visit to close", "Started
          // the interest chat... didn't finish", or a real "Reply to
          // {name}") — shown as-is rather than a generic "Needs reply"
          // placeholder, so the row says exactly what happened.
          meta: convo && !followedUp ? convo.title : followedUp && nextCheckIn ? `Back ${formatDue(nextCheckIn)}` : stalled && !followedUp ? `Quiet ${STEP_STALL_DAYS}+ days` : null,
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
  const keepMovingRows = claimedRows.filter((r) => r.stalledOnly);
  const followedUpRows = claimedRows.filter((r) => r.followedUp);
  // Everyone else claimed+ and caught up — deliberately not rendered as
  // rows (that was the wall-of-stuff problem). Just a count, so a quiet
  // territory still confirms it checked everyone rather than looking broken.
  const quietCount = claimedRows.length - replyRows.length - keepMovingRows.length - followedUpRows.length;

  const groups: TerritoryBoardGroup[] = [];
  if (replyRows.length) groups.push({ key: "reply", label: "Reply needed", color: "#ef4444", rows: replyRows });
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
      <TerritoryBoard groups={groups} onOpenClient={onOpenClient} />
    </div>
  );
}

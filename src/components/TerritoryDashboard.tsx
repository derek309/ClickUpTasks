"use client";

// The territory-work equivalent of the client Dashboard: log in and know who
// to follow up with today, across every territory you're assigned to,
// without opening each city's Businesses tab one at a time. Scoped to
// claimed+ businesses only (claimed/interview/onboarding/active_client) —
// "everything we're doing in territories is all about pushing everybody
// through the playbook" (Derek) — unclaimed/invited prospecting stays
// Planner's job, same split TerritoryDirectory.tsx's own comments already
// draw.
//
// Deliberately built without any WordPress /api/directory/listings fetch:
// Contact.city/state are already synced from GHL specifically to power this
// match (see their doc comments in data.ts), so which territory a claimed
// business belongs to is derivable entirely from data already loaded
// app-wide (clients/contacts/tasks) — no new network call on login.
import { useMemo, useState } from "react";
import {
  users, userById, playbookCompletion, CLIENT_STATUS_META, STEP_STALL_DAYS, todayIso as todayIsoDate,
  type Client, type Contact, type Task, type Territory, type ClientStatus,
} from "@/lib/data";
import { isDue } from "@/lib/plannerPools";
import { authedFetch } from "@/lib/supabase";
import { TerritoryBoard, type TerritoryBoardGroup, type BusinessRow } from "./cockpit/TerritoryBoard";

const DASHBOARD_STATUSES: ClientStatus[] = ["claimed", "interview", "onboarding", "active_client"];
// Only these two ever go stale in the prospecting sense isStalled checks —
// an active_client's health is tracked elsewhere (account status, not
// playbook cadence), so it never age out into "Needs attention" this way,
// same carve-out TerritoryDirectory.tsx's own isStalled already makes.
const STALL_ELIGIBLE: ClientStatus[] = ["claimed", "interview", "onboarding"];

export function TerritoryDashboard({ me, canAdmin, territories, contacts, clients, tasks, onOpenClient, onOpenPlaybook }: {
  me: { id: string };
  canAdmin: boolean;
  territories: Territory[];
  contacts: Contact[];
  clients: Client[];
  tasks: Task[];
  onOpenClient: (id: string) => void;
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
  const needsAttention = (c: Client) => !!conversationTaskFor(c.id) || isStalled(c);
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

  const rows: BusinessRow[] = useMemo(() => {
    const territorySet = new Set(myTerritories.map((t) => `${t.city.toLowerCase()}|${t.state.toLowerCase()}`));
    const contactByClientId = new Map(contacts.map((c) => [c.clientId, c] as const));
    const todayDate = todayIsoDate();
    return clients
      .filter((c) => DASHBOARD_STATUSES.includes(c.status))
      .map((c): BusinessRow | null => {
        const contact = contactByClientId.get(c.id);
        if (!contact?.city || !contact.state) return null;
        if (!territorySet.has(`${contact.city.toLowerCase()}|${contact.state.toLowerCase()}`)) return null;
        const convo = conversationTaskFor(c.id);
        const attention = needsAttention(c);
        const nextCheckIn = nextCheckInFor(c);
        const followedUp = attention && !!nextCheckIn && nextCheckIn > todayDate;
        return {
          client: c,
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
        };
      })
      .filter((r): r is BusinessRow => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTerritories, contacts, clients, tasks, tasksByClient, followUpDue]);

  const attentionRows = rows.filter((r) => r.needsAttention && !r.followedUp);
  const followedUpRows = rows.filter((r) => r.followedUp);
  const workingRows = rows.filter((r) => !r.needsAttention)
    .sort((a, b) => (a.client.playbookLastProgressAt ?? "").localeCompare(b.client.playbookLastProgressAt ?? ""));

  const groups: TerritoryBoardGroup[] = [];
  if (attentionRows.length) groups.push({ key: "attention", label: "Needs attention now", color: "#ef4444", rows: attentionRows });
  if (followedUpRows.length) groups.push({ key: "followed_up", label: "Followed up, waiting to hear back", color: "#64748b", rows: followedUpRows });
  if (workingRows.length) groups.push({ key: "working", label: "Working the Playbook", color: "#3b82f6", rows: workingRows });

  const onFollowUp = async (row: BusinessRow, note: string) => {
    setFollowUpState((m) => ({ ...m, [row.followUpKey]: "saving" }));
    try {
      const res = await authedFetch("/api/tasks/follow-up", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row.taskId ? { taskId: row.taskId, note } : { clientId: row.client.id, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok && j.due) {
        const resolvedKey = j.taskId ?? row.followUpKey;
        setFollowUpDue((m) => ({ ...m, [resolvedKey]: { from: row.taskId ? tasksByClient.get(row.client.id)?.find((t) => t.id === row.taskId)?.due ?? null : null, to: j.due } }));
        setFollowUpState((m) => { const n = { ...m }; delete n[row.followUpKey]; return n; });
        return;
      }
      setFollowUpState((m) => ({ ...m, [row.followUpKey]: j.error || `Couldn't save that follow up (${res.status}).` }));
    } catch {
      setFollowUpState((m) => ({ ...m, [row.followUpKey]: "Network error — try again." }));
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
          <span className="text-[13px] text-muted">Every claimed business across your assigned territories</span>
        )}
      </div>
      <TerritoryBoard groups={groups} followUpState={followUpState} onOpenClient={onOpenClient} onOpenPlaybook={onOpenPlaybook} onFollowUp={onFollowUp} onDismissError={onDismissError} />
    </div>
  );
}

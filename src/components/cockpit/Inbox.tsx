"use client";

// The sidebar Inbox — every notification addressed to you (mentions,
// comments on your tasks, assignments, delegations, status/due changes),
// as a proper full-page reading list instead of the small bell popover.
import { useState } from "react";
import { timeAgo, dayLabel, type Notification, type Client, type Project, type UnmatchedEmail } from "@/lib/data";
import { I, Avatar } from "./ui";

type InboxFilter = "unread" | "all" | "sms" | "email" | "activity";

// Day dividers + collapsing a run of 2+ consecutive same-sender notifications
// into one summary row (expandable) — same technique ClientJournal's own
// feed already uses for a fast SMS back-and-forth, applied here to "Amanda
// sent 4 texts in a row" reading as one line instead of 4 identical-looking
// bordered cards. Only real, matching actorIds ever merge — two null-actor
// (system) notifications never do, since they're not actually related just
// because both lack an actor.
type ActivityRow =
  | { kind: "divider"; key: string; label: string }
  | { kind: "single"; n: Notification }
  | { kind: "group"; key: string; actorId: string; items: Notification[] };

// The single-notification row — shared by a standalone row and by each item
// inside an expanded group, so there's exactly one place that defines what
// a notification looks like.
function NotificationRow({ n, clientById, projectById, onOpen }: {
  n: Notification;
  clientById: (id: string) => Client | null;
  projectById: (id: string) => Project | null;
  onOpen: (n: Notification) => void;
}) {
  const where = n.projectId ? projectById(n.projectId)?.name : n.clientId ? clientById(n.clientId)?.name : null;
  const canOpen = !!(n.taskId || n.clientId);
  return (
    <button onClick={() => onOpen(n)} disabled={!canOpen}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${n.read ? "bg-surface" : "border-accent/40 bg-accent-soft"} ${canOpen ? "hover:border-accent" : "cursor-default opacity-80"}`}>
      <Avatar id={n.actorId ?? null} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className={`min-w-0 break-words text-[15px] leading-snug ${n.read ? "" : "font-medium"}`}>{n.text}</div>
          {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
        </div>
        <div className="mt-0.5 text-[13px] text-muted">{timeAgo(n.at)}{where && <> · {where}</>}</div>
      </div>
    </button>
  );
}

function buildActivityRows(list: Notification[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let lastDayKey = "";
  // list is sorted unread-first, so "Today" (and other days) can appear
  // twice — once per tier — but within a tier it must be in date order, or
  // this loop starts a new divider every time the date happens to flip,
  // instead of once per real day boundary.
  for (const n of list) {
    const dk = new Date(n.at).toDateString();
    if (dk !== lastDayKey) { rows.push({ kind: "divider", key: `d_${dk}`, label: dayLabel(n.at) }); lastDayKey = dk; }
    const last = rows[rows.length - 1];
    if (n.actorId && last?.kind === "group" && last.actorId === n.actorId) { last.items.push(n); continue; }
    if (n.actorId && last?.kind === "single" && last.n.actorId === n.actorId) {
      rows[rows.length - 1] = { kind: "group", key: `g_${last.n.id}`, actorId: n.actorId, items: [last.n, n] };
      continue;
    }
    rows.push({ kind: "single", n });
  }
  return rows;
}

export function Inbox({ notifications, clientById, projectById, onOpen, onMarkAllRead, onSyncEmail, syncingEmail, onSyncAppointments, syncingAppointments, unmatchedEmails = [], onAddAsClient, onDismissUnmatched }: {
  notifications: Notification[]; // caller's, newest-first
  clientById: (id: string) => Client | null;
  projectById: (id: string) => Project | null;
  onOpen: (n: Notification) => void;
  onMarkAllRead: () => void;
  onSyncEmail?: () => void; // admin-only: pull Gmail replies on demand
  syncingEmail?: boolean;
  onSyncAppointments?: () => void; // admin-only: pull upcoming GHL appointments on demand
  syncingAppointments?: boolean;
  unmatchedEmails?: UnmatchedEmail[]; // unknown-sender emails to triage (admin)
  onAddAsClient?: (u: UnmatchedEmail) => void;
  onDismissUnmatched?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const unreadCount = notifications.filter((n) => !n.read).length;
  // Defaults to Unread — the thing you actually open this page to check —
  // rather than "All", which buries anything new under everything already read.
  const [filter, setFilter] = useState<InboxFilter>("unread");
  // Older rows predate `kind` (see notification-kind.sql) — treat missing as
  // "activity", the more common case, same fallback rowToNotif already uses.
  // SMS/Email split the old combined "Messages" bucket by the fixed prefix
  // the webhook/inboundIngest always stamps on inbound-message notification
  // text ("sent a text:" / "sent an email:") — there's no separate channel
  // field on Notification itself. DM notifications (kind "dm") aren't part
  // of either split; they still show under Unread/All.
  const filtered = (filter === "all" || filter === "unread" ? notifications
    : notifications.filter((n) => {
        if (filter === "sms") return n.kind === "message" && n.text.includes("sent a text:");
        if (filter === "email") return n.kind === "message" && n.text.includes("sent an email:");
        return (n.kind ?? "activity") === "activity";
      }))
    .filter((n) => filter !== "unread" || !n.read)
    // Unread first (each tier further sorted newest-first by actual date —
    // day dividers/grouping below rely on that, or a tier whose original
    // order isn't already chronological produces a cascade of near-empty
    // day headers as the date ping-pongs between entries).
    .slice().sort((a, b) => Number(a.read) - Number(b.read) || new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    // min-h-0 matters now that this sits under the Team Chat tab bar in a
    // flex column: without it the list keeps its content height, overflow
    // never engages, and the tab bar scrolls away with the list.
    <div className="min-h-0 flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mx-auto max-w-3xl">
        {/* Unsorted email — real people who emailed but aren't clients yet.
            Read, then add them as a client (pulls their conversation onto a
            new page) or dismiss. */}
        {unmatchedEmails.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-amber-400/40 bg-amber-50/60">
            <div className="flex items-center gap-2 border-b border-amber-400/30 px-4 py-2 text-[13px] font-semibold text-amber-800">
              <I.inbox /> Unsorted email · {unmatchedEmails.length}
              <span className="font-normal text-amber-700/80">— people who aren&apos;t clients yet</span>
            </div>
            {unmatchedEmails.map((u) => {
              const open = expanded.has(u.id);
              return (
                <div key={u.id} className="border-b border-amber-400/20 px-4 py-2.5 last:border-0">
                  <div className="flex items-start gap-2">
                    <button onClick={() => toggle(u.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[15px] font-medium">{u.fromName || u.fromEmail} <span className="font-normal text-muted">· {u.subject || "(no subject)"}</span></div>
                      <div className="truncate text-[13px] text-muted">{u.fromEmail} · {timeAgo(u.at)}</div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {onAddAsClient && <button onClick={() => onAddAsClient(u)} className="rounded-md border border-accent bg-accent px-2 py-1 text-[13px] font-medium text-white hover:opacity-90">Add as client</button>}
                      {onDismissUnmatched && <button onClick={() => onDismissUnmatched(u.id)} title="Dismiss" className="rounded-md border px-2 py-1 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">Dismiss</button>}
                    </div>
                  </div>
                  {open && <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-amber-400/20 bg-surface p-2.5 text-[14px] leading-relaxed">{u.body || "(no body)"}</div>}
                </div>
              );
            })}
          </div>
        )}
        {(notifications.length > 0 || onSyncEmail || onSyncAppointments) && (
          // One row: filters on the left (used constantly, keep readable
          // text), the less-common admin actions as small icon buttons
          // pinned to the right via ml-auto. flex-wrap so it still degrades
          // to two lines rather than overlapping in the narrower Team Chat
          // split, instead of a fixed second row always taking space.
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {notifications.length > 0 && (
              <div className="flex w-fit flex-wrap overflow-hidden rounded-lg border">
                {([["unread", "Unread"], ["all", "All"], ["sms", "SMS"], ["email", "Email"], ["activity", "Notices"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setFilter(v)} className={`px-2.5 py-1 text-[13px] font-medium ${filter === v ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:text-foreground"}`}>{label}</button>
                ))}
              </div>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {onSyncAppointments && (
                <button onClick={onSyncAppointments} disabled={syncingAppointments} title="Sync appointments — pull upcoming appointments from GoHighLevel into the app"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-surface text-muted hover:bg-background hover:text-foreground disabled:opacity-50">{syncingAppointments ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" /> : <I.calendar />}</button>
              )}
              {onSyncEmail && (
                <button onClick={onSyncEmail} disabled={syncingEmail} title="Sync email — pull recent client email replies from Gmail into the app"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-surface text-muted hover:bg-background hover:text-foreground disabled:opacity-50">{syncingEmail ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" /> : <I.repeat />}</button>
              )}
              {notifications.length > 0 && (
                <button onClick={onMarkAllRead} disabled={unreadCount === 0} title="Mark all as read"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-surface text-muted hover:bg-background hover:text-foreground disabled:opacity-40"><I.check /></button>
              )}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          {notifications.length > 0 && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-16 text-center text-muted">
              <I.bell />
              <span className="text-[15px]">Nothing in this filter</span>
            </div>
          )}
          {notifications.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-16 text-center text-muted">
              <I.bell />
              <span className="text-[15px]">You&apos;re all caught up</span>
              <span className="text-[13px]">Mentions, comments, and assignments show up here.</span>
            </div>
          )}
          {buildActivityRows(filtered).map((row) => {
            if (row.kind === "divider") {
              return <div key={row.key} className="px-1 pb-0.5 pt-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted first:pt-0">{row.label}</div>;
            }
            if (row.kind === "single") return <NotificationRow key={row.n.id} n={row.n} clientById={clientById} projectById={projectById} onOpen={onOpen} />;
            // Collapsed by default — a burst of 2+ notifications from the
            // same sender is the exact wall-of-identical-cards the day/
            // grouping pass exists to prevent. Reuses the same expand Set
            // the unsorted-email rows above already use.
            const open = expanded.has(row.key);
            const unread = row.items.filter((n) => !n.read).length;
            const latest = row.items[row.items.length - 1];
            return (
              <div key={row.key}>
                <button onClick={() => toggle(row.key)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:border-accent ${unread > 0 ? "border-accent/40 bg-accent-soft" : "bg-surface"}`}>
                  <Avatar id={row.actorId} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className={`truncate text-[15px] leading-snug ${unread > 0 ? "font-medium" : ""}`}>{row.items.length} updates{unread > 0 ? ` · ${unread} unread` : ""}</div>
                      {unread > 0 && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted">{latest.text}</div>
                  </div>
                  <I.chevron className={`mt-1.5 shrink-0 text-muted transition ${open ? "rotate-90" : ""}`} />
                </button>
                {open && (
                  <div className="ml-4 mt-1.5 space-y-1.5 border-l pl-3">
                    {row.items.map((n) => <NotificationRow key={n.id} n={n} clientById={clientById} projectById={projectById} onOpen={onOpen} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

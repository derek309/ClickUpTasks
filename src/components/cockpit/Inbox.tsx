"use client";

// The sidebar Inbox — every notification addressed to you (mentions,
// comments on your tasks, assignments, delegations, status/due changes),
// as a proper full-page reading list instead of the small bell popover.
import { useState } from "react";
import { timeAgo, type Notification, type Client, type Project, type UnmatchedEmail } from "@/lib/data";
import { I, Avatar } from "./ui";

type InboxFilter = "all" | "message" | "activity";

export function Inbox({ notifications, clientById, projectById, onOpen, onMarkAllRead, onSyncEmail, syncingEmail, unmatchedEmails = [], onAddAsClient, onDismissUnmatched }: {
  notifications: Notification[]; // caller's, newest-first
  clientById: (id: string) => Client | null;
  projectById: (id: string) => Project | null;
  onOpen: (n: Notification) => void;
  onMarkAllRead: () => void;
  onSyncEmail?: () => void; // admin-only: pull Gmail replies on demand
  syncingEmail?: boolean;
  unmatchedEmails?: UnmatchedEmail[]; // unknown-sender emails to triage (admin)
  onAddAsClient?: (u: UnmatchedEmail) => void;
  onDismissUnmatched?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const unreadCount = notifications.filter((n) => !n.read).length;
  const [filter, setFilter] = useState<InboxFilter>("all");
  // Older rows predate `kind` (see notification-kind.sql) — treat missing as
  // "activity", the more common case, same fallback rowToNotif already uses.
  const filtered = filter === "all" ? notifications : notifications.filter((n) => (n.kind ?? "activity") === filter);

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
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
        {(notifications.length > 0 || onSyncEmail) && (
          <div className="mb-3 flex items-center justify-between gap-2">
            {notifications.length > 0 ? (
              <div className="flex overflow-hidden rounded-lg border">
                {([["all", "All"], ["message", "Messages"], ["activity", "Task notices"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setFilter(v)} className={`px-2.5 py-1 text-[13px] font-medium ${filter === v ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:text-foreground"}`}>{label}</button>
                ))}
              </div>
            ) : <span />}
            <div className="flex items-center gap-2">
              {onSyncEmail && (
                <button onClick={onSyncEmail} disabled={syncingEmail} title="Pull recent client email replies from Gmail into the app"
                  className="inline-flex items-center gap-1 rounded-md border bg-surface px-2.5 py-1 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-50"><I.repeat /> {syncingEmail ? "Syncing…" : "Sync email"}</button>
              )}
              {notifications.length > 0 && (
                <button onClick={onMarkAllRead} disabled={unreadCount === 0} className="rounded-md border bg-surface px-2.5 py-1 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">Mark all as read</button>
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
          {filtered.map((n) => {
            const where = n.projectId ? projectById(n.projectId)?.name : n.clientId ? clientById(n.clientId)?.name : null;
            const canOpen = !!(n.taskId || n.clientId);
            return (
              <button key={n.id} onClick={() => onOpen(n)} disabled={!canOpen}
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${n.read ? "bg-surface" : "border-accent/40 bg-accent-soft"} ${canOpen ? "hover:border-accent" : "cursor-default opacity-80"}`}>
                <Avatar id={n.actorId ?? null} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <div className={`text-[15px] leading-snug ${n.read ? "" : "font-medium"}`}>{n.text}</div>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">{timeAgo(n.at)}{where && <> · {where}</>}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

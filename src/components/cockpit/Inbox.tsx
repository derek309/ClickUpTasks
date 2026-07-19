"use client";

// The sidebar Inbox — every notification addressed to you (mentions,
// comments on your tasks, assignments, delegations, status/due changes),
// as a proper full-page reading list instead of the small bell popover.
import { useState } from "react";
import { timeAgo, type Notification, type Client, type Project } from "@/lib/data";
import { I, Avatar } from "./ui";

type InboxFilter = "all" | "message" | "activity";

export function Inbox({ notifications, clientById, projectById, onOpen, onMarkAllRead, onSyncEmail, syncingEmail }: {
  notifications: Notification[]; // caller's, newest-first
  clientById: (id: string) => Client | null;
  projectById: (id: string) => Project | null;
  onOpen: (n: Notification) => void;
  onMarkAllRead: () => void;
  onSyncEmail?: () => void; // admin-only: pull Gmail replies on demand
  syncingEmail?: boolean;
}) {
  const unreadCount = notifications.filter((n) => !n.read).length;
  const [filter, setFilter] = useState<InboxFilter>("all");
  // Older rows predate `kind` (see notification-kind.sql) — treat missing as
  // "activity", the more common case, same fallback rowToNotif already uses.
  const filtered = filter === "all" ? notifications : notifications.filter((n) => (n.kind ?? "activity") === filter);

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mx-auto max-w-3xl">
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

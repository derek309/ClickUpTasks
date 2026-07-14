"use client";

// The sidebar Inbox — every notification addressed to you (mentions,
// comments on your tasks, assignments, delegations, status/due changes),
// as a proper full-page reading list instead of the small bell popover.
import { timeAgo, type Notification, type Client, type Project } from "@/lib/data";
import { I, Avatar } from "./ui";

export function Inbox({ notifications, clientById, projectById, onOpen, onMarkAllRead }: {
  notifications: Notification[]; // caller's, newest-first
  clientById: (id: string) => Client | null;
  projectById: (id: string) => Project | null;
  onOpen: (n: Notification) => void;
  onMarkAllRead: () => void;
}) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mx-auto max-w-3xl">
        {notifications.length > 0 && (
          <div className="mb-3 flex items-center justify-end">
            <button onClick={onMarkAllRead} disabled={unreadCount === 0} className="rounded-md border bg-surface px-2.5 py-1 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-40">Mark all as read</button>
          </div>
        )}
        <div className="space-y-1.5">
          {notifications.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-16 text-center text-muted">
              <I.bell />
              <span className="text-[15px]">You&apos;re all caught up</span>
              <span className="text-[13px]">Mentions, comments, and assignments show up here.</span>
            </div>
          )}
          {notifications.map((n) => {
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

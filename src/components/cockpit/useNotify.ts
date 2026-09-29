"use client";

// Telling teammates: the in-app bell, its email companion, the richer email
// for a comment mention, whether a task has an unread reply, and clearing a
// task's notifications when it is opened. Lifted out of Cockpit.tsx unchanged
// (audit 2026-09-29, 3.4).

import * as React from "react";
import { newId } from "./ui";
import { type Me, type Notification, type NotificationKind, type Task } from "@/lib/data";
import { insertNotif, markNotifReadDb } from "@/lib/db";
import { isInboxNotification } from "@/lib/extensionInbox";
import { authedFetch } from "@/lib/supabase";

export type UseNotifyDeps = {
  tasksRef: React.RefObject<Task[]>;
  me: Me;
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
  notifications: Notification[];
};

export function useNotify({ tasksRef, me, setNotifications, notifications }: UseNotifyDeps) {
  // Best-effort email companion to ANY in-app notification — the bell above
  // already fired, so a failure here (Google not configured, non-Workspace
  // sender, send error) is swallowed rather than surfaced. Generic version of
  // the older mention-only path (see sendMentionEmail below, which still
  // covers the one case — task-comment mentions — that has a richer,
  // quoted-comment email of its own).
  const sendNotificationEmail = (recipientMemberId: string, subject: string, link: string | undefined, kind: NotificationKind) => {
    authedFetch("/api/notifications/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientMemberId, subject, link, kind }),
    }).catch(() => {});
  };

  // kind defaults to "activity" (automatic side-effect notice) — call sites
  // for a direct human communication (an @mention or comment) pass
  // kind: "message" explicitly, so the Inbox can filter the two apart.
  // skipEmail is set only by the one call site that already fires its own
  // richer, quoted-comment email (sendMentionEmail, task-comment mentions) —
  // every other notification gets this plain generic email automatically.
  const notify = (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean; link?: string }) => {
    // A private task's title must never leave its owner. RLS keeps the task row
    // itself unreadable, but notification text is plain and unprotected, and it
    // doubles as the EMAIL SUBJECT — so without this, marking a personal task
    // done mailed its title to every admin, who then couldn't open the task the
    // mail pointed at. Guarding here rather than at each call site so no future
    // notify() can reintroduce it. Optional chaining is deliberate: a taskId we
    // can't resolve locally is treated as not-private, not as private.
    const nt = taskId ? tasksRef.current.find((x) => x.id === taskId) : null;
    if (nt?.private && recipientId !== nt.assigneeId) return;
    const n: Notification = { id: newId("n_"), recipientId, text, taskId, actorId: me.id, clientId: extra?.clientId ?? null, projectId: extra?.projectId ?? null, at: new Date().toISOString(), read: false, kind: extra?.kind ?? "activity" };
    setNotifications((ns) => [n, ...ns]);
    insertNotif(n);
    if (!extra?.skipEmail) {
      // extra.link wins: a caller with no task or client to point at (Team
      // Chat) would otherwise send an email whose only link is the app root.
      const link = extra?.link ?? (taskId ? `?task=${encodeURIComponent(taskId)}` : extra?.clientId ? `?client=${encodeURIComponent(extra.clientId)}` : undefined);
      sendNotificationEmail(recipientId, text, link, extra?.kind ?? "activity");
    }
  };

  // Best-effort email companion to an @mention notification — the in-app
  // bell above already fired, so a failure here (Google not configured,
  // non-Workspace sender, send error) is swallowed rather than surfaced.
  // The title is not sent: the route reads it off the task itself, so the
  // email can only ever say what the task really says.
  const sendMentionEmail = (recipientMemberId: string, taskId: string, commentBody: string) => {
    authedFetch("/api/notifications/mention-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientMemberId, taskId, commentBody }),
    }).catch(() => {});
  };


  // A live comment/mention thread is easy to miss since notifications aren't
  // reliably checked — surfaced separately from the bell, as its own
  // top-of-list group/sort-boost (see buildGroups/sortTasks below), above
  // even Urgent priority.
  const hasUnreadReply = (t: Task) => notifications.some((n) => n.taskId === t.id && n.recipientId === me.id && n.kind === "message" && !n.read);
  // Notifications otherwise only get marked read via the bell dropdown —
  // since the whole point of the "Needs your reply" boost is that
  // notifications aren't reliably checked, actually opening the task itself
  // should clear it too. A client's review or status change on the task counts,
  // the same set the Inboxes Mac app shows and clears.
  const markTaskNotifsRead = (taskId: string) => {
    const ids = notifications.filter((n) => n.taskId === taskId && n.recipientId === me.id && isInboxNotification(n) && !n.read).map((n) => n.id);
    if (!ids.length) return;
    setNotifications((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    ids.forEach((id) => markNotifReadDb(id));
  };

  return { hasUnreadReply, markTaskNotifsRead, notify, sendMentionEmail };
}

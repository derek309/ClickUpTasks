// The Inboxes Mac app's view of a teammate's unread ClickUpTasks notifications
// (GET /api/extension/inbox). Pure helpers, so the rules for which notification
// is which can be tested without a database.
//
// Only three kinds belong in Inboxes. Inbound email, SMS and calls also write
// kind "message" notifications (inboundIngest.ts, ghl/webhook), but Inboxes
// already reads those straight from Gmail and GoHighLevel, so showing them again
// here would put every client email in the list twice.

export type InboxKind = "mention" | "comment" | "client_chat";

type NotificationText = { text: string | null; actor_id: string | null };

/** Which Inboxes kind a notification is, or null when it does not belong there.
 *  Teammate events carry an actor (Cockpit.tsx addComment / addNote); a client's
 *  portal chat has none and says "sent a message on" (waiting/[token]/messages). */
export function inboxKind(n: NotificationText): InboxKind | null {
  const text = n.text ?? "";
  if (n.actor_id) {
    if (text.includes("mentioned you in")) return "mention";
    if (text.includes("commented on")) return "comment";
    return null;
  }
  return text.includes(" sent a message on ") ? "client_chat" : null;
}

type CommentLike = { authorId?: string; body?: string; kind?: string };

/** The newest real comment an author left on a task, for the excerpt under a
 *  mention or comment notification. System event lines are skipped. */
export function latestCommentBy(comments: unknown, authorId: string | null): string | null {
  if (!authorId || !Array.isArray(comments)) return null;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i] as CommentLike;
    if (c?.authorId === authorId && c.kind !== "event" && typeof c.body === "string" && c.body.trim()) return c.body.trim();
  }
  return null;
}

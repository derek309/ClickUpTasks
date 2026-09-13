// The Inboxes Mac app's view of a teammate's unread ClickUpTasks notifications
// (GET /api/extension/inbox). Pure helpers, so the rules for which notification
// is which can be tested without a database.
//
// Only four kinds belong in Inboxes. Inbound email, SMS and calls also write
// kind "message" notifications (inboundIngest.ts, ghl/webhook), but Inboxes
// already reads those straight from Gmail and GoHighLevel, so showing them again
// here would put every client email in the list twice.

export type InboxKind = "mention" | "comment" | "client_chat" | "client_review";

/** The notifications Inboxes reads and clears: every message notification, and
 *  the activity ones a client caused (no actor), which is where document reviews
 *  and portal status changes land (notifyTeamOfClientActivity, waiting status).
 *  Teammate activity (moves, assignments) stays out. */
export function isInboxNotification(n: { kind?: string | null; actorId?: string | null }): boolean {
  return n.kind === "message" || (n.kind === "activity" && !n.actorId);
}

/** isInboxNotification as a PostgREST or() filter, for the routes. */
export const INBOX_NOTIFICATIONS = "kind.eq.message,and(kind.eq.activity,actor_id.is.null)";

type NotificationText = { text: string | null; actor_id: string | null };

// What a client did on a review, as the bell words it: taskDocumentServer.ts
// (commented on, approved, sent changes to, asked for changes on the page) and
// waiting/[token]/status (approved, flagged, requested changes on the task).
// Anchored, with no colon before the verb, so a logged email such as
// "ClickUpLocal sent an email: Invoice approved" and the "No approval yet"
// reminder stay out.
const CLIENT_REVIEW = /^[^:"“]+ (commented on the [\w ]+ on|approved( the [\w ]+ on)?|sent changes to the [\w ]+ on|asked for changes on the [\w ]+ on|requested changes on|flagged) ".+"( for a closer look)?\.$/;

/** Which Inboxes kind a notification is, or null when it does not belong there.
 *  Teammate events carry an actor (Cockpit.tsx addComment / addNote); a client's
 *  portal chat and review have none. */
export function inboxKind(n: NotificationText): InboxKind | null {
  const text = n.text ?? "";
  if (n.actor_id) {
    if (text.includes("mentioned you in")) return "mention";
    if (text.includes("commented on")) return "comment";
    return null;
  }
  if (text.includes(" sent a message on ")) return "client_chat";
  return CLIENT_REVIEW.test(text) ? "client_review" : null;
}

type CommentLike = { authorId?: string; body?: string; kind?: string };

/** The newest comment an author left on a task, for the excerpt under a
 *  notification. System event lines are skipped unless asked for, since a
 *  client's review notes are logged as events. */
export function latestCommentBy(comments: unknown, authorId: string | null, withEvents = false): string | null {
  if (!authorId || !Array.isArray(comments)) return null;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i] as CommentLike;
    if (c?.authorId === authorId && (withEvents || c.kind !== "event") && typeof c.body === "string" && c.body.trim()) return c.body.trim();
  }
  return null;
}

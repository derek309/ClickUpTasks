// The Inbox (Derek, 2026-10-01): every email, text and task chat in one
// place, so nobody has to check Gmail and two GoHighLevel logins. Each person
// sees their own Gmail plus GoHighLevel conversations assigned to them or
// unassigned, and keeps their own read / snooze / done state per conversation
// (supabase/inbox.sql). Shared by the server and the browser.
import type { Message } from "@/lib/data";

/** One conversation in the Inbox. A Gmail thread, a GoHighLevel conversation,
 *  or a task's portal chat; anything else stands alone. */
export function threadKeyOf(m: Pick<Message, "id" | "channel" | "taskId" | "gmailThreadId" | "ghlConversationId">): string {
  if (m.gmailThreadId) return `gm:${m.gmailThreadId}`;
  if (m.ghlConversationId) return `ghl:${m.ghlConversationId}`;
  if (m.channel === "chat" && m.taskId) return `chat:${m.taskId}`;
  return `msg:${m.id}`;
}

/** "Reply to X" tasks are being replaced by the Inbox. They stay on until the
 *  Inbox is live, then INBOX_REPLY_TASKS=off on Vercel stops them: a message
 *  then reaches a task only when its conversation is already linked to one. */
export function raiseReplyTasks(): boolean {
  return (process.env.INBOX_REPLY_TASKS ?? "").trim().toLowerCase() !== "off";
}

/** An address or phone in a block list: an exact address, a "@domain" entry,
 *  or the same phone number written another way. */
export function isBlocked(address: string | null | undefined, blocks: Iterable<string>): boolean {
  const a = (address ?? "").trim().toLowerCase();
  if (!a) return false;
  const digits = a.replace(/\D/g, "").slice(-10);
  for (const b of blocks) {
    if (b === a) return true;
    if (b.startsWith("@") && a.endsWith(b)) return true;
    if (!a.includes("@") && digits.length === 10 && b.replace(/\D/g, "").slice(-10) === digits) return true;
  }
  return false;
}

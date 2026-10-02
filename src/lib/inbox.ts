// The Inbox (Derek, 2026-10-01): every email, text and task chat in one
// place, so nobody has to check Gmail and two GoHighLevel logins. Each person
// sees their own Gmail plus GoHighLevel conversations assigned to them or
// unassigned, and keeps their own read / snooze / done state per conversation
// (supabase/inbox.sql). Shared by the server and the browser.
import type { Message } from "@/lib/data";

/** One conversation in the Inbox. A Gmail thread, a GoHighLevel conversation,
 *  or a task's portal chat; anything else stands alone. */
export function threadKeyOf(m: Pick<Message, "id" | "channel" | "taskId" | "gmailThreadId" | "ghlConversationId"> & { threadKey?: string }): string {
  if (m.threadKey) return m.threadKey;
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

/** An "Always let in" entry (Inbox Settings): an address as written, or a
 *  domain, stored "@acme.com" so isBlocked's matching works for it too. */
export function allowEntry(raw: string): string | null {
  const a = raw.trim().toLowerCase().replace(/^mailto:/, "");
  if (!a || !/^[a-z0-9@._+-]+$/.test(a)) return null;
  if (a.includes("@") && !a.startsWith("@")) return /^[^@]+@[^@]+\.[^@]+$/.test(a) ? a : null;
  const domain = a.replace(/^@/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? `@${domain}` : null;
}

/** Updates began on this day: older automated mail is not pulled in. */
export const UPDATES_FROM = Date.parse("2026-10-02T07:00:00Z");

/** The Gmail search for a teammate's inbox. */
export function inboundGmailQuery(days: number, allows: string[], onlyAllowed = false): string {
  const froms = allows.map(allowEntry).filter((a): a is string => !!a).slice(0, 40)
    .map((a) => `from:${a.startsWith("@") ? a.slice(1) : a}`);
  // onlyAllowed: the catch-up after adding someone looks for just them.
  // Every tab now (Derek, 2026-10-02: "let it all flow in"); what is not
  // Primary is sorted into the Updates folder. onlyAllowed: the catch-up after
  // adding someone to Always to Inbox looks for just them.
  if (onlyAllowed) return `in:inbox {${froms.join(" ") || "from:nobody.invalid"}} newer_than:${days}d -from:me`;
  return `in:inbox newer_than:${days}d -from:me`;
}

// What we keep of a formatted email, as plain text the Inbox and the task
// show: paragraphs and lines kept, a bullet for each list item, and a link's
// address after its words.
export function richToText(html: string): string {
  return html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, words: string) => {
      const w = words.replace(/<[^>]+>/g, "").trim();
      return w && w !== href ? `${w} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<\/(p|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#0?39;|&apos;/gi, "'").replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\n\n(?=• )/g, "\n").trim();
}

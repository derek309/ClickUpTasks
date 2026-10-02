// The Inbox's pure logic: grouping messages into conversations and deciding
// which folder each one is in. No React, no Supabase, so it is tested on its
// own (inboxModel.test.ts). Mockup Derek picked, 2026-10-01:
// https://claude.ai/artifact/HQwjkE4nCCx4QqFWcPLFQX
import type { Message, MessageChannel } from "@/lib/data";
import { threadKeyOf, isBlocked } from "@/lib/inbox";

export type InboxState = { threadKey: string; readAt: string | null; snoozedUntil: string | null; doneAt: string | null; trashedAt?: string | null; starredAt?: string | null; updatedAt: string | null };
export type GhlConv = { id: string; assignedMemberId: string | null; contactName: string | null; phone: string | null; email: string | null; locationId: string };

export type InboxThread = {
  key: string;
  /** Newest first. */
  messages: Message[];
  latest: Message;
  channel: MessageChannel;
  subject: string | null;
  peerName: string;
  peerAddress: string | null;
  clientId: string | null;
  contactId: string | null;
  taskId: string | null;
  ghlConversationId: string | null;
  unread: boolean;
  snoozed: boolean;
  snoozedUntil: string | null;
  done: boolean;
  /** Deleted: in the Inbox's Trash (and Gmail's). */
  trashed: boolean;
  starred: boolean;
  /** You wrote last. */
  sentLast: boolean;
  /** In the Updates folder, not the Inbox: their newest message is automated
   *  or Gmail filed it outside Primary, and they are not on Always to Inbox. */
  updates: boolean;
  /** They have written at least once. Only you so far: it lives in Sent. */
  hasInbound: boolean;
  hasFiles: boolean;
  /** How many messages, for "Pam Macias 3". */
  count: number;
};

export type Folder = "inbox" | "updates" | "team" | "starred" | "drafts" | "snoozed" | "sent" | "done" | "trash" | "email" | "sms" | "social" | "call" | "chat";
export const SOCIAL: MessageChannel[] = ["fb", "ig", "web", "gbp"];

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/** Group into conversations, newest conversation first. `nameOf` turns a
 *  contact or client id into a name for messages that carry no peer name. */
export function buildThreads(messages: Message[], states: Map<string, InboxState>, opts: {
  now?: number;
  nameOf?: (m: Message) => string | null;
  convs?: Map<string, GhlConv>;
  /** Always to Inbox (addresses, "@domain"): their mail stays out of Updates. */
  allows?: string[];
} = {}): InboxThread[] {
  const now = opts.now ?? Date.now();
  const groups = new Map<string, Message[]>();
  for (const m of messages) {
    const k = threadKeyOf(m);
    const g = groups.get(k);
    if (g) g.push(m); else groups.set(k, [m]);
  }
  const out: InboxThread[] = [];
  for (const [key, list] of groups) {
    const seen = new Set<string>();
    const msgs = list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .sort((a, b) => time(b.at) - time(a.at));
    const latest = msgs[0];
    const lastInbound = msgs.find((m) => m.direction === "inbound");
    const st = states.get(key);
    const conv = latest.ghlConversationId ? opts.convs?.get(latest.ghlConversationId) : undefined;
    const peerMsg = msgs.find((m) => m.direction === "inbound" && m.peerName) ?? msgs.find((m) => m.peerName || m.peerAddress);
    const named = msgs.map((m) => opts.nameOf?.(m)).find(Boolean);
    const inboundAt = time(lastInbound?.at);
    // A new message from them brings a conversation back from Done or Snoozed.
    const trashed = !!st?.trashedAt && inboundAt <= time(st.trashedAt);
    const done = !trashed && !!st?.doneAt && inboundAt <= time(st.doneAt);
    const snoozed = !done && !trashed && !!st?.snoozedUntil && time(st.snoozedUntil) > now && inboundAt <= time(st.updatedAt);
    out.push({
      key, messages: msgs, latest, channel: latest.channel,
      subject: [...msgs].reverse().find((m) => m.subject)?.subject ?? null,
      // The contact's own name first (nameOf), then what the message said.
      peerName: latest.threadTitle || named || peerMsg?.peerName || conv?.contactName || peerMsg?.peerAddress || conv?.phone || conv?.email || "Unknown",
      peerAddress: peerMsg?.peerAddress ?? conv?.phone ?? conv?.email ?? null,
      clientId: msgs.find((m) => m.clientId)?.clientId || null,
      contactId: msgs.find((m) => m.contactId)?.contactId || null,
      taskId: msgs.find((m) => m.taskId)?.taskId ?? null,
      ghlConversationId: latest.ghlConversationId ?? null,
      unread: !!lastInbound && inboundAt > time(st?.readAt),
      snoozed, snoozedUntil: snoozed ? st!.snoozedUntil : null, done, trashed, starred: !!st?.starredAt,
      sentLast: latest.direction === "outbound",
      hasInbound: !!lastInbound,
      updates: !!lastInbound?.bulk && !isBlocked(lastInbound.peerAddress ?? peerMsg?.peerAddress, opts.allows ?? []),
      hasFiles: msgs.some((m) => m.attachments?.length),
      count: msgs.length,
    });
  }
  return out.sort((a, b) => time(b.latest.at) - time(a.latest.at));
}

export function inFolder(t: InboxThread, f: Folder, hasDraft: (key: string) => boolean): boolean {
  if (f === "trash") return t.trashed;
  if (t.trashed) return false;
  // Starred is a mark, not a place: a starred one stays wherever it is too.
  if (f === "starred") return t.starred;
  if (f === "drafts") return hasDraft(t.key);
  if (f === "sent") return t.sentLast;
  if (f === "done") return t.done;
  if (f === "snoozed") return t.snoozed;
  if (t.done || t.snoozed) return false;
  // Like Gmail: an email only you have written so far is in Sent, not here.
  if (!t.hasInbound) return false;
  // Updates: automated mail and what Gmail files outside Primary.
  if (f === "updates") return t.updates;
  if (t.updates) return false;
  if (f === "inbox") return true;
  if (f === "social") return SOCIAL.includes(t.channel);
  if (f === "team") return t.channel === "team";
  return t.channel === f;
}

/** Every word somewhere in the conversation: who, subject, text, file names. */
export function matchesSearch(t: InboxThread, q: string, clientName?: string | null): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [t.peerName, t.peerAddress, t.subject, clientName,
    ...t.messages.flatMap((m) => [m.body, m.subject, ...(m.attachments ?? []).map((a) => a.name)])].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function whereIs(t: InboxThread): "Inbox" | "Archive" | "Snoozed" | "Trash" {
  return t.trashed ? "Trash" : t.done ? "Archive" : t.snoozed ? "Snoozed" : "Inbox";
}

/** Today / Yesterday / Earlier this week / Older, for Group by day. */
export function dayGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  return "Older";
}

/** 10:12 AM today, Sep 30 otherwise. */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** When a snooze preset wakes up. */
export function snoozeUntil(preset: "1h" | "3h" | "tomorrow" | "monday", now = new Date()): Date {
  const d = new Date(now);
  if (preset === "1h") return new Date(d.getTime() + 3_600_000);
  if (preset === "3h") return new Date(d.getTime() + 3 * 3_600_000);
  const at9 = (x: Date) => { x.setHours(9, 0, 0, 0); return x; };
  if (preset === "tomorrow") { d.setDate(d.getDate() + 1); return at9(d); }
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  return at9(d);
}

export const CHANNEL_LABEL: Record<MessageChannel, string> = {
  email: "Email", sms: "Text", call: "Call", chat: "Task chat", team: "Team", fb: "Facebook", ig: "Instagram", web: "Website chat", gbp: "Google Business",
};
export const CHANNEL_ICON: Record<MessageChannel, string> = {
  email: "✉️", sms: "💬", call: "📞", chat: "🗂️", team: "🤝", fb: "📘", ig: "📸", web: "🌐", gbp: "🏪",
};

// ── Reading an email ──────────────────────────────────────────────────────
// An HTML email flattened to text is mostly tracking links, each hundreds of
// characters long (Derek, 2026-10-01: "emails that look like all links"). A
// link shows as its website instead, and runs of the same link collapse.
export type BodyPart = { text: string } | { url: string; label: string };
const URL_RE = /\[?<?(https?:\/\/[^\s<>"\]]+)>?\]?/g;

export function linkLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "link"; }
}

export function bodyParts(text: string): BodyPart[] {
  const out: BodyPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const url = m[1].replace(/[),.;:!?]+$/, "");
    // Punctuation after a link belongs to the sentence, not the link.
    const tail = m[1].length - url.length;
    const prev = out[out.length - 1];
    const label = linkLabel(url);
    // The same site twice in a row, with only space between: once is enough.
    const before = out[out.length - 2];
    if (!(prev && "text" in prev && !prev.text.trim() && before && "url" in before && before.label === label)) out.push({ url, label });
    else out.pop();
    last = at + m[0].length - (m[0].endsWith(m[1]) ? tail : 0);
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** True when an email is mostly links, so "Show original" is worth offering. */
export function isLinkHeavy(text: string): boolean {
  const urls = [...text.matchAll(URL_RE)].reduce((n, m) => n + m[0].length, 0);
  return urls > 200 && urls > text.length * 0.25;
}

/** The divider between messages from different days in a conversation:
 *  Today, Yesterday, Tue, Sep 30; a year shows only when it is not this one. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** A refresh's changed rows laid over what is loaded: a changed row replaces
 *  its old copy, a new one joins. */
export function mergeById<T extends { id: string }>(prev: T[], changed: T[]): T[] {
  if (!changed.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of changed) byId.set(m.id, m);
  return [...byId.values()];
}

/** States from a read, except where this browser changed one after that read
 *  began: the local change is newer, so it stays. */
export function mergeStates(cur: Map<string, InboxState>, read: Map<string, InboxState>, touched: Map<string, number>, readStartedAt: number): Map<string, InboxState> {
  const out = new Map(read);
  for (const [k, at] of touched) {
    if (at < readStartedAt) continue;
    const local = cur.get(k);
    if (local) out.set(k, local); else out.delete(k);
  }
  return out;
}

// ── Texts as a chat (Derek, 2026-10-01: "make texts like a phone") ─────────
// Mockup: https://claude.ai/artifact/CkvnXhb1rFVm9j1Rjcqh2g
export type ChatItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "group"; key: string; side: "theirs" | "mine"; who: string | null; messages: Message[] };

/** How many messages a chat shows before "Show earlier". */
export const CHAT_PAGE = 30;

/** Messages, oldest first, as day lines and runs of bubbles. A run is the same
 *  side and the same person, on the same day, with no gap over 30 minutes;
 *  it shows one time, under its last bubble. */
export function chatItems(oldestFirst: Message[], whoOf: (m: Message) => string | null, now = new Date()): ChatItem[] {
  const out: ChatItem[] = [];
  let group: Extract<ChatItem, { kind: "group" }> | null = null;
  let lastDay = "";
  for (const m of oldestFirst) {
    const label = dayLabel(m.at, now);
    if (label !== lastDay) { out.push({ kind: "day", key: `d:${m.id}`, label }); lastDay = label; group = null; }
    const side = m.direction === "outbound" ? "mine" : "theirs";
    const who = whoOf(m);
    const prev = group?.messages[group.messages.length - 1];
    const gap = prev ? new Date(m.at).getTime() - new Date(prev.at).getTime() : 0;
    if (!group || group.side !== side || group.who !== who || gap > 30 * 60_000) {
      group = { kind: "group", key: `g:${m.id}`, side, who, messages: [] };
      out.push(group);
    }
    group.messages.push(m);
  }
  return out;
}

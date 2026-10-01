// The Inbox's pure logic: grouping messages into conversations and deciding
// which folder each one is in. No React, no Supabase, so it is tested on its
// own (inboxModel.test.ts). Mockup Derek picked, 2026-10-01:
// https://claude.ai/artifact/HQwjkE4nCCx4QqFWcPLFQX
import type { Message, MessageChannel } from "@/lib/data";
import { threadKeyOf } from "@/lib/inbox";

export type InboxState = { threadKey: string; readAt: string | null; snoozedUntil: string | null; doneAt: string | null; updatedAt: string | null };
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
  /** You wrote last. */
  sentLast: boolean;
  hasFiles: boolean;
  /** How many messages, for "Pam Macias 3". */
  count: number;
};

export type Folder = "inbox" | "drafts" | "snoozed" | "sent" | "done" | "email" | "sms" | "social" | "call" | "chat";
export const SOCIAL: MessageChannel[] = ["fb", "ig", "web", "gbp"];

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/** Group into conversations, newest conversation first. `nameOf` turns a
 *  contact or client id into a name for messages that carry no peer name. */
export function buildThreads(messages: Message[], states: Map<string, InboxState>, opts: {
  now?: number;
  nameOf?: (m: Message) => string | null;
  convs?: Map<string, GhlConv>;
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
    const done = !!st?.doneAt && inboundAt <= time(st.doneAt);
    const snoozed = !done && !!st?.snoozedUntil && time(st.snoozedUntil) > now && inboundAt <= time(st.updatedAt);
    out.push({
      key, messages: msgs, latest, channel: latest.channel,
      subject: [...msgs].reverse().find((m) => m.subject)?.subject ?? null,
      peerName: peerMsg?.peerName || named || conv?.contactName || peerMsg?.peerAddress || conv?.phone || conv?.email || "Unknown",
      peerAddress: peerMsg?.peerAddress ?? conv?.phone ?? conv?.email ?? null,
      clientId: msgs.find((m) => m.clientId)?.clientId || null,
      contactId: msgs.find((m) => m.contactId)?.contactId || null,
      taskId: msgs.find((m) => m.taskId)?.taskId ?? null,
      ghlConversationId: latest.ghlConversationId ?? null,
      unread: !!lastInbound && inboundAt > time(st?.readAt),
      snoozed, snoozedUntil: snoozed ? st!.snoozedUntil : null, done,
      sentLast: latest.direction === "outbound",
      hasFiles: msgs.some((m) => m.attachments?.length),
      count: msgs.length,
    });
  }
  return out.sort((a, b) => time(b.latest.at) - time(a.latest.at));
}

export function inFolder(t: InboxThread, f: Folder, hasDraft: (key: string) => boolean): boolean {
  if (f === "drafts") return hasDraft(t.key);
  if (f === "sent") return t.sentLast;
  if (f === "done") return t.done;
  if (f === "snoozed") return t.snoozed;
  if (t.done || t.snoozed) return false;
  if (f === "inbox") return true;
  if (f === "social") return SOCIAL.includes(t.channel);
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

export function whereIs(t: InboxThread): "Inbox" | "Done" | "Snoozed" {
  return t.done ? "Done" : t.snoozed ? "Snoozed" : "Inbox";
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
  email: "Email", sms: "Text", call: "Call", chat: "Task chat", fb: "Facebook", ig: "Instagram", web: "Website chat", gbp: "Google Business",
};
export const CHANNEL_ICON: Record<MessageChannel, string> = {
  email: "✉️", sms: "💬", call: "📞", chat: "🗂️", fb: "ⓕ", ig: "📸", web: "🌐", gbp: "🅶",
};

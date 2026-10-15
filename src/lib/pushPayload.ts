// What a phone notification says, and which notifications become one (Derek,
// 2026-10-15: ClickUpTasks on the iPhone home screen, with notifications).
// Pure, so the server routes and the tests share it; the sending is
// lib/push.ts, the phone side is public/sw.js.
//
// Only what Derek cares about pushes: the client wrote (Needs you), Claude
// finished (Needs you), a teammate handed you a step or a task, or someone
// mentioned you or sent you a message. Everything else stays in the Inbox.

import { DM_LINK_PREFIX, clientHref, taskHref } from "./navState";

/** What public/sw.js reads off a push. */
export type PushPayload = {
  title: string;
  body: string;
  /** In app address, always starting "/", opened when the notification is tapped. */
  url: string;
  /** Same tag, same notification: a new one replaces the last instead of piling up. */
  tag?: string;
  /** The number on the app's icon, when the sender knows it. */
  badgeCount?: number;
};

const TITLE_MAX = 60;
const BODY_MAX = 180;
const TAG_MAX = 64;

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** The payload, tidied: one line each, short enough for a lock screen, and a
 *  link that can only ever open somewhere inside the app. */
export function buildPushPayload(p: { title?: string | null; body?: string | null; url?: string | null; tag?: string | null; badgeCount?: number | null }): PushPayload {
  const url = typeof p.url === "string" && p.url.startsWith("/") && !p.url.startsWith("//") ? p.url : "/";
  const out: PushPayload = {
    title: clip(p.title || "ClickUpTasks", TITLE_MAX) || "ClickUpTasks",
    body: clip(p.body || "", BODY_MAX),
    url,
  };
  const tag = clip(p.tag || "", TAG_MAX);
  if (tag) out.tag = tag;
  if (typeof p.badgeCount === "number" && Number.isFinite(p.badgeCount) && p.badgeCount >= 0) out.badgeCount = Math.floor(p.badgeCount);
  return out;
}

/** Where tapping it goes: the task over its client's list, a direct message
 *  thread, a client's chat, or the client. */
export function pushLink(p: { taskId?: string | null; clientId?: string | null; dmFrom?: string | null; chat?: boolean }): string {
  if (p.dmFrom) return `/${DM_LINK_PREFIX}&dm=${encodeURIComponent(p.dmFrom)}`;
  if (p.taskId) return taskHref({ id: p.taskId, clientId: p.clientId ?? null });
  if (p.clientId) return p.chat ? `${clientHref(p.clientId)}&tab=chat` : clientHref(p.clientId);
  return "/";
}

/** A notification row as the server reads it (supabase notifications). */
export type NotificationRowLike = {
  id: string;
  recipient_id: string | null;
  text: string | null;
  task_id: string | null;
  actor_id: string | null;
  client_id: string | null;
  kind: string | null;
};

export type TeammatePushReason = "dm" | "message" | "handoff";

// The app's own words for giving someone work (useComposer, useChecklist,
// useTaskEdits): "Derek assigned you", "gave you a step on", "delegated ... to you".
const HANDOFF = /\b(assigned you|gave you a step|delegated\b.*\bto you)\b/;

/** Why a notification a teammate made is worth a push, or null when it is not:
 *  a direct message, a mention or a message to you (kind "message"), or a step
 *  or task handed to you. Status moves, due dates, queue moves and ticks stay
 *  in the Inbox. */
export function teammatePushReason(n: { kind?: string | null; text?: string | null }): TeammatePushReason | null {
  if (n.kind === "dm") return "dm";
  if (n.kind === "message") return "message";
  if ((n.kind ?? "activity") === "activity" && HANDOFF.test(n.text ?? "")) return "handoff";
  return null;
}

/** The push for a notification a teammate made: the bell's own line, under
 *  the sender's name for a direct message (opening the thread) and under the
 *  client's name for the rest. The message itself is not read: the bell can
 *  be saved before the message is, so it could show the one before. */
export function teammatePush(n: NotificationRowLike, ctx: { actorName?: string | null; clientName?: string | null } = {}): PushPayload | null {
  const reason = teammatePushReason(n);
  if (!reason) return null;
  if (reason === "dm") {
    return buildPushPayload({
      title: ctx.actorName || "New message",
      body: n.text,
      url: pushLink({ dmFrom: n.actor_id }),
      tag: n.actor_id ? `dm:${n.actor_id}` : `n:${n.id}`,
    });
  }
  return buildPushPayload({
    title: ctx.clientName || "ClickUpTasks",
    body: n.text,
    url: pushLink({ taskId: n.task_id, clientId: n.client_id, chat: reason === "message" && !n.task_id }),
    tag: n.task_id ? `task:${n.task_id}` : `n:${n.id}`,
  });
}

/** The client wrote: the bell's own line ("Pam Macias sent a text: ..."),
 *  under the client's name, opening the task it landed on. */
export function clientWrotePush(p: { text: string; taskId?: string | null; clientId?: string | null; clientName?: string | null }): PushPayload {
  return buildPushPayload({
    title: p.clientName || "ClickUpTasks",
    body: p.text,
    url: pushLink({ taskId: p.taskId, clientId: p.clientId }),
    tag: p.taskId ? `task:${p.taskId}` : p.clientId ? `client:${p.clientId}` : undefined,
  });
}

/** Claude finished its step and the next turn is yours. */
export function claudeFinishedPush(p: { stepTitle: string; taskTitle: string; taskId: string; clientId?: string | null; clientName?: string | null }): PushPayload {
  const step = p.stepTitle.replace(/\s+/g, " ").trim();
  const task = p.taskTitle.replace(/\s+/g, " ").trim();
  const what = !step || step.toLowerCase() === task.toLowerCase() ? task : task ? `${step} on ${task}` : step;
  return buildPushPayload({
    title: p.clientName || "ClickUpTasks",
    body: `Claude finished ${what || "its step"}`,
    url: pushLink({ taskId: p.taskId, clientId: p.clientId }),
    tag: `task:${p.taskId}`,
  });
}

// --- A phone's subscription ---------------------------------------------------

/** The push services browsers hand out endpoints on. The server posts to the
 *  endpoint, so anything else is refused rather than letting a caller point
 *  the server at an address of their choosing. */
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^[a-z0-9.-]+\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9.-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9.-]+\.notify\.windows\.com$/,
];
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** A browser's PushSubscription.toJSON(), checked. */
export function parsePushSubscription(body: unknown): { ok: true; sub: PushSubscriptionInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  const endpoint = typeof b.endpoint === "string" ? b.endpoint.trim() : "";
  if (!endpoint) return { ok: false, error: "Missing endpoint." };
  if (endpoint.length > 1000) return { ok: false, error: "Endpoint is too long." };
  let url: URL;
  try { url = new URL(endpoint); } catch { return { ok: false, error: "Endpoint is not an address." }; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return { ok: false, error: "Endpoint must be a plain https address." };
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname.toLowerCase()))) return { ok: false, error: "Endpoint is not a known push service." };
  const p256dh = typeof b.keys?.p256dh === "string" ? b.keys.p256dh.trim() : "";
  const auth = typeof b.keys?.auth === "string" ? b.keys.auth.trim() : "";
  // An uncompressed P-256 key is 65 bytes (87 characters); the auth secret 16 (22).
  if (!B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return { ok: false, error: "Missing or bad p256dh key." };
  if (!B64URL.test(auth) || auth.length < 16 || auth.length > 32) return { ok: false, error: "Missing or bad auth key." };
  return { ok: true, sub: { endpoint, p256dh, auth } };
}

// The client page's Conversation (Derek, 2026-10-14, client header mockup):
// the newest thing said, the drafts not sent yet, and where a new message
// goes. Pure, so the strip, the feed and the tests read the same answers.
import { htmlToText, isMessageConversationTask, looksLikeHtml, timeAgo, type Attachment, type EmailDraft, type Message, type Task } from "./data";
import { isSignatureImage } from "./emailFiles";
import { isPicture } from "./pictures";

/** The channels the Conversation shows: emails, texts and portal chats. */
export type TalkChannel = "email" | "sms" | "chat";
export const isTalk = (m: Pick<Message, "channel">): m is Message & { channel: TalkChannel } =>
  m.channel === "email" || m.channel === "sms" || m.channel === "chat";

// ---------------------------------------------------------------------------
// Time order (Derek, 2026-10-14, feed round 3: "the whole feed must be
// strictly chronological"). A message's `at` comes as Postgres wrote it
// ("2026-10-07 16:15:06.49+00"), as PostgREST and Realtime send it
// ("2026-10-07T16:15:06.490076+00:00"), as the app stamps a send
// ("2026-10-07T16:15:06.490Z"), or with a local offset. Compared as strings
// those disagree (a space sorts before a "T", "09:15-07:00" before
// "15:00Z"), so every order here reads the instant instead.

/** The instant an `at` names, in milliseconds; 0 when it can't be read. */
export function timeOf(at: string | null | undefined): number {
  if (!at) return 0;
  const direct = Date.parse(at);
  if (!Number.isNaN(direct) && /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(at.trim())) return direct;
  // Postgres's own text: a space for the "T" and "+00" for the offset.
  const iso = at.trim().replace(/^(\d{4}-\d\d-\d\d) /, "$1T").replace(/([+-]\d\d)$/, "$1:00");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? (Number.isNaN(direct) ? 0 : direct) : t;
}

/** Oldest first, by the instant; the same instant keeps a steady order. */
export const byTime = (a: Pick<Message, "at" | "id">, b: Pick<Message, "at" | "id">) =>
  timeOf(a.at) - timeOf(b.at) || a.id.localeCompare(b.id);

/** A message's words as one plain line. */
export function plainLine(body: string): string {
  return (looksLikeHtml(body) ? htmlToText(body) : body).replace(/\s+/g, " ").trim();
}

/** The first words, cut at a word with "…" when there is more. */
export function firstWords(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}

/** The newest email, text or chat, as the Conversation's one line:
 *  Pamela, 2h ago: "Use this one for…", or You, 2h ago: "…". */
export function newestLine(messages: Message[], opts: { first: string; meId: string; nameOf: (memberId: string) => string | null; ago?: (at: string) => string }): { text: string; theirs: boolean; unread: boolean; at: string } | null {
  const newest = newestSaid(messages);
  if (!newest) return null;
  const theirs = newest.direction === "inbound";
  const who = theirs ? opts.first : !newest.createdBy || newest.createdBy === opts.meId ? "You" : (opts.nameOf(newest.createdBy) ?? "").trim().split(/\s+/)[0] || "We";
  const words = firstWords(plainLine(newest.body)) || (newest.subject ?? "").trim();
  const ago = (opts.ago ?? timeAgo)(newest.at);
  return { text: `${who}, ${ago}${words ? `: "${words}"` : ""}`, theirs, unread: theirs && !newest.read, at: newest.at };
}

/** The newest email, text or chat a person wrote (automatic ones left out). */
export function newestSaid(messages: Message[]): Message | null {
  return messages.filter((m) => isTalk(m) && !automaticKind(m)).reduce<Message | null>((a, m) => (!a || byTime(m, a) > 0 ? m : a), null);
}

/** The client wrote last and nobody has answered yet: their newest message
 *  (Derek, 2026-10-14: a red "Carol's waiting on a reply" line). Null when
 *  the newest thing said is ours. */
export function waitingOnReply(messages: Message[]): { id: string; at: string } | null {
  const newest = newestSaid(messages);
  return newest && newest.direction === "inbound" ? { id: newest.id, at: newest.at } : null;
}

/** How long, short: "5m", "2h", "3d". */
export function sinceShort(at: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - timeOf(at)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** "Carol's waiting on a reply · since 2h". */
export const waitingLine = (first: string, at: string, now?: number) => `${first}'s waiting on a reply · since ${sinceShort(at, now)}`;

/** Answer the way they wrote (Derek, 2026-10-14): the channel of their
 *  newest message when we can send that way, else the first we can. */
export function defaultChannel(messages: Message[], channels: TalkChannel[]): TalkChannel | null {
  const theirs = messages.filter((m) => isTalk(m) && m.direction === "inbound" && !automaticKind(m)).sort(byTime).pop();
  if (theirs && channels.includes(theirs.channel as TalkChannel)) return theirs.channel as TalkChannel;
  return channels[0] ?? null;
}

/** One draft not sent yet, wherever it is kept. */
export type ConversationDraft = {
  id: string;
  kind: TalkChannel;
  /** task: the task's draft email · step: a text or chat held on a step ·
   *  queued: Claude's draft in the Inbox · client: the client's own saved email. */
  source: "task" | "step" | "queued" | "client";
  taskId: string | null;
  taskTitle: string | null;
  stepId: string | null;
  queuedId: string | null;
  subject: string | null;
  /** The words, plain. */
  text: string;
  /** As stored: HTML for an email. */
  body: string;
  at: string;
  /** Who wrote it, for a Claude draft. */
  by: string | null;
};

type Queued = { id: string; kind: "email" | "text"; subject?: string; body: string; createdAt: string; by?: string };

/** Every draft for this client, oldest first (they sit at the bottom of the
 *  feed, under the newest message). A task's draft email that already went
 *  out is left off, as the task itself retires it (DraftEmail.tsx). */
export function collectClientDrafts(input: {
  tasks: Task[];
  messages: Message[];
  queued: Queued[];
  clientDraft: { draft: EmailDraft; clientId: string } | null;
  sentAlready: (draft: EmailDraft, taskMessages: Message[]) => boolean;
}): ConversationDraft[] {
  const out: ConversationDraft[] = [];
  for (const t of input.tasks) {
    if (t.status === "done") continue;
    const d = t.draftEmail;
    if (d && !input.sentAlready(d, input.messages.filter((m) => m.taskId === t.id))) {
      out.push({ id: `task:${t.id}`, kind: "email", source: "task", taskId: t.id, taskTitle: t.title, stepId: null, queuedId: null,
        subject: d.subject.trim() || null, text: plainLine(d.body), body: d.body, at: d.updatedAt || d.createdAt, by: null });
    }
    for (const s of t.subtasks ?? []) {
      if (s.done || !s.draftMessage || !s.draftMessage.body.trim()) continue;
      out.push({ id: `step:${t.id}:${s.id}`, kind: s.draftMessage.channel, source: "step", taskId: t.id, taskTitle: t.title, stepId: s.id, queuedId: null,
        subject: null, text: s.draftMessage.body.trim(), body: s.draftMessage.body, at: s.startedAt ?? t.createdAt ?? "", by: null });
    }
  }
  for (const q of input.queued) {
    out.push({ id: `queued:${q.id}`, kind: q.kind === "email" ? "email" : "sms", source: "queued", taskId: null, taskTitle: null, stepId: null, queuedId: q.id,
      subject: q.kind === "email" ? q.subject?.trim() || null : null, text: plainLine(q.body), body: q.body, at: q.createdAt, by: q.by ?? "Claude" });
  }
  const own = input.clientDraft?.draft;
  if (own && (own.subject.trim() || plainLine(own.body)) && !input.sentAlready(own, input.messages)) {
    out.push({ id: `client:${input.clientDraft!.clientId}`, kind: "email", source: "client", taskId: null, taskTitle: null, stepId: null, queuedId: null,
      subject: own.subject.trim() || null, text: plainLine(own.body), body: own.body, at: own.updatedAt || own.createdAt, by: null });
  }
  return out.sort((a, b) => timeOf(a.at) - timeOf(b.at) || a.id.localeCompare(b.id));
}

/** Where a new message from the Conversation goes (Derek, 2026-10-14, feed
 *  round 3: it said "No task" while the newest messages were on tasks): the
 *  task of the client's newest message, else the task of the newest message
 *  at all, else the client's open Conversation task, else no task (the
 *  client's conversation, as the Journal's Email and Text send). A task that
 *  is done or gone is passed over. A portal chat only shows on a task, so it
 *  needs one. */
export function whereNewMessageGoes(input: {
  channel: TalkChannel;
  tasks: Pick<Task, "id" | "title" | "status" | "priority" | "contactId">[];
  messages: Message[];
  contactId: string | null;
  first: string;
}): { taskId: string | null; taskTitle: string | null; says: string } {
  const open = (id: string | null | undefined) => (id ? input.tasks.find((t) => t.id === id && t.status !== "done") ?? null : null);
  const said = input.messages.filter((m) => isTalk(m) && !automaticKind(m)).sort(byTime).reverse();
  const theirs = open(said.find((m) => m.direction === "inbound")?.taskId);
  if (theirs) return { taskId: theirs.id, taskTitle: theirs.title, says: `Goes on "${theirs.title}", the task ${input.first} wrote on last` };
  const newest = open(said[0]?.taskId);
  if (newest) return { taskId: newest.id, taskTitle: newest.title, says: `Goes on "${newest.title}", the task of the newest message` };
  const convo = input.tasks.find((t) => t.status !== "done" && t.priority === "conversation" && isMessageConversationTask(t.title)
    && (!input.contactId || !t.contactId || t.contactId === input.contactId));
  if (convo) return { taskId: convo.id, taskTitle: convo.title, says: `Goes on "${convo.title}"` };
  if (input.channel === "chat") return { taskId: null, taskTitle: null, says: `A portal chat needs a task, so start one for ${input.first} first` };
  return { taskId: null, taskTitle: null, says: `Goes on ${input.first}'s conversation, on no task` };
}

/** The email being answered from the Conversation: their newest email, when
 *  it is newer than ours. The subject follows it as "Re: …". */
export function emailBeingAnswered(messages: Message[]): { id: string; subject: string; taskId: string | null } | null {
  const emails = messages.filter((m) => m.channel === "email" && !automaticKind(m)).sort(byTime).reverse();
  const theirs = emails.find((m) => m.direction === "inbound");
  if (!theirs) return null;
  const ours = emails.find((m) => m.direction === "outbound");
  if (ours && byTime(ours, theirs) > 0) return null;
  const subj = (theirs.subject ?? "").trim();
  return { id: theirs.id, subject: subj ? (/^re:/i.test(subj) ? subj : `Re: ${subj}`) : "", taskId: theirs.taskId ?? null };
}

// ---------------------------------------------------------------------------
// Automatic messages (Derek, 2026-10-14, feed polish): what a GoHighLevel
// workflow sent on its own (appointment reminders, payment receipts, invoice
// notices, purchase thank yous, review requests) and the calendar's own
// "Accepted:" replies fold to one muted line each in the Conversation. A
// message a teammate sent from the app (createdBy set) is never automatic.
// GoHighLevel stores no "sent by a workflow" flag we keep, and Derek's own
// texts from the GoHighLevel app also arrive with no createdBy, so the words
// decide, from the texts these workflows really send.

export type AutomaticKind = "appointment reminder" | "payment receipt" | "invoice notice" | "purchase thank you" | "review request" | "calendar reply" | "automatic message";

const AUTO_RULES: [AutomaticKind, RegExp[]][] = [
  ["purchase thank you", [/thank you for your recent purchase/i]],
  ["payment receipt", [/\bconfirmed your payment of\b/i, /\breceived (your )?payment of\b/i]],
  ["invoice notice", [/^\[[^\]]*\]\s*invoice\b/i, /\bsubscription payment of \$[\d,.]+ for invoice\b/i]],
  ["review request", [/\b(leave|write) (us )?(a )?(quick )?(google )?review\b/i, /\breview us on\b/i, /\bhow did we do\b/i, /\brate your experience\b/i]],
  ["appointment reminder", [
    /^\[reminder\]/i, /\breminder: upcoming appointment\b/i, /\bfriendly reminder that your appointment\b/i,
    /\byour appointment has been (rescheduled|cancell?ed)\b/i, /\bour appointment is (confirmed|starting)\b/i,
    /\bour meeting is (in an hour|starting|scheduled to start)\b/i, /\bmeeting is starting right now\b/i, /^meeting starting now\b/i,
    /\bwe['’]re on for our meeting\b/i, /\breminder that we have a meeting scheduled\b/i, /\bwe['’]re all set for the\b/i,
    /\binterview (is coming up|confirmed|cancell?ed|has been cancell?ed)\b/i,
  ]],
  ["automatic message", [
    /^ai call recap\b/i, /\bview this email in browser\b/i, /\bnew blog article\b/i,
    /\bi['’]m on the other line or away from the phone\b/i, /\ba resident claimed your offer\b/i,
  ]],
];

/** What kind of automatic message this is, or null when a person wrote it. */
export function automaticKind(m: Pick<Message, "direction" | "channel" | "subject" | "body"> & { createdBy?: string | null; bulk?: boolean }): AutomaticKind | null {
  if (m.createdBy) return null;
  const subject = (m.subject ?? "").trim();
  if (m.direction === "inbound") {
    if (m.channel === "email" && /^(accepted|declined|tentatively accepted|updated invitation|invitation)\s*:/i.test(subject)) return "calendar reply";
    return m.bulk ? "automatic message" : null;
  }
  const words = plainLine(m.body);
  for (const [kind, rules] of AUTO_RULES) {
    if (rules.some((r) => r.test(subject) || r.test(words))) return kind;
  }
  return m.bulk ? "automatic message" : null;
}

// ---------------------------------------------------------------------------
// The feed's rows: a divider for each day ("Today", "Yesterday", "Tue, Oct
// 13"), the task the messages are on said once when it changes, a "New since
// you last looked" line above the first message from the client since you
// last opened it, and each automatic message as one muted line unless they
// are shown.

const TZ = "America/Los_Angeles";
const dayKey = (iso: string) => new Date(timeOf(iso)).toLocaleDateString("en-CA", { timeZone: TZ });

/** "Today", "Yesterday", else "Tue, Oct 13" (Pacific). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const k = dayKey(iso);
  const today = dayKey(now.toISOString());
  if (k === today) return "Today";
  if (k === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return "Yesterday";
  return new Date(timeOf(iso)).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
}

/** "Oct 13" (Pacific). */
export const shortDay = (iso: string) => new Date(timeOf(iso)).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
/** "2:14 PM" (Pacific). */
export const clockTime = (iso: string) => new Date(timeOf(iso)).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
/** A message's own time: "2:14 PM" today, "Oct 7, 9:15 AM" on an older day,
 *  so a message whose day divider has scrolled away never reads as today's
 *  (Derek, 2026-10-14: Oct 7's 9:15, 9:22 and 9:32 AM looked like today). */
export const messageStamp = (iso: string, now: Date = new Date()) =>
  dayKey(iso) === dayKey(now.toISOString()) ? clockTime(iso) : `${shortDay(iso)}, ${clockTime(iso)}`;

export type FeedRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "new"; key: string }
  | { kind: "task"; key: string; taskId: string | null }
  | { kind: "auto"; key: string; m: Message; label: AutomaticKind }
  | { kind: "message"; key: string; m: Message; auto: AutomaticKind | null };

/** The feed in time order, oldest first, with its dividers. */
export function feedRows(messages: Message[], opts: { showAutomatic: boolean; seenAt: string | null; now?: Date }): FeedRow[] {
  const talk = messages.filter(isTalk).sort(byTime);
  const out: FeedRow[] = [];
  let day: string | null = null;
  let task: string | null | undefined;
  let newShown = false;
  for (const m of talk) {
    const auto = automaticKind(m);
    const k = dayKey(m.at);
    if (k !== day) { day = k; out.push({ kind: "day", key: `day:${k}`, label: dayLabel(m.at, opts.now) }); }
    if (!newShown && opts.seenAt && m.direction === "inbound" && !auto && timeOf(m.at) > timeOf(opts.seenAt)) {
      newShown = true;
      out.push({ kind: "new", key: "new" });
    }
    if (auto && !opts.showAutomatic) { out.push({ kind: "auto", key: m.id, m, label: auto }); continue; }
    const on = m.taskId ?? null;
    if (on !== task) { task = on; out.push({ kind: "task", key: `task:${m.id}`, taskId: on }); }
    out.push({ kind: "message", key: m.id, m, auto });
  }
  return out;
}

/** The tasks a new message can go on: the client's open tasks, the one
 *  talked on most lately first (its newest message, else its last touch). */
export function taskChoices(tasks: Pick<Task, "id" | "title" | "status" | "createdAt" | "lastActivityAt">[], messages: Pick<Message, "taskId" | "at">[]): { id: string; title: string }[] {
  const newest = new Map<string, string>();
  for (const m of messages) if (m.taskId && timeOf(newest.get(m.taskId)) < timeOf(m.at)) newest.set(m.taskId, m.at);
  const when = (t: (typeof tasks)[number]) => Math.max(timeOf(newest.get(t.id)), timeOf(t.lastActivityAt), timeOf(t.createdAt));
  return tasks.filter((t) => t.status !== "done").sort((a, b) => when(b) - when(a) || a.title.localeCompare(b.title)).map((t) => ({ id: t.id, title: t.title }));
}

// ---------------------------------------------------------------------------
// A message's files in the feed (Derek, 2026-10-14: "Also can't see images",
// James's "Trinity Branding Update" showed its pictures as name chips). A
// picture shows as itself and opens in the full size viewer; any other file is
// a chip that opens or downloads. A file is read from where it is kept: the
// app's private storage by a signed link, Gmail through /api/inbox/attachment
// (the Inbox and the task page read them the same way), or its own address.

/** Where one of a message's files is read from; null when it can't be. */
export type FeedFileSource =
  | { from: "storage"; path: string }
  | { from: "gmail"; href: string }
  | { from: "link"; url: string }
  | null;

/** The address /api/inbox/attachment serves one email file at. */
export const gmailFileHref = (messageId: string, attId: string, download = false) =>
  `/api/inbox/attachment?message=${encodeURIComponent(messageId)}&att=${encodeURIComponent(attId)}${download ? "&download=1" : ""}`;

export function feedFileSource(m: Pick<Message, "id" | "gmailMessageId">, a: Attachment, download = false): FeedFileSource {
  if (a.path) return { from: "storage", path: a.path };
  if (a.gmailAttachmentId && m.gmailMessageId) return { from: "gmail", href: gmailFileHref(m.id, a.id, download) };
  if (a.url) return { from: "link", url: a.url };
  return null;
}

/** The key a file's viewable address is kept under: its storage path, else its id. */
export const feedFileKey = (a: Pick<Attachment, "id" | "path">) => a.path ?? a.id;

/** A message's files as the feed shows them: the pictures that can be read
 *  (shown as themselves) and every other file (chips), with an email
 *  signature's little logo left out. */
export function feedFiles(m: Pick<Message, "id" | "gmailMessageId" | "attachments">): { pictures: Attachment[]; files: Attachment[] } {
  const all = (m.attachments ?? []).filter((a) => !isSignatureImage(a));
  const pictures = all.filter((a) => isPicture(a) && !!feedFileSource(m, a));
  return { pictures, files: all.filter((a) => !pictures.includes(a)) };
}

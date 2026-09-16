// Everything written but not sent, in one place.
//
// An email in progress lives in one of three places and none of them is a list
// you can look at: a draft on a task (tasks.draft_email), a draft on a client
// (client_email_drafts, one per client, so starting a second one overwrites the
// first), and a message queued to go later (scheduled_messages). A draft you
// abandoned halfway is invisible until you happen to reopen the exact task or
// client it was written on, which is how a half written reply to a client sits
// for a week and how a reminder the AI drafted for you is never read at all.
//
// Pure: rows in, ordered groups out. No React, no database, no DOM beyond the
// shared htmlToText, so the ordering and the previews can be tested on their own.
import { htmlToText, type EmailDraft, type ScheduledMessage } from "./data";
import { daysSince } from "./elapsed";

export type PendingKind = "task_draft" | "client_draft" | "scheduled";

/** A draft sitting on a task, from the tasks already in memory. */
export type TaskDraftInput = { taskId: string; clientId: string; draft: EmailDraft };
/** The one draft a client can have outside any task. */
export type ClientDraftInput = { clientId: string; draft: EmailDraft; updatedAt: string };
/** A message queued to send later. */
export type ScheduledInput = Pick<ScheduledMessage, "id" | "clientId" | "taskId" | "channel" | "subject" | "body" | "scheduledAt">;

export type PendingSend = {
  id: string;
  kind: PendingKind;
  clientId: string;
  /** The task it belongs to, or null when it belongs to the client itself. */
  taskId: string | null;
  channel: "email" | "sms";
  subject: string;
  /** The first line or so of the body, as plain text. */
  preview: string;
  /** When it was last written, or when it is due to go. */
  at: string;
  /** Whole days since then, for a draft's "how long has this sat" reading. A
   *  scheduled send shows its actual date and time instead, since the question
   *  there is when it goes, not how old it is. */
  days: number | null;
  /** Due to have gone already and still sitting here. */
  overdue: boolean;
};

export type PendingSendGroups = {
  /** Queued to send on their own, soonest first. */
  scheduled: PendingSend[];
  /** Written and waiting for a person, longest untouched first. */
  drafts: PendingSend[];
};

/** How much of the body a row shows. Long enough to recognise which email this
 *  is, short enough that a row stays one line. */
const PREVIEW_CHARS = 140;

/** The first line or so of a body, as plain text. */
export function bodyPreview(body: string): string {
  const text = htmlToText(body).replace(/\s+/g, " ").trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;
}

/** What to call an email with no subject line. */
export const NO_SUBJECT = "No subject";
const subjectOf = (s: string | null | undefined) => (s ?? "").trim() || NO_SUBJECT;

/** When a draft was last touched. updatedAt is optional on older drafts. */
const draftAt = (d: EmailDraft) => d.updatedAt || d.createdAt;

/**
 * The board. What goes out by itself is separated from what needs a person,
 * because they call for opposite things: one you leave alone, the other you
 * finish or throw away.
 *
 * Scheduled reads soonest first, so anything already overdue is at the top.
 * Drafts read OLDEST first, the same reasoning as the Reviews board: the one
 * written nine days ago and forgotten is the one worth seeing, and a list that
 * buries it under this morning's draft is the situation this replaces.
 */
export function buildPendingSends(
  taskDrafts: TaskDraftInput[],
  clientDrafts: ClientDraftInput[],
  scheduled: ScheduledInput[],
  now: number = Date.now(),
): PendingSendGroups {
  const fromTask = taskDrafts.map((t): PendingSend => ({
    id: `task:${t.taskId}`,
    kind: "task_draft",
    clientId: t.clientId,
    taskId: t.taskId,
    channel: "email",
    subject: subjectOf(t.draft.subject),
    preview: bodyPreview(t.draft.body),
    at: draftAt(t.draft),
    days: daysSince(draftAt(t.draft), now),
    overdue: false,
  }));

  const fromClient = clientDrafts.map((c): PendingSend => ({
    id: `client:${c.clientId}`,
    kind: "client_draft",
    clientId: c.clientId,
    taskId: null,
    channel: "email",
    subject: subjectOf(c.draft.subject),
    preview: bodyPreview(c.draft.body),
    at: draftAt(c.draft) || c.updatedAt,
    days: daysSince(draftAt(c.draft) || c.updatedAt, now),
    overdue: false,
  }));

  const queued = scheduled.map((s): PendingSend => ({
    id: `scheduled:${s.id}`,
    kind: "scheduled",
    clientId: s.clientId,
    taskId: s.taskId,
    channel: s.channel === "sms" ? "sms" : "email",
    // A text message has no subject line, so its own body is its heading and
    // the preview underneath would print it a second time.
    subject: s.channel === "sms" ? bodyPreview(s.body) : subjectOf(s.subject),
    preview: s.channel === "sms" ? "" : bodyPreview(s.body),
    at: s.scheduledAt,
    days: daysSince(s.scheduledAt, now),
    overdue: new Date(s.scheduledAt).getTime() < now,
  }));

  const oldestFirst = (a: PendingSend, b: PendingSend) => a.at.localeCompare(b.at);
  return {
    scheduled: queued.sort(oldestFirst),
    drafts: [...fromTask, ...fromClient].sort(oldestFirst),
  };
}

/** How many are waiting in total, for the tab's own count. */
export const pendingSendCount = (g: PendingSendGroups): number => g.scheduled.length + g.drafts.length;

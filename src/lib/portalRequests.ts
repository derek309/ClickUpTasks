// The client portal's side of "what we need from you, one thing at a time"
// (Derek and Justin, 2026-10-15, client-reminders-mockup.html section 4).
// The portal lines up the client's requests in the same order as our side
// (lib/clientRequests orderRequests: Overdue, Today, This week, Later, then
// our dragged order and the need by date). Every link to one opens its task
// page, /waiting/<token>?task=<id> (Derek, 2026-10-16: the one request card
// left Carol with "Reply to: …" and our email folded shut), with what we need
// at the top and "1 of 2 · Next ›" to the next one.
//
// Pure and safe in the browser, so the order, the words and the next one can
// be tested; the portal page (app/waiting) renders them.

import { formatDayDate, formatDue, toPacificDate, type Subtask } from "./data";
import { GROUP_LABEL, daysLate, orderRequests, requestFromTask, requestGroup, type RequestGroup } from "./clientRequests";
import { stepAskWords } from "./stepReminders";

/** What the client is asked to do: look something over, send files, or answer. */
export type PortalRequestKind = "review" | "upload" | "question";

/** One request as the portal holds it. `key` is the step's id, or the task's
 *  own id for a task waiting on them with no client step. */
export type PortalRequest = {
  key: string;
  taskId: string;
  stepId: string | null;
  ask: string;
  listId: string | null;
  needBy: string | null;
  /** When it became their turn (ISO), for "First asked Oct 15". */
  startedAt: string | null;
  clientOrder: number | null;
  taskTitle: string;
  /** The task's due date: its "expected" line. */
  taskDue: string | null;
  kind: PortalRequestKind;
  /** A wait on their reply to an email of ours: that email, to show under
   *  the ask (its subject and first lines). */
  replyTo?: { subject: string; preview: string } | null;
  /** A wait on their reply: the id of the email it waits on, so the task
   *  page can bring that email into view. Null for any other ask. */
  replyToId?: string | null;
};

/** An email of ours a request can wait on, as the portal shows it. */
export type PortalEmail = { subject: string; preview: string };

/** Asks about files: "Send us your logo", "Upload the photos". */
const FILES = /\b(upload|photos?|pictures?|images?|logos?|headshots?|files?|videos?|pdfs?|attach(ment)?s?|scans?|screenshots?)\b/i;

/** A request with a review waiting on them is a review; one about files is an
 *  upload; anything else is a question to answer. */
export function requestKind(o: { reviewOpen: boolean; ask: string }): PortalRequestKind {
  if (o.reviewOpen) return "review";
  return FILES.test(o.ask) ? "upload" : "question";
}

/** A task's request, as the portal shows it: its current client step (the
 *  ask worded as the reminder email words it), or, for a task flagged as
 *  waiting on them with no client step, the task itself. Null when nothing
 *  on it waits on them. */
export function portalRequestFromTask(
  t: { id: string; title: string; clientId: string; projectId: string | null; due: string | null; status: string; waitingOnClient: boolean; subtasks: Subtask[] | null },
  o: { firstName: string; reviewOpen: boolean;
    /** Our emails a reply wait can wait on, by message id (the route reads them). */
    emails?: Record<string, PortalEmail> },
): PortalRequest | null {
  if (t.status === "done" || t.status === "on_hold") return null;
  const r = requestFromTask({ id: t.id, title: t.title, clientId: t.clientId, projectId: t.projectId, due: t.due, subtasks: t.subtasks });
  if (r) {
    // The step's ask, never the task's name (lib/stepReminders stepAskWords).
    const email = r.replyTo?.messageId ? o.emails?.[r.replyTo.messageId] ?? null : null;
    const words = stepAskWords({ title: r.title, notes: r.notes, finishWhen: r.finishWhen, addedFor: r.addedFor }, o.firstName, t.title, { replyTo: email?.subject ?? r.replyTo?.stepTitle ?? null });
    const reply = words.title.startsWith("Reply to: ");
    return {
      key: r.stepId, taskId: t.id, stepId: r.stepId, ask: words.title, listId: t.projectId, needBy: r.needBy, startedAt: r.startedAt, clientOrder: r.clientOrder,
      taskTitle: t.title, taskDue: t.due,
      kind: reply && !o.reviewOpen ? "question" : requestKind({ reviewOpen: o.reviewOpen, ask: `${r.title} ${words.ask}` }),
      replyTo: reply && email ? email : null,
      replyToId: reply ? r.replyTo?.messageId ?? null : null,
    };
  }
  if (!t.waitingOnClient) return null;
  return {
    key: t.id, taskId: t.id, stepId: null, ask: `Your answer on ${t.title.trim()}`, listId: t.projectId, needBy: t.due, startedAt: null, clientOrder: null,
    taskTitle: t.title, taskDue: null, kind: requestKind({ reviewOpen: o.reviewOpen, ask: t.title }),
  };
}

/** Our email, as the portal shows it under a reply wait: its subject, and
 *  its first lines as plain text (`text`: the email already made text). */
export function portalEmail(subject: string | null, text: string): PortalEmail | null {
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const s = (subject ?? "").trim().replace(/^((re|fwd?):\s*)+/i, "");
  if (!s) return null;
  // Past "Hi Carol,", the first few lines, about two sentences long. An email
  // made one line keeps what follows the greeting (Carol's read empty).
  const body = lines.join(" ").replace(/^(hi|hello|hey|dear)\b[^,!\n]{0,40}[,!]\s*/i, "").trim();
  const preview = body.length > 220 ? `${body.slice(0, 219).replace(/\s+\S*$/, "")}…` : body;
  return { subject: s, preview };
}

/** The queue, in our order (lib/clientRequests). */
export function portalQueue<T extends Pick<PortalRequest, "needBy" | "clientOrder" | "startedAt" | "key">>(list: T[], today: string): T[] {
  const wrapped = list.map((r) => ({ needBy: r.needBy, clientOrder: r.clientOrder, startedAt: r.startedAt, stepId: r.key, r }));
  return orderRequests(wrapped, today).map((x) => x.r);
}

/** The queue in its groups, empty groups left out, each in queue order. */
export function groupedQueue<T extends Pick<PortalRequest, "needBy">>(ordered: T[], today: string): { group: RequestGroup; label: string; items: T[] }[] {
  const out: { group: RequestGroup; label: string; items: T[] }[] = [];
  for (const r of ordered) {
    const group = requestGroup(r.needBy, today);
    const last = out[out.length - 1];
    if (last?.group === group) last.items.push(r);
    else out.push({ group, label: GROUP_LABEL[group], items: [r] });
  }
  return out;
}

/** "1 of 6": where a request is in the queue. Ones answered on this visit
 *  count as passed, so the second one after an answer reads "2 of 6". */
export function queuePosition(ordered: Pick<PortalRequest, "key">[], key: string, answered = 0): { n: number; of: number } | null {
  const at = ordered.findIndex((r) => r.key === key);
  if (at < 0) return null;
  return { n: answered + at + 1, of: answered + ordered.length };
}

/** The requests after the one on this task, in queue order, wrapping round to
 *  the top, never this task's own: "Next ›" on a task page is the first of
 *  them, and "See all" counts them. A task with nothing for them starts at the
 *  top of the queue. */
export function othersInOrder<T extends Pick<PortalRequest, "taskId">>(ordered: T[], taskId: string): T[] {
  const at = ordered.findIndex((r) => r.taskId === taskId);
  const rest = at < 0 ? ordered : [...ordered.slice(at + 1), ...ordered.slice(0, at)];
  return rest.filter((r) => r.taskId !== taskId);
}

/** The state word over a request: "1 day late" (red), "Due today" (amber),
 *  "Need by Fri, Oct 17", or nothing without a date. */
export function stateWord(needBy: string | null, today: string): { text: string; tone: "late" | "today" | "plain" } | null {
  if (!needBy) return null;
  if (needBy < today) {
    const n = Math.max(1, daysLate(needBy, today));
    return { text: `${n} ${n === 1 ? "day" : "days"} late`, tone: "late" };
  }
  if (needBy === today) return { text: "Due today", tone: "today" };
  return { text: `Need by ${formatDayDate(needBy)}`, tone: "plain" };
}

/** A row's date in the full list: "2 days late", "Today", "Fri, Oct 17". */
export function rowDate(needBy: string | null, today: string): { text: string; tone: "late" | "today" | "plain" } | null {
  const w = stateWord(needBy, today);
  if (!w) return null;
  return w.tone === "late" ? w : w.tone === "today" ? { text: "Today", tone: "today" } : { text: formatDayDate(needBy), tone: "plain" };
}

/** What the thanks says once it is answered. */
export const doneWord = (kind: PortalRequestKind | "changes"): string =>
  kind === "review" ? "Approved" : kind === "question" ? "Answered" : "Sent";

/** "First asked Oct 15", from when it became their turn. */
export const firstAskedLine = (startedAt: string | null): string | null => (startedAt ? `First asked ${formatDue(toPacificDate(startedAt))}` : null);

/** The thanks once one is answered: "✓ Approved. Thanks, Brian." */
export const thanksLine = (word: string, firstName: string | null): string => `✓ ${word}. Thanks${firstName?.trim() ? `, ${firstName.trim()}` : ""}.`;

/** The task page a request opens: every link to one, in the reminder emails
 *  and the portal's own list, is this (Derek, 2026-10-16). No &step=: the
 *  task page shows whatever we need on it now. */
export const portalTaskUrl = (portal: string, taskId: string): string => `${portal}?task=${encodeURIComponent(taskId)}`;

/** What a portal address opens: the task page for ?task=<id>. Emails sent
 *  before 2026-10-16 add &step=<id>; it no longer picks a view, it only says
 *  whether that request was answered since (`answered`: a thanks line over the
 *  task page). */
export function portalLinkOpens(search: string, queue: Pick<PortalRequest, "taskId" | "stepId">[]): { taskId: string | null; answered: boolean } {
  const q = new URLSearchParams(search);
  const taskId = q.get("task")?.trim() || null;
  const stepId = q.get("step")?.trim() || null;
  if (!taskId) return { taskId: null, answered: false };
  const open = queue.some((r) => r.taskId === taskId && (!stepId || !r.stepId || r.stepId === stepId));
  return { taskId, answered: !!stepId && !open };
}

/** What we need, as the top of the task page says it: a wait on their reply
 *  to an email of ours names that email ("We need your reply to our email
 *  "Your website changes are done""), and the task page brings the email into
 *  view; any other ask is the step's own words (lib/stepReminders
 *  stepAskWords: its title, or its directions' first line). */
export function whatWeNeed(r: Pick<PortalRequest, "ask" | "replyTo" | "replyToId">): { line: string; reply: boolean; emailId: string | null } {
  const subject = r.replyTo?.subject?.trim() || (r.ask.startsWith("Reply to: ") ? r.ask.slice("Reply to: ".length).trim() : "");
  if (subject && (r.replyTo || r.ask.startsWith("Reply to: "))) return { line: `We need your reply to our email "${subject}"`, reply: true, emailId: r.replyToId ?? null };
  return { line: r.ask, reply: false, emailId: null };
}

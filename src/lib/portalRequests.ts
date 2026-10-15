// The client portal's side of "what we need from you, one thing at a time"
// (Derek and Justin, 2026-10-15, client-reminders-mockup.html section 4).
// The portal lines up the client's requests in the same order as our side
// (lib/clientRequests orderRequests: Overdue, Today, This week, Later, then
// our dragged order and the need by date), opens one of them on its own when
// a reminder's link carries ?task=, and moves to the next once it is answered.
//
// Pure and safe in the browser, so the order, the words and the next one can
// be tested; the portal page (app/waiting) renders them.

import { formatDayDate, formatDue, toPacificDate, type Subtask } from "./data";
import { GROUP_LABEL, daysLate, orderRequests, requestFromTask, requestGroup, type RequestGroup } from "./clientRequests";
import { stepAsk } from "./stepReminders";

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
};

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
  o: { firstName: string; reviewOpen: boolean },
): PortalRequest | null {
  if (t.status === "done" || t.status === "on_hold") return null;
  const r = requestFromTask({ id: t.id, title: t.title, clientId: t.clientId, projectId: t.projectId, due: t.due, subtasks: t.subtasks });
  if (r) {
    const said = stepAsk({ title: r.title, notes: r.notes }, o.firstName, t.title).trim() || r.title.trim();
    const ask = said.charAt(0).toUpperCase() + said.slice(1);
    return {
      key: r.stepId, taskId: t.id, stepId: r.stepId, ask, listId: t.projectId, needBy: r.needBy, startedAt: r.startedAt, clientOrder: r.clientOrder,
      taskTitle: t.title, taskDue: t.due, kind: requestKind({ reviewOpen: o.reviewOpen, ask: `${r.title} ${said}` }),
    };
  }
  if (!t.waitingOnClient) return null;
  return {
    key: t.id, taskId: t.id, stepId: null, ask: t.title, listId: t.projectId, needBy: t.due, startedAt: null, clientOrder: null,
    taskTitle: t.title, taskDue: null, kind: requestKind({ reviewOpen: o.reviewOpen, ask: t.title }),
  };
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

/** The next one to show after `key`: the first in the queue that is not it
 *  (nor one already answered on this visit). */
export function nextRequest<T extends Pick<PortalRequest, "key">>(ordered: T[], key: string | null, answeredKeys: string[] = []): T | null {
  return ordered.find((r) => r.key !== key && !answeredKeys.includes(r.key)) ?? null;
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

/** "Your newsletter is expected Oct 27.", for a task with a due date that
 *  waits on them. Kept to the date; nothing promised beyond it. */
export function expectedLine(taskTitle: string, taskDue: string | null): string | null {
  const title = taskTitle.trim().replace(/[.!?]+$/, "");
  if (!taskDue || !title) return null;
  // One plain word reads as "your newsletter"; a longer name stays as typed
  // ("November classes", "PPAI flyer"), so a name or a month keeps its capital.
  const named = /^[A-Za-z][a-z]+$/.test(title) ? `Your ${title.toLowerCase()}` : title.charAt(0).toUpperCase() + title.slice(1);
  return `${named} is expected ${formatDue(taskDue)}.`;
}

/** "First asked Oct 15", from when it became their turn. */
export const firstAskedLine = (startedAt: string | null): string | null => (startedAt ? `First asked ${formatDue(toPacificDate(startedAt))}` : null);

/** The thanks once one is answered: "✓ Approved. Thanks, Brian." */
export const thanksLine = (word: string, firstName: string | null): string => `✓ ${word}. Thanks${firstName?.trim() ? `, ${firstName.trim()}` : ""}.`;

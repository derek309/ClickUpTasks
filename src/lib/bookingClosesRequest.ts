// A client booking a meeting answers the request it was for (Derek,
// 2026-10-15: "if they do that it removes the reminder and updates the step,
// right? booking might come in any place"). Jack Flynn booked through the
// booking link instead of replying, and his "Check in if Jack hasn't replied"
// wait, and the reminder for it, stayed open.
//
// Pure, so the matching can be tested; lib/bookingServer runs it wherever a
// booking shows up (the hourly appointment sync, the GoHighLevel webhook, a
// booking made in the app or over the MCP).

import { currentStep, planSteps, type Subtask } from "./data";
import { isClientWait } from "./afterThis";

/** One appointment as it came in. createdAt is when it was booked, when
 *  GoHighLevel says (null when it doesn't). */
export type Booking = { start: string; createdAt: string | null; status?: string | null; deleted?: boolean };

/** Words that make a wait about meeting: book, meeting, call, time to meet,
 *  appointment, schedule. "Call" and "schedule" only as a meeting reads
 *  ("a quick call", "schedule a time"), so "Approve the posting schedule"
 *  is not one; "book" only as booking a time, so "Proof the book" is not. */
const MEETING = new RegExp([
  String.raw`\bmeet(s|ing|ings)?\b`,
  String.raw`\btime to meet\b`,
  String.raw`\bappointments?\b`,
  String.raw`\bzoom\b`,
  String.raw`\bbooking\b`,
  String.raw`\bbooked\b`,
  String.raw`\bbook (a|an|the|some|your|our|in|time)\b`,
  String.raw`\bcalendar link\b`,
  String.raw`\b(a|the|quick|phone|video|zoom|intro|discovery|strategy|kickoff|kick off|catch up|follow up)\s+call\b`,
  String.raw`\bcall with\b`,
  String.raw`\bschedul(e|ed|ing) (a|an|the|some|our|your)\s+(time|call|meeting|chat|zoom)\b`,
].join("|"), "i");

const plain = (html: string | undefined | null) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/** Whether these words are about meeting. */
export const mentionsMeeting = (text: string | null | undefined): boolean => MEETING.test(plain(text));

/** The step a wait follows: the one its check in was added for, else the
 *  plan step right before it. */
export function stepBefore(subtasks: Subtask[], wait: Pick<Subtask, "id" | "addedFor">): Subtask | null {
  const from = wait.addedFor?.startsWith("checkin:") ? wait.addedFor.slice("checkin:".length) : null;
  if (from) { const s = subtasks.find((x) => x.id === from); if (s) return s; }
  const plan = planSteps(subtasks);
  const at = plan.findIndex((x) => x.id === wait.id);
  return at > 0 ? plan[at - 1] : null;
}

/** The message ids of the emails a step holds ("mail:<id>"). */
export const heldMailIds = (s: Pick<Subtask, "holds"> | null | undefined): string[] =>
  (s?.holds ?? []).filter((h) => h.startsWith("mail:")).map((h) => h.slice(5)).filter(Boolean);

/** The task's current step when it is the client's turn and about meeting:
 *  the wait follows a meeting request (its step or the email it sent), or
 *  the wait's own name or directions, or the task's name, talk of booking a
 *  time. `subjects` are the subjects of emails steps hold, by message id. */
export function meetingWaitOf(task: { title: string; subtasks: Subtask[] | null }, subjects: Map<string, string> = new Map()): Subtask | null {
  const list = task.subtasks ?? [];
  const wait = currentStep(list);
  if (!wait || wait.done || !isClientWait(wait)) return null;
  const before = stepBefore(list, wait);
  const texts = [
    wait.title, wait.notes, before?.title, before?.notes, task.title,
    ...[...heldMailIds(wait), ...heldMailIds(before)].map((id) => subjects.get(id) ?? ""),
  ];
  return texts.some(mentionsMeeting) ? wait : null;
}

/** An appointment that is really on: not deleted, cancelled or invalid. */
export function isLiveBooking(b: Booking): boolean {
  if (!b || b.deleted || !b.start || !Number.isFinite(Date.parse(b.start))) return false;
  const status = String(b.status ?? "").toLowerCase();
  return status !== "cancelled" && status !== "canceled" && status !== "invalid";
}

/** When we asked: the wait's start, or the step before it finishing
 *  (whichever is earlier). Null when neither is known. */
export function askedAt(subtasks: Subtask[], wait: Subtask): string | null {
  const before = stepBefore(subtasks, wait);
  const times = [wait.startedAt, before?.done ? before.doneAt : undefined].filter((x): x is string => !!x && Number.isFinite(Date.parse(x)));
  if (!times.length) return null;
  return times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

/** The booking that answers the wait: live, and booked once we had asked
 *  (one that was already there before is not an answer). When GoHighLevel
 *  doesn't say when it was booked, a meeting set for after we asked counts.
 *  The soonest such meeting, or null. */
export function bookingAnswering(subtasks: Subtask[], wait: Subtask, bookings: Booking[]): Booking | null {
  const asked = askedAt(subtasks, wait);
  const askedMs = asked ? Date.parse(asked) : null;
  const ok = bookings.filter(isLiveBooking).filter((b) => {
    if (askedMs === null) return true;
    const made = b.createdAt && Number.isFinite(Date.parse(b.createdAt)) ? Date.parse(b.createdAt) : Date.parse(b.start);
    return made >= askedMs;
  });
  return ok.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null;
}

/** "Tue, Oct 21, 10:00 AM", in California time. */
export function bookedWhen(startIso: string, timeZone = "America/Los_Angeles"): string {
  const d = new Date(startIso);
  if (!Number.isFinite(d.getTime())) return startIso;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.month} ${p.day}, ${p.hour}:${p.minute} ${String(p.dayPeriod ?? "").toUpperCase()}`.trim();
}

/** The step's outcome: "Jack booked Tue, Oct 21, 10:00 AM". */
export const bookedOutcome = (first: string, startIso: string): string => `${first} booked ${bookedWhen(startIso)}`;

/** Their booking finishes the wait: done by the client, with the booking as
 *  its outcome; the plan's next step starts, or "<first> booked: what's
 *  next?" when there is none (as their reply does, stepsServer
 *  stepsOnClientReply). Null when that step is no longer the client's
 *  current wait, so a second run changes nothing. */
export function finishBookedWait(subtasks: Subtask[], stepId: string, o: { first: string; start: string; now: string; makeId: () => string }): Subtask[] | null {
  const wait = currentStep(subtasks);
  if (!wait || wait.id !== stepId || wait.done || !isClientWait(wait)) return null;
  const done = subtasks.map((x) => (x.id === stepId ? { ...x, done: true, doneAt: o.now, outcome: bookedOutcome(o.first, o.start), doneBy: "client" } : x));
  const next = planSteps(done).find((x) => !x.done);
  if (next) return next.startedAt ? done : done.map((x) => (x.id === next.id ? { ...x, startedAt: o.now } : x));
  if (done.some((x) => x.addedFor === `next:${stepId}`)) return done;
  const at = done.findIndex((x) => x.id === stepId);
  const out = [...done];
  out.splice(at + 1, 0, { id: o.makeId(), title: `${o.first} booked: what's next?`, done: false, addedFor: `next:${stepId}`, startedAt: o.now });
  return out;
}

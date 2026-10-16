// Meeting on a step (Derek, 2026-10-16): picking Meeting asks one thing
// first, now or a booked time, when the client can be booked (a GoHighLevel
// contact with a calendar). When they can't, it goes straight to Meet now, as
// before. The pure parts: the decision, and the steps a booked time makes.
import { asksWhatsNext, currentStep, toPacificDate, type Subtask } from "./data";
import { isEmptyStep } from "./meetNow";

export type MeetingChoiceKey = "now" | "book";
export type MeetingChoice = { key: MeetingChoiceKey; label: string };

/** The two rows, in this order and no others. */
export const MEETING_CHOICES: readonly MeetingChoice[] = [
  { key: "now", label: "Meet now, send them the link" },
  { key: "book", label: "Book a time" },
];

/** What picking Meeting does: ask now or book, or go straight to Meet now
 *  when there is no booking for this client. */
export function meetingStart(o: { canBook: boolean }): { kind: "now" } | { kind: "choose"; choices: readonly MeetingChoice[] } {
  return o.canBook ? { kind: "choose", choices: MEETING_CHOICES } : { kind: "now" };
}

/** The day a booked time falls on, in Los Angeles, as the appointment sync
 *  dates the meeting's steps (calendarService bumpTask). */
export const bookedDay = (startIso: string) => toPacificDate(startIso);

/** A time booked from a step: "Meet with <first>" on the meeting's day, then
 *  "Add the meeting transcript" for Granola to fill, the pair a booked
 *  meeting has (data.withMeetingSteps), so the appointment sync later finds
 *  them and adds no second pair.
 *
 *  Where they go: the step it was picked on becomes the meeting when it is
 *  still empty or asks what's next (as Meet now does); a step with work on it
 *  keeps it and the meeting goes right after it. Picked from + Add step (no
 *  step): the current "what's next?" step becomes it, else they go last.
 *  A pair the sync already made for that day is replaced, never doubled. */
export function withBookedSteps(subtasks: Subtask[], o: { first: string; due: string; fromStepId?: string | null },
  makeId: () => string, now = new Date().toISOString()): Subtask[] {
  const dup = (x: Subtask) => !x.done && !x.meetNow && x.due === o.due && (x.addedFor === "meeting" || x.addedFor === "transcript");
  const from = o.fromStepId ? subtasks.find((x) => x.id === o.fromStepId && !x.done && !x.fromClient) ?? null : null;
  const cur = currentStep(subtasks);
  const reuse = from ? (isEmptyStep(from) || asksWhatsNext(from) ? from : null) : cur && asksWhatsNext(cur) ? cur : null;
  const rest = subtasks.filter((x) => x.id === reuse?.id || x.id === from?.id || !dup(x));
  const hasCurrent = rest.some((x) => !x.done && x.startedAt && x.id !== reuse?.id);
  const meetFields = { title: `Meet with ${o.first}`, due: o.due, addedFor: "meeting" };
  const meet: Subtask = reuse
    ? { ...reuse, ...meetFields, finishWhen: undefined, namedFrom: undefined }
    : { id: makeId(), done: false, ...meetFields, ...(hasCurrent ? {} : { startedAt: now }) };
  const transcript: Subtask = { id: makeId(), title: "Add the meeting transcript", done: false, due: o.due, addedFor: "transcript", finishWhen: "transcript" };
  if (reuse) {
    const at = rest.findIndex((x) => x.id === reuse.id);
    return [...rest.slice(0, at), meet, transcript, ...rest.slice(at + 1)];
  }
  const after = from ? rest.findIndex((x) => x.id === from.id) : -1;
  const at = after >= 0 ? after + 1 : rest.length;
  return [...rest.slice(0, at), meet, transcript, ...rest.slice(at)];
}

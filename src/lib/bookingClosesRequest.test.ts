import { describe, expect, it } from "vitest";
import { askedAt, bookedOutcome, bookedWhen, bookingAnswering, finishBookedWait, isLiveBooking, meetingWaitOf, mentionsMeeting, stepBefore, type Booking } from "./bookingClosesRequest";
import type { Subtask } from "./data";

// Jack Flynn's real task, t_mv5op68qe "Book a Meeting", as it stood before
// Derek closed it by hand (2026-10-15): the email went Oct 12, then a client
// wait "Check in if Jack hasn't replied", need by Oct 19, reminders on.
const jackSteps = (): Subtask[] => [
  { id: "s_mv5ophbxg", title: "Email Request", done: true, holds: ["mail:msg_mv5p7ok5m"], doneAt: "2026-10-12T20:22:20.618Z", outcome: "Email sent to Jack", madeHere: ["email"], assigneeId: "u_derek" } as Subtask,
  { id: "s_mv5p7nbeh", title: "Check in if Jack hasn't replied", done: false, due: "2026-10-19", stage: "waiting", addedFor: "checkin:s_mv5ophbxg", startedAt: "2026-10-12T20:22:20.618Z", assigneeId: "u_derek", finishWhen: "reply" } as Subtask,
];
const jack = () => ({ title: "Book a Meeting", subtasks: jackSteps() });
const booked = (start: string, createdAt: string | null, more: Partial<Booking> = {}): Booking => ({ start, createdAt, ...more });
let n = 0;
const makeId = () => `s_new${++n}`;

describe("what is a wait about meeting", () => {
  it("reads booking a time, not every use of the words", () => {
    for (const t of ["Book a Meeting", "Request a meeting with Jack", "Time to meet about the site?", "Book a time", "Set up a quick call", "Schedule a call with Brian", "Zoom", "Appointment for the shoot", "Booked?", "Book zoom Meeting this week"]) expect(mentionsMeeting(t), t).toBe(true);
    for (const t of ["Approve the posting schedule", "Proof the book", "Send the VA handbooks", "Facebook ads", "Check in if Jack hasn't replied", "Call to action copy", "Email Request"]) expect(mentionsMeeting(t), t).toBe(false);
  });

  it("finds Jack's check in by the task's name", () => {
    expect(meetingWaitOf(jack())?.id).toBe("s_mv5p7nbeh");
  });

  it("finds it by the email the wait follows, when nothing else says so", () => {
    const t = { title: "Website", subtasks: jackSteps() };
    expect(meetingWaitOf(t)).toBeNull();
    expect(meetingWaitOf(t, new Map([["msg_mv5p7ok5m", "Time to meet about Website?"]]))?.id).toBe("s_mv5p7nbeh");
  });

  it("finds it after a Request a meeting step, the wait's own name, or its directions", () => {
    const steps = jackSteps().map((s) => (s.id === "s_mv5ophbxg" ? { ...s, title: "Request a meeting with Jack" } : s));
    expect(meetingWaitOf({ title: "Website", subtasks: steps })?.id).toBe("s_mv5p7nbeh");
    const own = jackSteps().map((s) => (s.id === "s_mv5p7nbeh" ? { ...s, title: "Wait for Jack to book a time" } : s));
    expect(meetingWaitOf({ title: "Website", subtasks: own })?.id).toBe("s_mv5p7nbeh");
    const notes = jackSteps().map((s) => (s.id === "s_mv5p7nbeh" ? { ...s, notes: "<p>He said he'd grab <b>time to meet</b> next week.</p>" } : s));
    expect(meetingWaitOf({ title: "Website", subtasks: notes })?.id).toBe("s_mv5p7nbeh");
  });

  it("is only the current step, and only while it is the client's turn", () => {
    // Done already (Derek ticked it).
    const done = jackSteps().map((s) => (s.id === "s_mv5p7nbeh" ? { ...s, done: true } : s));
    expect(meetingWaitOf({ title: "Book a Meeting", subtasks: done })).toBeNull();
    // Our own step is current.
    const ours = [{ id: "s_a", title: "Request a meeting with Jack", done: false } as Subtask, ...jackSteps().slice(1)];
    expect(meetingWaitOf({ title: "Book a Meeting", subtasks: ours })).toBeNull();
    // A client wait later in the plan, not current.
    expect(meetingWaitOf({ title: "Book a Meeting", subtasks: null })).toBeNull();
  });

  it("follows the check in's own step, else the one before", () => {
    const steps = jackSteps();
    expect(stepBefore(steps, steps[1])?.id).toBe("s_mv5ophbxg");
    const noKey = { ...steps[1], addedFor: undefined };
    expect(stepBefore([steps[0], noKey], noKey)?.id).toBe("s_mv5ophbxg");
  });
});

describe("which booking answers it", () => {
  const steps = jackSteps();
  const wait = steps[1];

  it("asked when the email went", () => {
    expect(askedAt(steps, wait)).toBe("2026-10-12T20:22:20.618Z");
  });

  it("a booking made after we asked does; one already there before does not", () => {
    expect(bookingAnswering(steps, wait, [booked("2026-10-21T17:00:00.000Z", "2026-10-15T18:50:00.000Z")])?.start).toBe("2026-10-21T17:00:00.000Z");
    expect(bookingAnswering(steps, wait, [booked("2026-10-21T17:00:00.000Z", "2026-10-10T18:50:00.000Z")])).toBeNull();
  });

  it("never a cancelled or deleted one", () => {
    expect(isLiveBooking(booked("2026-10-21T17:00:00.000Z", null, { status: "cancelled" }))).toBe(false);
    expect(isLiveBooking(booked("2026-10-21T17:00:00.000Z", null, { deleted: true }))).toBe(false);
    expect(isLiveBooking(booked("not a date", null))).toBe(false);
    expect(bookingAnswering(steps, wait, [booked("2026-10-21T17:00:00.000Z", "2026-10-15T18:50:00.000Z", { status: "cancelled" })])).toBeNull();
  });

  it("without when it was booked, a meeting set after we asked counts; the soonest wins", () => {
    expect(bookingAnswering(steps, wait, [booked("2026-10-23T17:00:00.000Z", null), booked("2026-10-21T17:00:00.000Z", null)])?.start).toBe("2026-10-21T17:00:00.000Z");
    expect(bookingAnswering(steps, wait, [booked("2026-10-11T17:00:00.000Z", null)])).toBeNull();
  });
});

describe("finishing the wait", () => {
  it("says when, in California time", () => {
    expect(bookedWhen("2026-10-21T17:00:00.000Z")).toBe("Wed, Oct 21, 10:00 AM");
    expect(bookedOutcome("Jack", "2026-10-21T17:00:00.000Z")).toBe("Jack booked Wed, Oct 21, 10:00 AM");
  });

  it("Jack's: done by him, and with nothing after it, 'Jack booked: what's next?' starts", () => {
    const now = "2026-10-15T19:20:00.000Z";
    const out = finishBookedWait(jackSteps(), "s_mv5p7nbeh", { first: "Jack", start: "2026-10-21T17:00:00.000Z", now, makeId })!;
    const w = out.find((s) => s.id === "s_mv5p7nbeh")!;
    expect(w).toMatchObject({ done: true, doneAt: now, outcome: "Jack booked Wed, Oct 21, 10:00 AM", doneBy: "client" });
    expect(out[2]).toMatchObject({ title: "Jack booked: what's next?", done: false, addedFor: "next:s_mv5p7nbeh", startedAt: now });
    // Run again (the next hourly sync): nothing changes.
    expect(finishBookedWait(out, "s_mv5p7nbeh", { first: "Jack", start: "2026-10-21T17:00:00.000Z", now, makeId })).toBeNull();
  });

  it("the plan's next step starts when there is one", () => {
    const steps = [...jackSteps(), { id: "s_prep", title: "Prep the demo", done: false } as Subtask];
    const out = finishBookedWait(steps, "s_mv5p7nbeh", { first: "Jack", start: "2026-10-21T17:00:00.000Z", now: "2026-10-15T19:20:00.000Z", makeId })!;
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ id: "s_prep", startedAt: "2026-10-15T19:20:00.000Z" });
  });

  it("changes nothing when that step is not the current client wait", () => {
    const steps = [{ id: "s_x", title: "Our step", done: false } as Subtask, ...jackSteps()];
    expect(finishBookedWait(steps, "s_mv5p7nbeh", { first: "Jack", start: "2026-10-21T17:00:00.000Z", now: "x", makeId })).toBeNull();
    expect(finishBookedWait(jackSteps(), "s_gone", { first: "Jack", start: "2026-10-21T17:00:00.000Z", now: "x", makeId })).toBeNull();
  });
});

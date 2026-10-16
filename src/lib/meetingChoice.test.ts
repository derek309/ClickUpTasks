import { describe, expect, it } from "vitest";
import { bookedDay, meetingStart, withBookedSteps, MEETING_CHOICES } from "./meetingChoice";
import { withMeetingSteps, type Subtask } from "./data";

const ids = () => { let n = 0; return () => `n${++n}`; };
const NOW = "2026-10-16T17:00:00.000Z";

describe("picking Meeting on a step", () => {
  it("with booking: asks now or book a time, those two rows only", () => {
    const r = meetingStart({ canBook: true });
    expect(r.kind).toBe("choose");
    if (r.kind !== "choose") return;
    expect(r.choices.map((c) => c.key)).toEqual(["now", "book"]);
    expect(r.choices.map((c) => c.label)).toEqual(["Meet now, send them the link", "Book a time"]);
    expect(r.choices).toBe(MEETING_CHOICES);
  });
  it("no booking for them: straight to Meet now", () => {
    expect(meetingStart({ canBook: false })).toEqual({ kind: "now" });
  });
  it("no dashes in the rows", () => {
    for (const c of MEETING_CHOICES) expect(c.label).not.toMatch(/[-–—]/);
  });
});

describe("a time booked from a step", () => {
  it("is dated by its day in Los Angeles", () => {
    expect(bookedDay("2026-10-21T01:30:00.000Z")).toBe("2026-10-20");
    expect(bookedDay("2026-10-21T17:00:00.000Z")).toBe("2026-10-21");
  });
  it("an empty step becomes the meeting, the transcript step right after", () => {
    const subs: Subtask[] = [
      { id: "a", title: "Done", done: true },
      { id: "b", title: "New step", done: false, startedAt: NOW },
      { id: "c", title: "Later", done: false },
    ];
    const out = withBookedSteps(subs, { first: "Pam", due: "2026-10-21", fromStepId: "b" }, ids(), NOW);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "n1", "c"]);
    expect(out[1]).toMatchObject({ title: "Meet with Pam", due: "2026-10-21", addedFor: "meeting", startedAt: NOW });
    expect(out[1].meetNow).toBeUndefined();
    expect(out[2]).toMatchObject({ title: "Add the meeting transcript", due: "2026-10-21", addedFor: "transcript", finishWhen: "transcript" });
  });
  it("a step asking what's next becomes it", () => {
    const subs: Subtask[] = [{ id: "a", title: "Send it", done: true }, { id: "q", title: "Send it: what's next?", done: false, addedFor: "next:a" }];
    const out = withBookedSteps(subs, { first: "Pam", due: "2026-10-21", fromStepId: "q" }, ids(), NOW);
    expect(out.map((x) => x.id)).toEqual(["a", "q", "n1"]);
    expect(out[1].title).toBe("Meet with Pam");
    expect(out[1].addedFor).toBe("meeting");
  });
  it("a step with work on it keeps it, and the meeting goes right after it", () => {
    const subs: Subtask[] = [{ id: "b", title: "Proposal", done: false, startedAt: NOW, notes: "the plan" }, { id: "c", title: "Later", done: false }];
    const out = withBookedSteps(subs, { first: "Pam", due: "2026-10-21", fromStepId: "b" }, ids(), NOW);
    expect(out.map((x) => x.title)).toEqual(["Proposal", "Meet with Pam", "Add the meeting transcript", "Later"]);
    expect(out[1].startedAt).toBeUndefined();
  });
  it("from + Add step: a new pair at the end", () => {
    const subs: Subtask[] = [{ id: "b", title: "Proposal", done: false, startedAt: NOW, notes: "x" }];
    const out = withBookedSteps(subs, { first: "Pam", due: "2026-10-21" }, ids(), NOW);
    expect(out.map((x) => x.title)).toEqual(["Proposal", "Meet with Pam", "Add the meeting transcript"]);
  });
  it("replaces a pair the appointment sync made for that day, and the sync adds no second one", () => {
    const synced = withMeetingSteps([{ id: "b", title: "New step", done: false, startedAt: NOW }], "Pam", "2026-10-21", ids(), NOW)!;
    expect(synced).toHaveLength(3);
    const out = withBookedSteps(synced, { first: "Pam", due: "2026-10-21", fromStepId: "b" }, () => "z", NOW);
    expect(out.map((x) => x.title)).toEqual(["Meet with Pam", "Add the meeting transcript"]);
    expect(withMeetingSteps(out, "Pam", "2026-10-21", ids(), NOW)).toBeNull();
  });
  it("a Meet now pair is left alone", () => {
    const subs: Subtask[] = [
      { id: "m", title: "Meet with Pam", done: false, due: "2026-10-21", addedFor: "meeting", meetNow: true },
      { id: "b", title: "New step", done: false },
    ];
    const out = withBookedSteps(subs, { first: "Pam", due: "2026-10-21", fromStepId: "b" }, ids(), NOW);
    expect(out.map((x) => x.id)).toEqual(["m", "b", "n1"]);
  });
});

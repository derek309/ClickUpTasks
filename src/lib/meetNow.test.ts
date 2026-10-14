import { describe, expect, it } from "vitest";
import { cleanMeetingLink, liveMeeting, liveMeetingOf, meetNowEmail, meetNowText, meetNowTimes, withMeetNowSteps } from "./meetNow";
import { withMeetingSteps, type Subtask } from "./data";
import { meetNowEventBody } from "./googleCalendar";

const meeting = { url: "https://meet.google.com/abc-defg-hij", start: "2026-10-14T21:05:00.000Z", end: "2026-10-14T21:35:00.000Z", via: "meet" as const };
const ids = () => { let n = 0; return () => `n${++n}`; };
const NOW = "2026-10-14T21:05:30.000Z";
const opts = (fromStepId?: string) => ({ first: "Pam", due: "2026-10-14", attachmentId: "a_1", meeting, fromStepId });

describe("Meet now's message", () => {
  it("says hi with their first name and the link", () => {
    expect(meetNowText("Pam", "https://zoom.us/j/123")).toBe("Hi Pam, here's the link to join me now: https://zoom.us/j/123");
    expect(meetNowText(" ", "https://zoom.us/j/123")).toBe("Hi, here's the link to join me now: https://zoom.us/j/123");
  });
  it("as an email: the words as HTML with the link clickable", () => {
    const e = meetNowEmail("Hi Pam, here's the link to join me now: https://zoom.us/j/123?pwd=a&b=c.\n\nSee you <soon>");
    expect(e.subject).toBe("Join me now");
    expect(e.html).toBe(`<p>Hi Pam, here's the link to join me now: <a href="https://zoom.us/j/123?pwd=a&amp;b=c">https://zoom.us/j/123?pwd=a&amp;b=c</a>.</p><p>See you &lt;soon&gt;</p>`);
  });
});

describe("your meeting link", () => {
  it("keeps a real link and adds https to a bare one", () => {
    expect(cleanMeetingLink(" https://zoom.us/j/1234567890 ")).toBe("https://zoom.us/j/1234567890");
    expect(cleanMeetingLink("meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
  });
  it("refuses what isn't a link", () => {
    expect(cleanMeetingLink("")).toBeNull();
    expect(cleanMeetingLink("my zoom")).toBeNull();
    expect(cleanMeetingLink("javascript:alert(1)")).toBeNull();
  });
});

describe("Meet now's steps", () => {
  it("on a task with no steps: Meet with Pam, current and holding the link, then the transcript", () => {
    const list = withMeetNowSteps([], opts(), ids(), NOW);
    expect(list.map((x) => [x.title, x.due, !!x.startedAt, x.addedFor, x.finishWhen ?? null])).toEqual([
      ["Meet with Pam", "2026-10-14", true, "meeting", null],
      ["Add the meeting transcript", "2026-10-14", false, "transcript", "transcript"],
    ]);
    expect(list[0].holds).toEqual(["att:a_1"]);
    expect(list[0].meeting).toEqual(meeting);
    expect(list.every((x) => x.meetNow)).toBe(true);
  });
  it("goes in front of the current step, after the finished ones", () => {
    const before: Subtask[] = [{ id: "d", title: "Done one", done: true }, { id: "c", title: "Build the page", done: false, startedAt: "x" }, { id: "l", title: "Launch", done: false }];
    expect(withMeetNowSteps(before, opts(), ids(), NOW).map((x) => x.id)).toEqual(["d", "n2", "n1", "c", "l"]);
  });
  it("a step just added and still empty becomes the meeting, moved up to be current", () => {
    const before: Subtask[] = [{ id: "c", title: "Build the page", done: false }, { id: "e", title: "Call Pam", done: false }];
    const list = withMeetNowSteps(before, opts("e"), ids(), NOW);
    expect(list.map((x) => [x.id, x.title])).toEqual([["e", "Meet with Pam"], ["n1", "Add the meeting transcript"], ["c", "Build the page"]]);
  });
  it("a step with work on it stays as it is", () => {
    const before: Subtask[] = [{ id: "c", title: "Build the page", done: false, notes: "<p>Use the brief</p>" }];
    const list = withMeetNowSteps(before, opts("c"), ids(), NOW);
    expect(list.map((x) => x.title)).toEqual(["Meet with Pam", "Add the meeting transcript", "Build the page"]);
  });
  it("a current step asking what's next becomes the meeting", () => {
    const before: Subtask[] = [{ id: "d", title: "Send the draft", done: true }, { id: "w", title: "Send the draft: what's next?", done: false, addedFor: "next:d", startedAt: "x" }];
    const list = withMeetNowSteps(before, opts(), ids(), NOW);
    expect(list.map((x) => [x.id, x.title])).toEqual([["d", "Send the draft"], ["w", "Meet with Pam"], ["n1", "Add the meeting transcript"]]);
  });
  it("a booked meeting's sync leaves Meet now's pair alone and adds its own", () => {
    const now = withMeetNowSteps([], opts(), ids(), NOW);
    const booked = withMeetingSteps(now, "Pam", "2026-10-20", () => "b")!;
    expect(booked.slice(0, 2)).toEqual(now);
    expect(booked.slice(2).map((x) => [x.title, x.due])).toEqual([["Meet with Pam", "2026-10-20"], ["Add the meeting transcript", "2026-10-20"]]);
  });
});

describe("Join now", () => {
  const steps = withMeetNowSteps([], opts(), ids(), NOW);
  it("shows while the meeting step is open, until an hour after it ends", () => {
    expect(liveMeeting(steps, Date.parse("2026-10-14T21:10:00Z"))).toEqual(meeting);
    expect(liveMeeting(steps, Date.parse("2026-10-14T22:34:00Z"))).toEqual(meeting);
    expect(liveMeeting(steps, Date.parse("2026-10-14T22:36:00Z"))).toBeNull();
  });
  it("not once the step is done, nor on a finished task", () => {
    expect(liveMeeting(steps.map((x) => ({ ...x, done: true })), Date.parse("2026-10-14T21:10:00Z"))).toBeNull();
    expect(liveMeetingOf([{ status: "done", subtasks: steps }], Date.parse("2026-10-14T21:10:00Z"))).toBeNull();
    expect(liveMeetingOf([{ status: "todo", subtasks: [] }, { status: "in_progress", subtasks: steps }], Date.parse("2026-10-14T21:10:00Z"))).toEqual(meeting);
  });
});

describe("the meeting's times and Google event", () => {
  it("from this minute, 30 minutes long", () => {
    expect(meetNowTimes(Date.parse("2026-10-14T21:05:42.123Z"))).toEqual({ start: "2026-10-14T21:05:00.000Z", end: "2026-10-14T21:35:00.000Z" });
  });
  it("asks Google for a Meet, with the client as a guest", () => {
    const b = meetNowEventBody({ title: "Pam Macias and Derek", start: "s", end: "e", guest: { email: "pam@x.com", name: "Pam Macias" }, link: null, requestId: "r1" });
    expect(b).toEqual({ summary: "Pam Macias and Derek", start: { dateTime: "s" }, end: { dateTime: "e" }, attendees: [{ email: "pam@x.com", displayName: "Pam Macias" }],
      conferenceData: { createRequest: { requestId: "r1", conferenceSolutionKey: { type: "hangoutsMeet" } } } });
  });
  it("with your own link, no Meet: the link in the location", () => {
    const b = meetNowEventBody({ title: "t", start: "s", end: "e", guest: null, link: "https://zoom.us/j/1", requestId: "r1" });
    expect(b).toEqual({ summary: "t", start: { dateTime: "s" }, end: { dateTime: "e" }, attendees: [], location: "https://zoom.us/j/1", description: "Join: https://zoom.us/j/1" });
  });
});

import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/ghlTokens", () => ({ configuredLocations: async () => [], tokenForLocation: async () => null }));
const { normalizeEvent, mergeEvents, isLiveAppointment, bookingUrl, startOfPacificDay, isAllDay, meetingTaskReset } = await import("./calendarService");

const names = new Map([["cal1", "Derek & Justin"]]);
const appt = { id: "e1", startTime: "2026-10-06T16:00:00-07:00", endTime: "2026-10-06T16:30:00-07:00", title: "Pamela Macias w/ Derek & Justin", calendarId: "cal1", contactId: "g1", address: "https://zoom.us/j/1", appointmentStatus: "confirmed" };

describe("calendar events from GoHighLevel", () => {
  it("normalizes an appointment and a blocked slot", () => {
    expect(normalizeEvent(appt, { busy: false, memberId: "u_derek", calendarNames: names })).toMatchObject({ id: "e1", title: "Pamela Macias w/ Derek & Justin", calendarName: "Derek & Justin", ghlContactId: "g1", joinUrl: "https://zoom.us/j/1", busy: false, people: ["u_derek"] });
    const b = normalizeEvent({ id: "b1", startTime: "2026-10-06T12:00:00-07:00", endTime: "2026-10-06T12:45:00-07:00", title: "", address: "" }, { busy: true, memberId: "u_derek", calendarNames: names });
    expect(b).toMatchObject({ title: "Busy", busy: true, ghlContactId: null, joinUrl: null });
  });
  it("leaves out cancelled, invalid and deleted appointments", () => {
    expect(isLiveAppointment(appt)).toBe(true);
    expect(isLiveAppointment({ ...appt, appointmentStatus: "cancelled" })).toBe(false);
    expect(isLiveAppointment({ ...appt, appointmentStatus: undefined, appoinmentStatus: "invalid" })).toBe(false);
    expect(isLiveAppointment({ ...appt, deleted: true })).toBe(false);
  });
  it("shows a shared meeting once, with both people, in time order", () => {
    const d = normalizeEvent(appt, { busy: false, memberId: "u_derek", calendarNames: names });
    const j = normalizeEvent(appt, { busy: false, memberId: "u_justin", calendarNames: names });
    const early = normalizeEvent({ ...appt, id: "e0", startTime: "2026-10-06T09:00:00-07:00" }, { busy: false, memberId: "u_justin", calendarNames: names });
    const out = mergeEvents([d, j, early]);
    expect(out.map((e) => e.id)).toEqual(["e0", "e1"]);
    expect(out[1].people).toEqual(["u_derek", "u_justin"]);
  });
  it("merges blocked time from both sub-accounts and both people, and drops one that is an appointment", () => {
    const busy = (id: string, who: string, title: string, start = "2026-10-06T11:00:00-07:00", end = "2026-10-06T11:30:00-07:00") =>
      normalizeEvent({ id, startTime: start, endTime: end, title }, { busy: true, memberId: who, calendarNames: names });
    const out = mergeEvents([busy("b1", "u_derek", "Derek x Justin"), busy("b2", "u_derek", "Derek x Justin"), busy("b3", "u_justin", "Derek x Justin"),
      busy("b4", "u_justin", "Pamela Macias w/ Derek & Justin", appt.startTime, appt.endTime), normalizeEvent(appt, { busy: false, memberId: "u_derek", calendarNames: names })]);
    expect(out.map((e) => [e.title, e.busy, e.people])).toEqual([
      ["Derek x Justin", true, ["u_derek", "u_justin"]],
      ["Pamela Macias w/ Derek & Justin", false, ["u_derek"]],
    ]);
  });
  it("builds the booking page on the sub-account's domain, else GoHighLevel's", () => {
    expect(bookingUrl("zLm", "link.clickuplocal.com")).toBe("https://link.clickuplocal.com/widget/booking/zLm");
    expect(bookingUrl("zLm", "https://link.clickuplocal.com/")).toBe("https://link.clickuplocal.com/widget/booking/zLm");
    expect(bookingUrl("zLm", null)).toBe("https://api.leadconnectorhq.com/widget/booking/zLm");
  });
  it("knows an all day block", () => {
    expect(isAllDay({ start: "2026-10-05T00:00:00-07:00", end: "2026-10-06T00:00:00-07:00" })).toBe(true);
    expect(isAllDay({ start: "2026-10-05T09:00:00-07:00", end: "2026-10-05T10:00:00-07:00" })).toBe(false);
  });
  it("starts the day at midnight in Los Angeles", () => {
    expect(new Date(startOfPacificDay(Date.parse("2026-10-06T03:30:00Z"))).toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });
  it("puts the meeting task back when the meeting is cancelled, and only that task", () => {
    const task = { title: "Meeting with Derek Fox", due: "2026-10-08", attachments: [{ name: "Meeting location" }, { name: "brief.pdf" }], comments: [] };
    const r = meetingTaskReset(task, "2026-10-08T13:00:00-07:00", "2026-10-05", "2026-10-05T16:00:00Z")!;
    expect(r.title).toBe("Rebook Derek Fox (meeting cancelled)");
    expect(r.due).toBe("2026-10-05");
    expect(r.attachments).toEqual([{ name: "brief.pdf" }]);
    expect((r.comments[0] as { body: string }).body).toBe("Meeting on Thu, Oct 8, 1:00 PM cancelled");
    expect(meetingTaskReset({ ...task, due: "2026-10-20" }, "2026-10-08T13:00:00-07:00", "2026-10-05", "x")).toBeNull();
    expect(meetingTaskReset({ ...task, title: "Replied by email" }, "2026-10-08T13:00:00-07:00", "2026-10-05", "x")).toBeNull();
  });
});

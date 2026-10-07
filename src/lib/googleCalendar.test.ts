import { describe, it, expect } from "vitest";
import { meetingLinkOf, withGoogleLinks } from "./googleCalendar";

// "Derek x Justin x Claude" came from GoHighLevel as blocked time with no
// link; the Zoom link is on the Google event (Derek, 2026-10-07).
describe("meeting links from Google Calendar", () => {
  it("finds Meet, a conference entry, or a video link in the location or notes", () => {
    expect(meetingLinkOf({ hangoutLink: "https://meet.google.com/abc-defg-hij" })).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetingLinkOf({ conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://us02web.zoom.us/j/123?pwd=x" }] } })).toBe("https://us02web.zoom.us/j/123?pwd=x");
    expect(meetingLinkOf({ location: "https://us02web.zoom.us/j/9876543210" })).toBe("https://us02web.zoom.us/j/9876543210");
    expect(meetingLinkOf({ description: '<a href="https://zoom.us/j/555?pwd=a&amp;b=c">Join Zoom</a>' })).toBe("https://zoom.us/j/555?pwd=a&b=c");
    expect(meetingLinkOf({ location: "Starbucks on Main", description: "see https://example.com/agenda" })).toBeNull();
  });
  it("gives a blocked time the link of the Google event at the same time on one of its people's calendars", () => {
    const at = (h: number) => `2026-10-07T${String(h).padStart(2, "0")}:30:00-07:00`;
    const events = [
      { id: "b1", busy: true, start: at(9), end: at(10), people: ["u_justin", "u_derek"], joinUrl: null },
      { id: "b2", busy: true, start: at(12), end: at(13), people: ["u_derek"], joinUrl: null },
      { id: "a1", busy: false, start: at(14), end: at(15), people: ["u_derek"], joinUrl: null },
    ];
    const byMember = new Map([["u_derek", [
      { start: Date.parse(at(9)), end: Date.parse(at(10)), title: "Derek x Justin x Claude", joinUrl: "https://zoom.us/j/1" },
      { start: Date.parse(at(12)), end: Date.parse(at(13)), title: "Lunch & Walk", joinUrl: null },
      { start: Date.parse(at(14)), end: Date.parse(at(15)), title: "Appointment", joinUrl: "https://zoom.us/j/2" },
    ]]]);
    const out = withGoogleLinks(events, byMember);
    expect(out.map((e) => e.joinUrl)).toEqual(["https://zoom.us/j/1", null, null]);
  });
});

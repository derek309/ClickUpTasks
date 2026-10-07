import { describe, it, expect } from "vitest";
import { isReminderHour, portalReminderEmail, endOfWeek, thisWeek } from "./portalReminders";

describe("Monday client reminders", () => {
  it("is 8 AM California on a Monday only, summer and winter", () => {
    expect(isReminderHour(Date.parse("2026-10-05T15:00:00Z"))).toBe(true); // Mon 8 AM PDT
    expect(isReminderHour(Date.parse("2026-10-05T16:00:00Z"))).toBe(false); // Mon 9 AM PDT
    expect(isReminderHour(Date.parse("2026-11-30T16:00:00Z"))).toBe(true); // Mon 8 AM PST
    expect(isReminderHour(Date.parse("2026-12-02T16:00:00Z"))).toBe(false); // Wed, not any more
    expect(isReminderHour(Date.parse("2026-10-06T15:00:00Z"))).toBe(false); // Tuesday
  });
  it("lists what we need, with dates, and skips when nothing is waiting", () => {
    const e = portalReminderEmail({ firstName: "James", needs: [{ title: "Send plan counts", due: "2026-10-01" }, { title: "PlanEnroll link", due: null }], working: [{ title: "Homepage", due: null }], showWorking: true, portalUrl: "https://x/waiting/abc", monday: true, today: "2026-10-05" })!;
    expect(e.subject).toBe("This week: 2 things we need from you");
    expect(e.body).toMatch(/Hi James/);
    expect(e.body).toMatch(/Send plan counts <span[^>]*>\(needed by Thu, Oct 1, late\)/);
    expect(e.body).toMatch(/Homepage/);
    expect(e.body).toMatch(/https:\/\/x\/waiting\/abc/);
    expect(portalReminderEmail({ firstName: null, needs: [], working: [], showWorking: true, portalUrl: "u", monday: false, today: "2026-10-05" })).toBeNull();
  });
  it("keeps only this week's: late or due by Sunday, nothing undated", () => {
    expect(endOfWeek("2026-10-05")).toBe("2026-10-11"); // Monday → Sunday
    expect(endOfWeek("2026-10-11")).toBe("2026-10-11"); // Sunday itself
    const tasks = [{ title: "late", due: "2026-10-01" }, { title: "Fri", due: "2026-10-09" }, { title: "Sun", due: "2026-10-11" }, { title: "next week", due: "2026-10-12" }, { title: "Newsletter", due: "2026-11-15" }, { title: "no date", due: null }];
    expect(thisWeek(tasks, "2026-10-05").map((t) => t.title)).toEqual(["late", "Fri", "Sun"]);
  });
});

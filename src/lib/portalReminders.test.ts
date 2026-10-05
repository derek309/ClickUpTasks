import { describe, it, expect } from "vitest";
import { isReminderHour, portalReminderEmail } from "./portalReminders";

describe("Monday and Wednesday client reminders", () => {
  it("is 8 AM California on a Monday or Wednesday, summer and winter", () => {
    expect(isReminderHour(Date.parse("2026-10-05T15:00:00Z"))).toBe(true); // Mon 8 AM PDT
    expect(isReminderHour(Date.parse("2026-10-05T16:00:00Z"))).toBe(false); // Mon 9 AM PDT
    expect(isReminderHour(Date.parse("2026-12-02T16:00:00Z"))).toBe(true); // Wed 8 AM PST
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
});

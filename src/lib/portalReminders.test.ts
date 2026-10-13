import { describe, it, expect } from "vitest";
import { isReminderHour, portalReminderEmail, endOfWeek, thisWeek } from "./portalReminders";

describe("Monday client reminders", () => {
  it("is 8 AM California on a Monday only, summer and winter", () => {
    expect(isReminderHour(Date.parse("2026-10-05T15:00:00Z"))).toBe(true); // Mon 8 AM PDT
    expect(isReminderHour(Date.parse("2026-10-05T16:00:00Z"))).toBe(false); // Mon 9 AM PDT
    expect(isReminderHour(Date.parse("2026-11-30T16:00:00Z"))).toBe(true); // Mon 8 AM PST
    expect(isReminderHour(Date.parse("2026-12-02T16:00:00Z"))).toBe(false); // Wednesday
    expect(isReminderHour(Date.parse("2026-10-06T15:00:00Z"))).toBe(false); // Tuesday
    expect(isReminderHour(Date.parse("2026-10-10T15:00:00Z"))).toBe(false); // Saturday
  });
  it("counts overdue, due today and coming up, never names them, and skips when nothing is waiting", () => {
    const e = portalReminderEmail({ firstName: "James", needs: [{ title: "Send plan counts", due: "2026-10-01" }, { title: "Today one", due: "2026-10-05" }],
      all: [{ title: "Send plan counts", due: "2026-10-01" }, { title: "Today one", due: "2026-10-05" }, { title: "Later", due: "2026-10-20" }, { title: "PlanEnroll link", due: null }],
      portalUrl: "https://x/waiting/abc", monday: true, today: "2026-10-05" })!;
    expect(e.subject).toBe("Your attention needed: 1 overdue, 1 due today, 2 coming up");
    expect(e.body).toMatch(/Hi James/);
    expect(e.body).toMatch(/<b[^>]*>1<\/b> task is overdue/);
    expect(e.body).toMatch(/<b[^>]*>2<\/b> are coming up/);
    expect(e.body).not.toMatch(/Send plan counts|PlanEnroll/);
    expect(e.body).toMatch(/New task/);
    expect(e.body).toMatch(/https:\/\/x\/waiting\/abc/);
    expect(portalReminderEmail({ firstName: null, needs: [], portalUrl: "u", monday: false, today: "2026-10-05" })).toBeNull();
  });
  it("keeps only this week's: late or due by Sunday, nothing undated", () => {
    expect(endOfWeek("2026-10-05")).toBe("2026-10-11"); // Monday → Sunday
    expect(endOfWeek("2026-10-11")).toBe("2026-10-11"); // Sunday itself
    const tasks = [{ title: "late", due: "2026-10-01" }, { title: "Fri", due: "2026-10-09" }, { title: "Sun", due: "2026-10-11" }, { title: "next week", due: "2026-10-12" }, { title: "Newsletter", due: "2026-11-15" }, { title: "no date", due: null }];
    expect(thisWeek(tasks, "2026-10-05").map((t) => t.title)).toEqual(["late", "Fri", "Sun"]);
  });
});

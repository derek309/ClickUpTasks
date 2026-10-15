import { describe, expect, it } from "vitest";
import { businessDayBefore, clientStepReminderDue, stepAsk, stepReminderTurn, teammateStepReminderDue, weekdayOnOrBefore } from "./stepReminders";
import { stepReminderEmail } from "./portalReminders";

// Thu Oct 15 2026, Fri 16, Sat 17, Sun 18, Mon 19, Tue 20, Wed 21.
const base = { checkIn: null as string | null, started: "2026-10-15", lastToClient: null as string | null, sentForStep: false };

describe("client step reminders", () => {
  it("once: on the check in date, the first weekday after it when it falls on a weekend, and once only", () => {
    const r = { every: "once" as const };
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-16", checkIn: "2026-10-19" })).toBe(false);
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-19", checkIn: "2026-10-19" })).toBe(true);
    // A Saturday check in: Monday.
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-17", checkIn: "2026-10-17" })).toBe(false);
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-19", checkIn: "2026-10-17" })).toBe(true);
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-19", checkIn: "2026-10-19", sentForStep: true })).toBe(false);
  });
  it("every N: first the business day after the step started, then N business days after the last, across weekends", () => {
    const r = { every: 2 as const };
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-15" })).toBe(false);
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-16" })).toBe(true);
    // Last one Friday: two business days is Tuesday, not Sunday or Monday.
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-19", lastToClient: "2026-10-16" })).toBe(false);
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-20", lastToClient: "2026-10-16" })).toBe(true);
    expect(clientStepReminderDue({ every: 5 }, { ...base, today: "2026-10-22", lastToClient: "2026-10-16" })).toBe(false);
    expect(clientStepReminderDue({ every: 5 }, { ...base, today: "2026-10-23", lastToClient: "2026-10-16" })).toBe(true);
    // A reminder from before the step began doesn't count.
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-16", lastToClient: "2026-10-14" })).toBe(true);
    // Never on a weekend.
    expect(clientStepReminderDue(r, { ...base, today: "2026-10-17" })).toBe(false);
  });
  it("a teammate's reminder is not a client's", () => {
    expect(clientStepReminderDue({ at: "morning" }, { ...base, today: "2026-10-16" })).toBe(false);
  });
});

describe("teammate step reminders", () => {
  it("the day before: the business day before it is due", () => {
    const r = { at: "day_before" as const };
    expect(teammateStepReminderDue(r, { today: "2026-10-16", due: "2026-10-19" })).toBe(true);
    expect(teammateStepReminderDue(r, { today: "2026-10-18", due: "2026-10-19" })).toBe(false);
    expect(teammateStepReminderDue(r, { today: "2026-10-19", due: "2026-10-20" })).toBe(true);
    expect(teammateStepReminderDue(r, { today: "2026-10-16", due: null })).toBe(false);
  });
  it("the morning it's due, a weekend date on the Friday", () => {
    const r = { at: "morning" as const };
    expect(teammateStepReminderDue(r, { today: "2026-10-19", due: "2026-10-19" })).toBe(true);
    expect(teammateStepReminderDue(r, { today: "2026-10-16", due: "2026-10-17" })).toBe(true);
    expect(teammateStepReminderDue(r, { today: "2026-10-16", due: "2026-10-19" })).toBe(false);
    expect(weekdayOnOrBefore("2026-10-18")).toBe("2026-10-16");
    expect(businessDayBefore("2026-10-19")).toBe("2026-10-16");
  });
});

describe("whose step reminder and what it asks", () => {
  it("only the client's wait or a teammate's step", () => {
    expect(stepReminderTurn({ finishWhen: "reply", remind: { every: 2 } }, "u_derek")).toBe("client");
    expect(stepReminderTurn({ assigneeId: "u_justin", remind: { at: "morning" } }, "u_derek")).toBe("teammate");
    expect(stepReminderTurn({ assigneeId: "u_derek", remind: { at: "morning" } }, "u_derek")).toBeNull();
    expect(stepReminderTurn({ assigneeId: "u_claude", remind: { at: "morning" } }, "u_derek")).toBeNull();
    expect(stepReminderTurn({ finishWhen: "reply" }, "u_derek")).toBeNull();
  });
  it("asks in the client's words", () => {
    expect(stepAsk({ title: "Wait for Pam's class times" }, "Pam", "Facebook ad")).toBe("your class times");
    expect(stepAsk({ title: "Wait for Pam's reply" }, "Pam", "Facebook ad")).toBe("Facebook ad");
    expect(stepAsk({ title: "Ask Pam: the logo files" }, "Pam", "Website")).toBe("the logo files");
    expect(stepAsk({ title: "Wait", notes: "<p>The exact class dates and times.</p><p>More</p>" }, "Pam", "Ad")).toBe("The exact class dates and times");
  });
  it("the email is about that one item, with the portal link and no counts", () => {
    const e = stepReminderEmail({ firstName: "Pam", ask: "your class times", taskTitle: "Facebook ad", link: { url: "https://x/waiting/abc?task=t1", label: "Open it in your client portal" } });
    expect(e.subject).toBe("Reminder: your class times");
    expect(e.body).toContain("Hi Pam,");
    expect(e.body).toContain("A quick reminder about your class times. We need it to move Facebook ad forward.");
    expect(e.body).toContain("https://x/waiting/abc?task=t1");
    expect(e.body).toContain("Please answer there rather than replying to this email.");
    expect(e.body).not.toMatch(/thing/);
    expect(e.subject + e.body).not.toMatch(/ - | – | — /);
  });
});

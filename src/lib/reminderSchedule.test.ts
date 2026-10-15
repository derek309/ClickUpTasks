import { describe, it, expect } from "vitest";
import { isReminderDay, reminderLine, reminderQueueStatus, reminderSettings } from "./reminderSchedule";

// 2026-10-12 is a Monday.
const MON = "2026-10-12", TUE = "2026-10-13", WED = "2026-10-14", THU = "2026-10-15", FRI = "2026-10-16", SAT = "2026-10-17", SUN = "2026-10-18", NEXT_MON = "2026-10-19", NEXT_TUE = "2026-10-20";

describe("which day a client is reminded", () => {
  it("is off when nothing is chosen (since 2026-10-15), Mondays when Mondays are chosen", () => {
    expect(isReminderDay(null, MON, null)).toBe(false);
    expect(isReminderDay({ schedule: "monday", auto: false }, MON, null)).toBe(true);
    expect(isReminderDay({ schedule: "monday", auto: false }, TUE, null)).toBe(false);
    expect(isReminderDay(undefined, FRI, null)).toBe(false);
    expect(isReminderDay({ schedule: "monday", auto: false }, NEXT_MON, MON)).toBe(true);
  });
  it("never on a weekend, whatever is chosen", () => {
    expect(isReminderDay({ schedule: "every", every: 2, auto: false }, SAT, MON)).toBe(false);
    expect(isReminderDay({ schedule: "days", days: [1, 2, 3, 4, 5], auto: false }, SUN, null)).toBe(false);
  });
  it("on the picked weekdays", () => {
    const mwf = { schedule: "days", days: [1, 3, 5], auto: false };
    expect([MON, TUE, WED, THU, FRI].map((d) => isReminderDay(mwf, d, null))).toEqual([true, false, true, false, true]);
  });
  it("every N business days from the last one, across a weekend", () => {
    const every3 = { schedule: "every", every: 3, auto: false };
    // Last on Thursday: Fri 1, Mon 2, Tue 3.
    expect(isReminderDay(every3, FRI, THU)).toBe(false);
    expect(isReminderDay(every3, NEXT_MON, THU)).toBe(false);
    expect(isReminderDay(every3, NEXT_TUE, THU)).toBe(true);
    // A missed day (no one waiting then) still goes the next weekday.
    expect(isReminderDay({ schedule: "every", every: 2, auto: false }, FRI, MON)).toBe(true);
  });
  it("starts the first weekday after it was chosen when none has gone since", () => {
    const chosenWed = { schedule: "every", every: 5, auto: false, since: WED };
    expect(isReminderDay(chosenWed, WED, null)).toBe(false);
    expect(isReminderDay(chosenWed, THU, null)).toBe(true);
    // Chosen Friday: Monday is the first weekday after.
    expect(isReminderDay({ ...chosenWed, since: FRI }, NEXT_MON, null)).toBe(true);
    // An older reminder before it was chosen doesn't hold it back...
    expect(isReminderDay(chosenWed, THU, MON)).toBe(true);
    // ...and one after it was chosen counts.
    expect(isReminderDay(chosenWed, FRI, THU)).toBe(false);
    // Never one and never chosen: any weekday.
    expect(isReminderDay({ schedule: "every", every: 3, auto: false }, WED, null)).toBe(true);
  });
  it("never when off, or with no days picked", () => {
    expect([MON, TUE, WED].some((d) => isReminderDay({ schedule: "off", auto: true }, d, null))).toBe(false);
    expect(isReminderDay({ schedule: "days", days: [], auto: false }, MON, null)).toBe(false);
  });
});

describe("how it goes and what the card says", () => {
  it("auto sends on its own, otherwise waits for review", () => {
    expect(reminderQueueStatus({ schedule: "monday", auto: true }, "review", false)).toBe("pending");
    // Everything waits for review while REMINDERS_REVIEW_ALL is on.
    expect(reminderQueueStatus({ schedule: "monday", auto: true }, "review")).toBe("review");
    expect(reminderQueueStatus({ schedule: "monday", auto: false }, "review")).toBe("review");
    expect(reminderQueueStatus(null, "review")).toBe("review");
  });
  it("reads saved settings safely", () => {
    expect(reminderSettings(null)).toEqual({ schedule: "off", auto: false });
    expect(reminderSettings({ schedule: "every", every: 40, auto: "yes" })).toEqual({ schedule: "every", every: 3, auto: false });
    expect(reminderSettings({ schedule: "days", days: [5, 1, 1, 9], auto: true })).toEqual({ schedule: "days", days: [1, 5], auto: true });
    expect(reminderSettings({ schedule: "days", days: [1], auto: false })).toEqual({ schedule: "monday", auto: false });
    expect(reminderSettings({ schedule: "weekly" }).schedule).toBe("monday");
  });
  it("says when and how in one line", () => {
    expect(reminderLine(null)).toBe("Reminders off");
    expect(reminderLine({ schedule: "monday", auto: false })).toBe("Reminds Mondays · for review");
    // Sends itself only once REMINDERS_REVIEW_ALL is turned off.
    expect(reminderLine({ schedule: "every", every: 3, auto: true })).toBe("Reminds every 3 business days · for review");
    expect(reminderLine({ schedule: "days", days: [1, 3, 5], auto: false })).toBe("Reminds Mondays, Wednesdays and Fridays · for review");
    expect(reminderLine({ schedule: "off", auto: true })).toBe("Reminders off");
  });
});

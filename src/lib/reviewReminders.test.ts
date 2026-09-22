import { describe, it, expect } from "vitest";
import { businessDaysBetween, isBusinessDay, reminderDue, MAX_REMINDERS, type ReminderState } from "./reviewReminders";

// 2026: Fri 18 Sep, Sat 19, Sun 20, Mon 21, Tue 22 ... Times are UTC; 16:00Z is
// 9 AM in California, which is the zone business days are counted in.
const at = (date: string, time = "16:00") => `${date}T${time}:00Z`;

describe("isBusinessDay", () => {
  it("knows weekdays from weekends", () => {
    expect(isBusinessDay(at("2026-09-18"))).toBe(true); // Fri
    expect(isBusinessDay(at("2026-09-19"))).toBe(false); // Sat
    expect(isBusinessDay(at("2026-09-20"))).toBe(false); // Sun
    expect(isBusinessDay(at("2026-09-21"))).toBe(true); // Mon
  });

  it("goes by California, not by UTC", () => {
    // Monday 06:00 UTC is still Sunday 11 PM in California. A reminder sent now
    // would land on a client's Sunday night.
    expect(isBusinessDay("2026-09-21T06:00:00Z")).toBe(false);
  });
});

describe("businessDaysBetween", () => {
  it("counts the same day as none and the next weekday as one", () => {
    expect(businessDaysBetween(at("2026-09-21", "15:00"), at("2026-09-21", "23:00"))).toBe(0);
    expect(businessDaysBetween(at("2026-09-21"), at("2026-09-22"))).toBe(1);
  });

  it("skips the weekend", () => {
    expect(businessDaysBetween(at("2026-09-18"), at("2026-09-21"))).toBe(1); // Fri to Mon
    expect(businessDaysBetween(at("2026-09-18"), at("2026-09-22"))).toBe(2); // Fri to Tue
    expect(businessDaysBetween(at("2026-09-19"), at("2026-09-21"))).toBe(1); // Sat to Mon
  });

  it("does not lose or gain a day across daylight saving", () => {
    expect(businessDaysBetween(at("2026-10-30"), at("2026-11-02"))).toBe(1); // Fri to Mon over the fall back
    expect(businessDaysBetween(at("2026-03-06"), at("2026-03-09"))).toBe(1); // Fri to Mon over the spring forward
  });

  it("is zero when the times are the wrong way round", () => {
    expect(businessDaysBetween(at("2026-09-22"), at("2026-09-21"))).toBe(0);
  });
});

describe("reminderDue", () => {
  const base: ReminderState = {
    sentAt: at("2026-09-21", "20:00"), // sent Monday afternoon
    roundAt: null, lastReminderAt: null, remindersSent: 0,
    everyDays: 1, clientRepliedAt: null, now: at("2026-09-22"),
  };

  it("sends the first reminder the next business morning", () => {
    expect(reminderDue(base)).toMatchObject({ due: true, sentThisRound: 0 });
  });

  it("does not send on the day it went out", () => {
    expect(reminderDue({ ...base, now: at("2026-09-21", "23:00") }).reason).toBe("not yet");
  });

  it("never sends at the weekend, and picks up again on Monday", () => {
    const friday = { ...base, sentAt: at("2026-09-17") };
    expect(reminderDue({ ...friday, now: at("2026-09-19") }).reason).toBe("weekend");
    expect(reminderDue({ ...friday, lastReminderAt: at("2026-09-18"), remindersSent: 1, now: at("2026-09-21") }).due).toBe(true);
  });

  it(`stops after ${MAX_REMINDERS}`, () => {
    expect(reminderDue({ ...base, lastReminderAt: at("2026-09-24"), remindersSent: MAX_REMINDERS, now: at("2026-09-25") }))
      .toMatchObject({ due: false, reason: "capped" });
  });

  it("starts again after Restart", () => {
    // Capped, then Restart pressed on Friday: the old count no longer applies.
    const restarted = { ...base, lastReminderAt: at("2026-09-24"), remindersSent: MAX_REMINDERS, roundAt: at("2026-09-25", "18:00") };
    expect(reminderDue({ ...restarted, now: at("2026-09-25", "20:00") }).reason).toBe("not yet");
    expect(reminderDue({ ...restarted, now: at("2026-09-28") })).toMatchObject({ due: true, sentThisRound: 0 });
  });

  it("starts again when a new version is sent", () => {
    const capped = { ...base, lastReminderAt: at("2026-09-24"), remindersSent: MAX_REMINDERS };
    expect(reminderDue({ ...capped, sentAt: at("2026-09-24", "22:00"), now: at("2026-09-25") }))
      .toMatchObject({ due: true, sentThisRound: 0 });
  });

  it("stops once the client has answered", () => {
    expect(reminderDue({ ...base, clientRepliedAt: at("2026-09-21", "22:00") }).reason).toBe("replied");
  });

  it("ignores an answer from before the round began", () => {
    // Brian's comments came before the version he is now being asked about.
    expect(reminderDue({ ...base, clientRepliedAt: at("2026-09-18") }).due).toBe(true);
  });

  it("waits longer when set to every two business days, and not at all when off", () => {
    expect(reminderDue({ ...base, everyDays: 2 }).reason).toBe("not yet");
    expect(reminderDue({ ...base, everyDays: 2, now: at("2026-09-23") }).due).toBe(true);
    expect(reminderDue({ ...base, everyDays: 0 }).reason).toBe("off");
  });
});

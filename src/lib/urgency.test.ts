import { describe, it, expect } from "vitest";
import { URGENCY_TIER, tierForDate, urgencyKeyFrom, urgencyDateOf } from "./urgency";
import { TODAY, TOMORROW, THIS_WEEK_END, addDaysIso, type Task } from "./data";

// This is what orders the client board: which client you see first when you
// open the app. Two copies of it used to sit in Cockpit and had to be kept in
// step by hand.
const t = (o: Partial<Task>): Task =>
  ({ id: "t", title: "", status: "todo", priority: "normal", due: null, followUpAt: null, priorityAuto: false, ...o } as Task);

describe("which tier a date lands in", () => {
  it("puts the past ahead of today, and today ahead of tomorrow", () => {
    expect(tierForDate(addDaysIso(TODAY, -1))).toBe(URGENCY_TIER.overdue);
    expect(tierForDate(TODAY)).toBe(URGENCY_TIER.today);
    expect(tierForDate(TOMORROW)).toBe(URGENCY_TIER.tomorrow);
  });
  it("orders the further-out tiers consistently", () => {
    expect(tierForDate(THIS_WEEK_END)).toBeLessThanOrEqual(URGENCY_TIER.thisWeek);
    expect(tierForDate(addDaysIso(TODAY, 300))).toBe(URGENCY_TIER.later);
  });
});

describe("the urgency of a set of open tasks", () => {
  it("tells nothing-to-do apart from nothing-scheduled", () => {
    // Two different states that used to share a number in people's heads: one
    // client is finished, the other has unplanned work.
    expect(urgencyKeyFrom([]).tier).toBe(URGENCY_TIER.clear);
    expect(urgencyKeyFrom([t({})]).tier).toBe(URGENCY_TIER.noDate);
  });

  it("takes the soonest date among the open tasks", () => {
    const key = urgencyKeyFrom([t({ due: addDaysIso(TODAY, 9) }), t({ due: TODAY })]);
    expect(key.due).toBe(TODAY);
    expect(key.tier).toBe(URGENCY_TIER.today);
  });

  // The subtle one: priority is read off the tasks due on the soonest day, not
  // the strongest priority anywhere. Otherwise something urgent next month
  // pulls a client to the top of today.
  it("ranks by the priority sitting on the soonest date, not the highest anywhere", () => {
    const key = urgencyKeyFrom([
      t({ due: TODAY, priority: "normal" }),
      t({ due: addDaysIso(TODAY, 30), priority: "urgent" }),
    ]);
    expect(key.due).toBe(TODAY);
    const urgentOnly = urgencyKeyFrom([t({ due: TODAY, priority: "urgent" })]);
    expect(urgentOnly.priorityRank).toBeGreaterThan(key.priorityRank);
  });

  it("counts a snoozed task at the date it comes back, not the date it was due", () => {
    // The whole reason the follow-up date exists: a task parked until Friday
    // should not sit in Overdue all week.
    const parked = t({ due: addDaysIso(TODAY, -5), followUpAt: addDaysIso(TODAY, 5) });
    expect(urgencyDateOf(parked)).toBe(addDaysIso(TODAY, 5));
    expect(urgencyKeyFrom([parked]).tier).not.toBe(URGENCY_TIER.overdue);
  });

  it("ignores undated tasks when something else has a date", () => {
    expect(urgencyKeyFrom([t({}), t({ due: TODAY })]).tier).toBe(URGENCY_TIER.today);
  });
});

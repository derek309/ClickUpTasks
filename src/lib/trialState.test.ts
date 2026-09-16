import { describe, it, expect } from "vitest";
import { trialState } from "./data";

// A trial has two fields and they can disagree: the flag says the clock is
// running, the date says when it stops, and nothing reconciles them. A window
// that ran out a month ago still carries the flag until someone closes it, and
// one closed by hand keeps its date as the record of what was promised. These
// pin down what a person is told in each case.

const TODAY = "2026-09-15";

describe("where a trial has got to", () => {
  it("is nothing at all when no trial was ever stamped", () => {
    expect(trialState({ inTrial: false, trialEndsAt: null }, TODAY)).toEqual({ kind: "none" });
    // The flag alone, with no date, is not a trial either: there is nothing to
    // tell anyone about.
    expect(trialState({ inTrial: true, trialEndsAt: null }, TODAY)).toEqual({ kind: "none" });
  });

  it("counts the days left while it is running", () => {
    expect(trialState({ inTrial: true, trialEndsAt: "2026-09-25" }, TODAY)).toEqual({ kind: "running", endsAt: "2026-09-25", daysLeft: 10 });
  });

  it("counts calendar days, not working ones, because a trial is a calendar window", () => {
    // 2026-09-15 to 2026-09-29 spans two weekends.
    expect(trialState({ inTrial: true, trialEndsAt: "2026-09-29" }, TODAY)).toMatchObject({ daysLeft: 14 });
  });

  it("is still running on its last day", () => {
    expect(trialState({ inTrial: true, trialEndsAt: TODAY }, TODAY)).toEqual({ kind: "running", endsAt: TODAY, daysLeft: 0 });
  });

  it("says it ran out once the date has passed, even with the flag left on", () => {
    expect(trialState({ inTrial: true, trialEndsAt: "2026-09-01" }, TODAY)).toEqual({ kind: "over", endsAt: "2026-09-01", ended: "ran out" });
  });

  it("tells a trial closed by hand apart from one that ran its course", () => {
    // Flag off with days still on the clock: somebody ended it.
    expect(trialState({ inTrial: false, trialEndsAt: "2026-09-25" }, TODAY)).toEqual({ kind: "over", endsAt: "2026-09-25", ended: "closed early" });
    // Flag off and the date long gone: it simply finished.
    expect(trialState({ inTrial: false, trialEndsAt: "2026-08-01" }, TODAY)).toEqual({ kind: "over", endsAt: "2026-08-01", ended: "ran out" });
  });

  it("keeps the promised end date whichever way it ended", () => {
    const closed = trialState({ inTrial: false, trialEndsAt: "2026-09-25" }, TODAY);
    expect(closed.kind === "over" && closed.endsAt).toBe("2026-09-25");
  });
});

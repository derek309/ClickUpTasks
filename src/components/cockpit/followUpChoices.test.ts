import { describe, expect, it } from "vitest";
import { followUpPicks } from "./EmailWindow";

describe("follow up choices", () => {
  it("on a Monday: today, tomorrow, the rest of the week by name, next Monday, next month", () => {
    expect(followUpPicks("2026-10-12").map((p) => `${p.label} ${p.date}`)).toEqual([
      "Today 2026-10-12", "Tomorrow 2026-10-13", "Wednesday 2026-10-14", "Thursday 2026-10-15", "Friday 2026-10-16",
      "Next Monday 2026-10-19", "Next month 2026-11-02",
    ]);
  });
  it("on a Friday: today, then next Monday", () => {
    expect(followUpPicks("2026-10-16").map((p) => p.label)).toEqual(["Today", "Next Monday", "Next month"]);
  });
  it("on a Saturday: no today, no days this week", () => {
    expect(followUpPicks("2026-10-17").map((p) => `${p.label} ${p.date}`)).toEqual(["Next Monday 2026-10-19", "Next month 2026-11-02"]);
  });
});

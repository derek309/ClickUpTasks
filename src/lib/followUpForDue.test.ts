import { describe, it, expect } from "vitest";
import { followUpForDue, followUpWithDue } from "./data";

const today = "2026-10-05";
describe("a follow up goes with a due date", () => {
  it("the day before, and none when that is today or past", () => {
    expect(followUpForDue("2026-10-20", today)).toBe("2026-10-19");
    expect(followUpForDue("2026-10-08", today)).toBe("2026-10-07"); // 3 days out: 2 days out
    expect(followUpForDue("2026-10-07", today)).toBe("2026-10-06"); // 2 days out: tomorrow
    expect(followUpForDue("2026-10-06", today)).toBeNull(); // due tomorrow: none
    expect(followUpForDue("2026-10-05", today)).toBeNull();
    expect(followUpForDue("2026-10-01", today)).toBeNull();
  });
  it("only when the due date changes and no follow up is set with it", () => {
    expect(followUpWithDue({ due: "2026-10-05" }, { due: "2026-10-20" }, today)).toBe("2026-10-19");
    expect(followUpWithDue({ due: "2026-10-20" }, { due: "2026-10-06" }, today)).toBeNull();
    expect(followUpWithDue({ due: "2026-10-20" }, { due: "2026-10-20" }, today)).toBeUndefined();
    expect(followUpWithDue({ due: null }, { due: "2026-10-20", followUpAt: "2026-10-10" }, today)).toBeUndefined();
    expect(followUpWithDue({ due: "2026-10-20" }, { due: null }, today)).toBeUndefined();
    expect(followUpWithDue({ due: "2026-10-20" }, { status: "done" } as never, today)).toBeUndefined();
  });
});

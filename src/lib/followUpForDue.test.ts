import { describe, it, expect } from "vitest";
import { followUpForDue, followUpWithDue } from "./data";

const today = "2026-10-05";
describe("a follow up goes with a due date", () => {
  it("3 days before when further out, else the day before, never before today", () => {
    expect(followUpForDue("2026-10-20", today)).toBe("2026-10-17");
    expect(followUpForDue("2026-10-09", today)).toBe("2026-10-06");
    expect(followUpForDue("2026-10-08", today)).toBe("2026-10-07");
    expect(followUpForDue("2026-10-07", today)).toBe("2026-10-06");
    expect(followUpForDue("2026-10-06", today)).toBe("2026-10-05");
    expect(followUpForDue("2026-10-05", today)).toBe("2026-10-05");
    expect(followUpForDue("2026-10-01", today)).toBe("2026-10-05");
  });
  it("only when the due date changes and no follow up is set with it", () => {
    expect(followUpWithDue({ due: "2026-10-05" }, { due: "2026-10-20" }, today)).toBe("2026-10-17");
    expect(followUpWithDue({ due: "2026-10-20" }, { due: "2026-10-20" }, today)).toBeUndefined();
    expect(followUpWithDue({ due: null }, { due: "2026-10-20", followUpAt: "2026-10-10" }, today)).toBeUndefined();
    expect(followUpWithDue({ due: "2026-10-20" }, { due: null }, today)).toBeUndefined();
    expect(followUpWithDue({ due: "2026-10-20" }, { status: "done" } as never, today)).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { todayIso, addDaysIso, addBusinessDaysIso, DEFAULT_DUE, DEFAULT_FOLLOW_UP } from "./dates.js";

const dayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

describe("addDaysIso", () => {
  it("crosses a month end", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("crosses a leap day", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("goes backwards too", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
  // The reason this is UTC math: on a DST-shifting day, local-time arithmetic
  // lands 23 or 25 hours out and rounds to the wrong calendar day.
  it("survives both US DST boundaries", () => {
    expect(addDaysIso("2026-03-07", 1)).toBe("2026-03-08"); // spring forward
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01"); // fall back
  });
});

describe("addBusinessDaysIso", () => {
  it("counts three days from a Monday as that Thursday", () => {
    expect(addBusinessDaysIso("2026-09-07", 3)).toBe("2026-09-10");
  });
  // The case the whole function exists for: naive +3 would be Sunday.
  it("counts three days from a Thursday as the following Tuesday", () => {
    expect(addBusinessDaysIso("2026-09-03", 3)).toBe("2026-09-08");
  });
  it("counts three days from a Friday as the following Wednesday", () => {
    expect(addBusinessDaysIso("2026-09-04", 3)).toBe("2026-09-09");
  });
  it("steps off a weekend rather than counting it", () => {
    expect(addBusinessDaysIso("2026-09-05", 1)).toBe("2026-09-07"); // Sat -> Mon
    expect(addBusinessDaysIso("2026-09-06", 1)).toBe("2026-09-07"); // Sun -> Mon
  });
  it("never lands on a weekend, from any starting day", () => {
    for (let i = 0; i < 14; i++) {
      const start = addDaysIso("2026-09-01", i);
      for (const n of [1, 3, 5, 10]) {
        expect(dayOf(addBusinessDaysIso(start, n))).not.toBe(0);
        expect(dayOf(addBusinessDaysIso(start, n))).not.toBe(6);
      }
    }
  });
  it("returns the date unchanged for zero", () => {
    expect(addBusinessDaysIso("2026-09-04", 0)).toBe("2026-09-04");
  });
});

describe("the clipper's defaults", () => {
  it("follows up today", () => {
    expect(DEFAULT_FOLLOW_UP()).toBe(todayIso());
  });
  it("is due three business days out, never on a weekend", () => {
    expect(DEFAULT_DUE()).toBe(addBusinessDaysIso(todayIso(), 3));
    expect(dayOf(DEFAULT_DUE())).not.toBe(0);
    expect(dayOf(DEFAULT_DUE())).not.toBe(6);
  });
  it("never follows up after it is due", () => {
    expect(DEFAULT_FOLLOW_UP() <= DEFAULT_DUE()).toBe(true);
  });
});

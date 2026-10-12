import { describe, expect, it } from "vitest";
import { businessDaysTo, followUpDate } from "./EmailWindow";

// Monday, October 12, 2026.
const MON = "2026-10-12";
describe("follow up choices", () => {
  it("lands on a weekday, a weekend rolling on to Monday", () => {
    expect(followUpDate("1", MON)).toBe("2026-10-13");
    expect(followUpDate("5", MON)).toBe("2026-10-19"); // Sat 17 → Mon 19
    expect(followUpDate("week", MON)).toBe("2026-10-19");
  });
  it("next week is next Monday, next month its first weekday", () => {
    expect(followUpDate("nextweek", MON)).toBe("2026-10-19");
    expect(followUpDate("nextweek", "2026-10-16")).toBe("2026-10-19");
    expect(followUpDate("nextmonth", MON)).toBe("2026-11-02"); // Nov 1 is a Sunday
  });
  it("counts business days to the date, as Send does", () => {
    expect(businessDaysTo("2026-10-13", MON)).toBe(1);
    expect(businessDaysTo("2026-10-19", MON)).toBe(5);
  });
});

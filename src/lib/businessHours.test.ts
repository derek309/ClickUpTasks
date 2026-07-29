import { describe, it, expect } from "vitest";
import { isWithinBusinessHours } from "./businessHours";

// All times below are UTC; the comment gives the Pacific clock reading, which
// is what the check actually cares about.
describe("isWithinBusinessHours (America/Los_Angeles, 8am-6pm Mon-Fri)", () => {
  it("allows a weekday inside the window", () => {
    expect(isWithinBusinessHours(new Date("2026-07-29T17:00:00Z"))).toBe(true); // Wed 10:00 PDT
  });

  it("blocks before 8am", () => {
    expect(isWithinBusinessHours(new Date("2026-07-29T14:00:00Z"))).toBe(false); // Wed 07:00 PDT
  });

  it("blocks from 6pm on — the end of the window is exclusive", () => {
    expect(isWithinBusinessHours(new Date("2026-07-30T01:30:00Z"))).toBe(false); // Wed 18:00 PDT
  });

  it("allows exactly 8am — the start of the window is inclusive", () => {
    expect(isWithinBusinessHours(new Date("2026-07-29T15:00:00Z"))).toBe(true); // Wed 08:00 PDT
  });

  it("blocks weekends even mid-day", () => {
    expect(isWithinBusinessHours(new Date("2026-08-01T19:00:00Z"))).toBe(false); // Sat 12:00 PDT
    expect(isWithinBusinessHours(new Date("2026-08-02T19:00:00Z"))).toBe(false); // Sun 12:00 PDT
  });

  // The same UTC instant is 10:00 Pacific in July but 09:00 in January. Reading
  // the wall clock via Intl rather than a fixed offset is what keeps this
  // correct across the DST boundary — a hardcoded -7 would drift an hour every
  // winter and start letting 7am sends through.
  it("tracks daylight saving instead of assuming a fixed offset", () => {
    expect(isWithinBusinessHours(new Date("2026-01-14T17:00:00Z"))).toBe(true); // Wed 09:00 PST
    expect(isWithinBusinessHours(new Date("2026-01-14T15:00:00Z"))).toBe(false); // Wed 07:00 PST
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { todayPacific, toPacificDate } from "./data";

afterEach(() => {
  vi.useRealTimers();
});

describe("todayPacific", () => {
  it("is still today at 7 PM Pacific, when UTC has already moved to tomorrow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T02:00:00Z")); // 7 PM PDT, Sep 15
    expect(todayPacific()).toBe("2026-09-15");
  });
});

describe("toPacificDate", () => {
  it("dates a late evening instant by the Pacific calendar in winter too", () => {
    expect(toPacificDate("2026-01-10T07:59:00Z")).toBe("2026-01-09"); // 11:59 PM PST
  });
});

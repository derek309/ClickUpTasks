import { describe, it, expect, vi, afterEach } from "vitest";
import {
  todayIso,
  formatDue,
  isOverdue,
  advanceDue,
  timeAgo,
  initialsOf,
  setUsers,
  users,
  TODAY,
  type User,
} from "./data";

afterEach(() => vi.useRealTimers());

describe("todayIso", () => {
  it("returns the local date as yyyy-mm-dd", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 7, 15, 30)); // July 7 2026, 3:30pm local
    expect(todayIso()).toBe("2026-07-07");
  });

  it("pads single-digit months and days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5)); // Jan 5
    expect(todayIso()).toBe("2026-01-05");
  });

  it("uses local time, not UTC (late evening stays the same day)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 7, 23, 55)); // 11:55pm local
    expect(todayIso()).toBe("2026-07-07");
  });
});

describe("formatDue", () => {
  it("formats an ISO date as 'Mon D'", () => {
    expect(formatDue("2026-07-07")).toBe("Jul 7");
    expect(formatDue("2026-12-25")).toBe("Dec 25");
    expect(formatDue("2026-01-01")).toBe("Jan 1");
  });

  it("returns empty string for null", () => {
    expect(formatDue(null)).toBe("");
  });
});

describe("isOverdue", () => {
  it("is true strictly before today", () => {
    expect(isOverdue("2000-01-01")).toBe(true);
  });
  it("is false for today and later", () => {
    expect(isOverdue(TODAY)).toBe(false);
    expect(isOverdue("2999-12-31")).toBe(false);
  });
  it("is false for no due date", () => {
    expect(isOverdue(null)).toBe(false);
  });
});

describe("advanceDue (recurrence)", () => {
  it("daily advances one day", () => {
    expect(advanceDue("2026-07-07", "daily")).toBe("2026-07-08");
  });
  it("weekly advances seven days", () => {
    expect(advanceDue("2026-07-07", "weekly")).toBe("2026-07-14");
  });
  it("monthly advances one month", () => {
    expect(advanceDue("2026-07-07", "monthly")).toBe("2026-08-07");
  });
  it("rolls over month and year boundaries", () => {
    expect(advanceDue("2026-07-31", "daily")).toBe("2026-08-01");
    expect(advanceDue("2026-12-31", "daily")).toBe("2027-01-01");
    expect(advanceDue("2026-12-15", "monthly")).toBe("2027-01-15");
  });
  it("passes through when there's no recurrence or no date", () => {
    expect(advanceDue("2026-07-07", "none")).toBe("2026-07-07");
    expect(advanceDue(null, "weekly")).toBeNull();
  });
});

describe("timeAgo", () => {
  it("formats recent ISO timestamps relative to now", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-07T12:00:00Z");
    vi.setSystemTime(now);
    expect(timeAgo("2026-07-07T11:59:40Z")).toBe("just now");
    expect(timeAgo("2026-07-07T11:55:00Z")).toBe("5m ago");
    expect(timeAgo("2026-07-07T09:00:00Z")).toBe("3h ago");
    expect(timeAgo("2026-07-05T12:00:00Z")).toBe("2d ago");
  });

  it("passes legacy non-ISO strings through unchanged", () => {
    expect(timeAgo("just now")).toBe("just now");
    expect(timeAgo("2d ago")).toBe("2d ago");
  });
});

describe("initialsOf", () => {
  it("takes first letters of first two words", () => {
    expect(initialsOf("Derek Fox")).toBe("DF");
    expect(initialsOf("Justin Chevallier")).toBe("JC");
  });
  it("handles single names and blanks", () => {
    expect(initialsOf("Derek")).toBe("D");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("setUsers (live roster)", () => {
  const roster = (): User[] => [...users];

  it("replaces the roster in place so existing references see the change", () => {
    const ref = users; // simulate another module holding the array
    setUsers([
      { id: "u_derek", name: "Derek Fox", initials: "DF", color: "#a855f7", role: "admin" },
      { id: "abc-123", name: "Justin Chevallier", initials: "JC", color: "#a855f7", role: "admin" },
    ]);
    expect(ref).toHaveLength(2);
    expect(ref.find((u) => u.id === "abc-123")?.name).toBe("Justin Chevallier");
  });

  it("keeps the existing roster when handed an empty list (failed fetch)", () => {
    const before = roster();
    setUsers([]);
    expect(users).toEqual(before);
    expect(users.length).toBeGreaterThan(0);
  });
});

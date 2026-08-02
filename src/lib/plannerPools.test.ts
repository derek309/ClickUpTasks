import { describe, it, expect } from "vitest";
import { latestInviteStatus } from "./plannerPools";
import type { PlannerWeek, PlannerInvite } from "./data";

function week(overrides: Partial<PlannerWeek> & Pick<PlannerWeek, "week" | "invited">): PlannerWeek {
  return {
    id: "w_" + overrides.week, territoryId: "t_1", themeOverride: "", themeDescription: "",
    categories: [], notes: "", weatherNote: "", picks: {}, dismissed: [],
    supportLocalExcluded: [], supportLocalAdded: [], archived: false, sentDate: null,
    wpPushedAt: null, createdAt: overrides.week,
    ...overrides,
  };
}
const invite = (over: Partial<PlannerInvite> & Pick<PlannerInvite, "gdPlaceId" | "at">): PlannerInvite => ({ status: "invited", ...over });

describe("latestInviteStatus (cross-week 'what's true right now', vs inviteHistory's cumulative counts)", () => {
  it("returns the single invite entry for a business invited only once", () => {
    const weeks = [week({ week: "2026-07-01", invited: [invite({ gdPlaceId: 101, at: "2026-07-01T10:00:00.000Z" })] })];
    const result = latestInviteStatus(weeks);
    expect(result.get(101)).toEqual({ gdPlaceId: 101, at: "2026-07-01T10:00:00.000Z", status: "invited" });
  });

  it("picks the entry with the latest `at`, regardless of which week array order it's given in", () => {
    const older = invite({ gdPlaceId: 202, at: "2026-07-01T10:00:00.000Z", status: "invited" });
    const newer = invite({ gdPlaceId: 202, at: "2026-07-15T10:00:00.000Z", status: "accepted" });
    const weeksAscending = [week({ week: "2026-07-01", invited: [older] }), week({ week: "2026-07-15", invited: [newer] })];
    const weeksDescending = [week({ week: "2026-07-15", invited: [newer] }), week({ week: "2026-07-01", invited: [older] })];
    expect(latestInviteStatus(weeksAscending).get(202)?.status).toBe("accepted");
    expect(latestInviteStatus(weeksDescending).get(202)?.status).toBe("accepted");
  });

  it("keeps a resend's later 'invited' status even after an earlier 'skipped'", () => {
    const skipped = invite({ gdPlaceId: 303, at: "2026-07-01T10:00:00.000Z", status: "skipped" });
    const resent = invite({ gdPlaceId: 303, at: "2026-07-08T10:00:00.000Z", status: "invited" });
    const weeks = [week({ week: "2026-07-01", invited: [skipped] }), week({ week: "2026-07-08", invited: [resent] })];
    expect(latestInviteStatus(weeks).get(303)?.status).toBe("invited");
  });

  it("tracks multiple businesses independently and omits ones never invited", () => {
    const weeks = [week({ week: "2026-07-01", invited: [invite({ gdPlaceId: 1, at: "2026-07-01T10:00:00.000Z" }), invite({ gdPlaceId: 2, at: "2026-07-01T11:00:00.000Z", status: "accepted" })] })];
    const result = latestInviteStatus(weeks);
    expect(result.get(1)?.status).toBe("invited");
    expect(result.get(2)?.status).toBe("accepted");
    expect(result.get(999)).toBeUndefined();
  });

  it("returns an empty map for no weeks or weeks with no invites", () => {
    expect(latestInviteStatus([]).size).toBe(0);
    expect(latestInviteStatus([week({ week: "2026-07-01", invited: [] })]).size).toBe(0);
  });
});

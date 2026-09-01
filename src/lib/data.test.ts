import { describe, it, expect, vi, afterEach } from "vitest";
import {
  todayIso,
  formatDue,
  isOverdue,
  advanceDue,
  parseDaysOfMonth,
  daysBetween,
  mostRecentMonday,
  timeAgo,
  htmlToText,
  initialsOf,
  setUsers,
  users,
  clientHealth,
  normalizeState,
  playbookCompletionByCategory,
  PLAYBOOK_ALL_STEPS,
  applyWaitingStatusSync,
  mentionQuery,
  mentionCandidates,
  applyMention,
  mentionsUser,
  nthWeekdayOfMonth,
  daysUntilDue,
  windowBurn,
  isSnoozed,
  effectiveDueDate,
  prettyLinkName,
  linkSpans,
  splitQuotedEmail,
  addBusinessDaysIso,
  derivedPriority,
  effectivePriority,
  effectiveStatus,
  fillDay,
  buildPlan,
  isWeekend,
  taskHours,
  SIZE_META,
  googleLinkName,
  isUselessTitle,
  TASK_ACTION_ORDER,
  CLIENT_FACING_ACTIONS,
  recurrenceResetFields,
  startSignal,
  dueCountdown,
  describeRecurrence,
  TODAY,
  type User,
  type Task,
} from "./data";

afterEach(() => vi.useRealTimers());

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t_x", projectId: "p_x", clientId: "cl_x", title: "Task", description: "",
    status: "todo", priority: "none", assigneeId: null, contactId: null, due: null,
    recurrence: "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [], attachments: [],
    comments: [], createdAt: new Date().toISOString(),
    ...overrides,
  };
}

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
  it("custom day-of-month picks the next day in the same month", () => {
    expect(advanceDue("2026-07-01", "custom", undefined, "day-of-month", [1, 15])).toBe("2026-07-15");
  });
  it("custom day-of-month wraps to the first selected day next month", () => {
    expect(advanceDue("2026-07-15", "custom", undefined, "day-of-month", [1, 15])).toBe("2026-08-01");
  });
  it("custom day-of-month clamps a day that doesn't exist in the target month", () => {
    expect(advanceDue("2026-01-31", "custom", undefined, "day-of-month", [31])).toBe("2026-02-28");
  });
});

describe("daysBetween", () => {
  it("is positive when b is later than a", () => {
    expect(daysBetween("2026-07-01", "2026-07-08")).toBe(7);
  });
  it("is negative when b is earlier than a", () => {
    expect(daysBetween("2026-07-08", "2026-07-01")).toBe(-7);
  });
  it("is zero for the same date", () => {
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(0);
  });
  it("crosses a month boundary correctly", () => {
    expect(daysBetween("2026-07-31", "2026-08-02")).toBe(2);
  });
});

describe("mostRecentMonday", () => {
  it("returns the same date when given a Monday", () => {
    expect(mostRecentMonday("2026-07-13")).toBe("2026-07-13"); // Jul 13 2026 is a Monday
  });
  it("returns the prior Monday for a mid-week date", () => {
    expect(mostRecentMonday("2026-07-16")).toBe("2026-07-13"); // Thu -> Mon
  });
  it("returns the prior Monday for a Sunday", () => {
    expect(mostRecentMonday("2026-07-19")).toBe("2026-07-13"); // Sun -> that week's Mon
  });
});

describe("parseDaysOfMonth", () => {
  it("parses, dedupes, sorts, and drops out-of-range values", () => {
    expect(parseDaysOfMonth("15, 1, 1, 40, 0, abc")).toEqual([1, 15]);
  });
  it("returns an empty array for blank input", () => {
    expect(parseDaysOfMonth("")).toEqual([]);
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

describe("htmlToText", () => {
  // This file's vitest environment has no `document`, so every call here
  // exercises the server-side regex fallback specifically — the same path
  // hit by the waiting-page API route, where a link like "...?a=1&b=2" was
  // coming through as literal "&amp;" before entity decoding was added.
  it("strips tags and decodes common entities without a DOM", () => {
    expect(htmlToText("<p>Hi &amp; welcome</p>")).toBe("Hi & welcome");
    expect(htmlToText("a=1&amp;b=2")).toBe("a=1&b=2");
    expect(htmlToText("&lt;script&gt;")).toBe("<script>");
    expect(htmlToText("&quot;quoted&quot; &amp; it&#39;s fine")).toBe("\"quoted\" & it's fine");
  });
  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
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

describe("clientHealth", () => {
  it("is danger when any non-done task is overdue", () => {
    const tasks = [mkTask({ clientId: "cl_a", due: "2000-01-01", status: "todo" })];
    expect(clientHealth("cl_a", tasks)).toBe("danger");
  });

  it("ignores overdue tasks that are already done", () => {
    const tasks = [mkTask({ clientId: "cl_a", due: "2000-01-01", status: "done", createdAt: new Date().toISOString() })];
    expect(clientHealth("cl_a", tasks)).toBe("calm");
  });

  it("is calm when the client has no tasks", () => {
    expect(clientHealth("cl_a", [])).toBe("calm");
  });

  it("is stale when the only activity is 30+ days old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:00:00Z"));
    const tasks = [mkTask({ clientId: "cl_a", due: null, createdAt: "2026-05-01T00:00:00Z" })];
    expect(clientHealth("cl_a", tasks)).toBe("stale");
  });

  it("is calm when activity is recent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:00:00Z"));
    const tasks = [mkTask({ clientId: "cl_a", due: null, createdAt: "2026-07-06T00:00:00Z" })];
    expect(clientHealth("cl_a", tasks)).toBe("calm");
  });

  it("counts a comment/event timestamp as activity, not just createdAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:00:00Z"));
    const tasks = [mkTask({
      clientId: "cl_a", due: null, createdAt: "2026-01-01T00:00:00Z",
      comments: [{ id: "cm_1", authorId: "u_derek", body: "moved status", at: "2026-07-06T00:00:00Z", kind: "event" }],
    })];
    expect(clientHealth("cl_a", tasks)).toBe("calm");
  });

  it("danger beats stale when both conditions apply", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:00:00Z"));
    const tasks = [mkTask({ clientId: "cl_a", due: "2000-01-01", status: "todo", createdAt: "2026-01-01T00:00:00Z" })];
    expect(clientHealth("cl_a", tasks)).toBe("danger");
  });

  it("only considers tasks belonging to the given client", () => {
    const tasks = [mkTask({ clientId: "cl_other", due: "2000-01-01", status: "todo" })];
    expect(clientHealth("cl_a", tasks)).toBe("calm");
  });
});

describe("playbookCompletionByCategory", () => {
  it("totals every category to the full catalog count when nothing is done", () => {
    const cats = playbookCompletionByCategory("cl_a", []);
    const totals = Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v.total]));
    const expected = { branding: 0, reputation: 0, presence: 0, income: 0 };
    for (const step of PLAYBOOK_ALL_STEPS) expected[step.category] += 1;
    expect(totals).toEqual(expected);
    expect(Object.values(cats).every((v) => v.done === 0)).toBe(true);
  });

  it("counts a done task only toward its own step's category", () => {
    const step = PLAYBOOK_ALL_STEPS.find((s) => s.key === "complete_listing")!; // category: branding
    const tasks = [mkTask({ clientId: "cl_a", status: "done", playbookStepKey: step.key })];
    const cats = playbookCompletionByCategory("cl_a", tasks);
    expect(cats.branding.done).toBe(1);
    expect(cats.reputation.done).toBe(0);
    expect(cats.presence.done).toBe(0);
    expect(cats.income.done).toBe(0);
  });

  it("ignores tasks from other clients", () => {
    const step = PLAYBOOK_ALL_STEPS.find((s) => s.key === "complete_listing")!;
    const tasks = [mkTask({ clientId: "cl_other", status: "done", playbookStepKey: step.key })];
    const cats = playbookCompletionByCategory("cl_a", tasks);
    expect(cats.branding.done).toBe(0);
  });

  it("ignores non-playbook tasks and not-done playbook tasks", () => {
    const step = PLAYBOOK_ALL_STEPS.find((s) => s.key === "connect_gbp")!; // category: reputation
    const tasks = [
      mkTask({ clientId: "cl_a", status: "done", playbookStepKey: null }),
      mkTask({ clientId: "cl_a", status: "todo", playbookStepKey: step.key }),
    ];
    const cats = playbookCompletionByCategory("cl_a", tasks);
    expect(cats.reputation.done).toBe(0);
  });
});

describe("applyWaitingStatusSync", () => {
  it("moving status to waiting sets waitingOnClient and clears the assignee", () => {
    const before = { status: "todo" as const, waitingOnClient: false };
    expect(applyWaitingStatusSync(before, { status: "waiting" })).toEqual({ waitingOnClient: true, assigneeId: null });
  });

  it("moving status to waiting respects an explicit assigneeId already in the patch", () => {
    const before = { status: "todo" as const, waitingOnClient: false };
    expect(applyWaitingStatusSync(before, { status: "waiting", assigneeId: "u_x" })).toEqual({ waitingOnClient: true });
  });

  it("moving status away from waiting clears waitingOnClient", () => {
    const before = { status: "waiting" as const, waitingOnClient: true };
    expect(applyWaitingStatusSync(before, { status: "done" })).toEqual({ waitingOnClient: false });
  });

  it("setting waitingOnClient true directly (no explicit status) sets status to waiting", () => {
    const before = { status: "todo" as const, waitingOnClient: false };
    expect(applyWaitingStatusSync(before, { waitingOnClient: true })).toEqual({ status: "waiting", assigneeId: null });
  });

  it("clearing waitingOnClient while status was waiting advances status to review", () => {
    const before = { status: "waiting" as const, waitingOnClient: true };
    expect(applyWaitingStatusSync(before, { waitingOnClient: false, assigneeId: "u_x" })).toEqual({ status: "review" });
  });

  it("clearing waitingOnClient when status wasn't waiting does nothing extra", () => {
    const before = { status: "todo" as const, waitingOnClient: false };
    expect(applyWaitingStatusSync(before, { waitingOnClient: false })).toEqual({});
  });

  it("an unrelated patch (e.g. just a due-date change) is a no-op", () => {
    const before = { status: "todo" as const, waitingOnClient: false };
    expect(applyWaitingStatusSync(before, { due: "2026-08-01" })).toEqual({});
  });
});

describe("normalizeState", () => {
  it("maps a full state name to its 2-letter abbreviation", () => {
    expect(normalizeState("California")).toBe("CA");
  });
  it("is case-insensitive on the full name", () => {
    expect(normalizeState("california")).toBe("CA");
    expect(normalizeState("CALIFORNIA")).toBe("CA");
  });
  it("uppercases an already-abbreviated state", () => {
    expect(normalizeState("ca")).toBe("CA");
    expect(normalizeState("CA")).toBe("CA");
  });
  it("passes through unrecognized values uppercased, rather than throwing", () => {
    expect(normalizeState("Dallas")).toBe("DALLAS");
  });
});

describe("@mentions", () => {
  const roster = [
    { id: "u_derek", name: "Derek Fox", initials: "DF", color: "#a855f7", role: "admin" as const },
    { id: "u_mich", name: "Michaella Pastrana", initials: "MP", color: "#0ea5e9", role: "va" as const },
    { id: "u_sam", name: "Sam", initials: "S", color: "#22c55e", role: "admin" as const },
  ];

  it("opens on a half-typed name at the end of the draft", () => {
    expect(mentionQuery("@mich")).toBe("mich");
    expect(mentionQuery("look at this @mich")).toBe("mich");
    expect(mentionQuery("@")).toBe("");
  });

  it("stays shut mid-email-address and mid-sentence", () => {
    expect(mentionQuery("derek@")).toBeNull();
    expect(mentionQuery("me@clickuplocal.com")).toBeNull();
    expect(mentionQuery("@mich can you look")).toBeNull();
  });

  it("matches teammates case-insensitively on the typed fragment", () => {
    expect(mentionCandidates("@mich", roster).map((u) => u.name)).toEqual(["Michaella Pastrana"]);
    expect(mentionCandidates("@PASTRANA", roster).map((u) => u.name)).toEqual(["Michaella Pastrana"]);
    expect(mentionCandidates("@", roster)).toHaveLength(3);
    expect(mentionCandidates("no mention here", roster)).toEqual([]);
  });

  it("leaves the author out of their own picker", () => {
    expect(mentionCandidates("@", roster, "u_derek").map((u) => u.name)).not.toContain("Derek Fox");
  });

  it("completes to the full name, keeping preceding text and adding a trailing space", () => {
    expect(applyMention("@mich", "Michaella Pastrana")).toBe("@Michaella Pastrana ");
    expect(applyMention("hey @mich", "Michaella Pastrana")).toBe("hey @Michaella Pastrana ");
  });

  it("notifies on a full name in any casing", () => {
    expect(mentionsUser("@Michaella Pastrana can you take this", "Michaella Pastrana")).toBe(true);
    expect(mentionsUser("@michaella pastrana can you take this", "Michaella Pastrana")).toBe(true);
    expect(mentionsUser("thanks @Michaella Pastrana", "Michaella Pastrana")).toBe(true);
  });

  it("does not notify on a bare first name — that is what the picker is for", () => {
    expect(mentionsUser("@michaella can you take this", "Michaella Pastrana")).toBe(false);
  });

  it("does not let a longer name notify the shorter one it starts with", () => {
    expect(mentionsUser("@Samantha Reed took it", "Sam")).toBe(false);
    expect(mentionsUser("@Sam took it", "Sam")).toBe(true);
  });
});

describe("nth weekday of month", () => {
  // August 2026 starts on a Saturday. Mondays: 3, 10, 17, 24, 31.
  it("finds the nth Monday", () => {
    expect(nthWeekdayOfMonth(2026, 7, 1, 1)).toBe(3);
    expect(nthWeekdayOfMonth(2026, 7, 1, 3)).toBe(17);
    expect(nthWeekdayOfMonth(2026, 7, 1, 4)).toBe(24);
  });
  it("finds the last one, which is not always the 4th", () => {
    expect(nthWeekdayOfMonth(2026, 7, 1, -1)).toBe(31); // 5 Mondays in Aug 2026
    expect(nthWeekdayOfMonth(2026, 8, 1, -1)).toBe(28); // 4 Mondays in Sep 2026
  });
  it("returns null when that occurrence doesn't exist", () => {
    expect(nthWeekdayOfMonth(2026, 8, 1, 5)).toBeNull(); // no 5th Monday in Sep
  });
  it("handles a month that begins on the target weekday", () => {
    // June 2026 starts on a Monday.
    expect(nthWeekdayOfMonth(2026, 5, 1, 1)).toBe(1);
    expect(nthWeekdayOfMonth(2026, 5, 1, 3)).toBe(15);
  });
  it("handles February in a leap year", () => {
    expect(nthWeekdayOfMonth(2028, 1, 1, -1)).toBe(28); // Feb 2028 has 29 days
  });
});

describe("advanceDue for the nth weekday", () => {
  const third = (iso: string) => advanceDue(iso, "custom", undefined, "nth-weekday", undefined, 3, 1);
  it("moves to next month once this month's has passed", () => {
    expect(third("2026-08-17")).toBe("2026-09-21"); // 3rd Mon of Sep 2026
  });
  it("stays in this month when the occurrence is still ahead", () => {
    expect(third("2026-08-05")).toBe("2026-08-17");
  });
  it("rolls the year over from December", () => {
    expect(third("2026-12-21")).toBe("2027-01-18");
  });
  it("never returns a date on or before the one it was given", () => {
    for (const d of ["2026-08-01", "2026-08-17", "2026-08-31", "2026-02-28", "2026-12-31"]) {
      const next = third(d);
      expect(next, `from ${d}`).not.toBeNull();
      expect(next! > d, `${next} should be after ${d}`).toBe(true);
    }
  });
  it("always lands on the right weekday", () => {
    let cur = "2026-01-05";
    for (let i = 0; i < 24; i++) {
      cur = third(cur)!;
      const [y, m, d] = cur.split("-").map(Number);
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), cur).toBe(1);
    }
  });
  it("handles the last-weekday rule across a short month", () => {
    const lastFri = (iso: string) => advanceDue(iso, "custom", undefined, "nth-weekday", undefined, -1, 5);
    expect(lastFri("2026-01-30")).toBe("2026-02-27");
  });
});

describe("describeRecurrence for the nth weekday", () => {
  it("reads the way someone would say it", () => {
    expect(describeRecurrence("custom", undefined, "nth-weekday", undefined, 3, 1)).toBe("Monthly on the 3rd Monday");
    expect(describeRecurrence("custom", undefined, "nth-weekday", undefined, 1, 2)).toBe("Monthly on the 1st Tuesday");
    expect(describeRecurrence("custom", undefined, "nth-weekday", undefined, -1, 5)).toBe("Monthly on the last Friday");
  });
});

describe("due countdown", () => {
  const today = "2026-08-28";
  it("counts whole days either side of today", () => {
    expect(daysUntilDue("2026-08-28", today)).toBe(0);
    expect(daysUntilDue("2026-08-29", today)).toBe(1);
    expect(daysUntilDue("2026-09-04", today)).toBe(7);
    expect(daysUntilDue("2026-08-27", today)).toBe(-1);
    expect(daysUntilDue(null, today)).toBeNull();
  });
  it("crosses a month boundary without drifting", () => {
    expect(daysUntilDue("2026-09-01", "2026-08-31")).toBe(1);
    expect(daysUntilDue("2026-03-01", "2026-02-28")).toBe(1);
    expect(daysUntilDue("2028-03-01", "2028-02-28")).toBe(2); // 2028 is a leap year
  });
  it("reads the way someone would say it", () => {
    expect(dueCountdown("2026-08-28", today)).toBe("due today");
    expect(dueCountdown("2026-08-29", today)).toBe("1 day left");
    expect(dueCountdown("2026-09-01", today)).toBe("4 days left");
    expect(dueCountdown("2026-08-25", today)).toBe("3d late");
    expect(dueCountdown(null, today)).toBe("");
  });
  it("switches to months once days stop being a readable quantity", () => {
    expect(dueCountdown("2026-10-27", today)).toBe("60 days left");   // still days at the boundary
    expect(dueCountdown("2026-10-28", today)).toBe("2 months left");  // one past it
    expect(dueCountdown("2027-03-28", today)).toBe("7 months left");
  });
  it("keeps counting however far out the date is", () => {
    for (const d of ["2026-09-30", "2026-12-25", "2027-06-01", "2029-01-01"]) {
      expect(dueCountdown(d, today), d).not.toBe("");
    }
  });
});

describe("window burn and the start signal", () => {
  const today = "2026-08-28";
  const T = (createdAt: string, due: string | null, status: "todo" | "in_progress" | "done" = "todo") =>
    ({ createdAt, due, status } as { createdAt: string; due: string | null; status: import("./data").TaskStatus });

  it("measures how much of the window is gone", () => {
    expect(windowBurn("2026-08-18", "2026-08-28", today)).toBe(1);    // day 10 of 10
    expect(windowBurn("2026-08-18", "2026-09-07", today)).toBe(0.5);  // day 10 of 20
    expect(windowBurn("2026-08-27", "2026-09-26", today)).toBeCloseTo(1 / 30, 5);
    expect(windowBurn("2026-08-18", null, today)).toBeNull();
  });
  it("treats a same-day or inverted window as fully burnt rather than dividing by zero", () => {
    expect(windowBurn("2026-08-28", "2026-08-28", today)).toBe(1);
    expect(windowBurn("2026-08-28", "2026-08-20", today)).toBe(1); // due before created — 7 of these exist
  });

  it("says start now once most of the window is gone and nothing has begun", () => {
    // 30-day window, day 25 — past the 0.7 threshold
    expect(startSignal(T("2026-08-03", "2026-09-02"), today).level).toBe("start");
  });
  it("stays quiet early in the window", () => {
    expect(startSignal(T("2026-08-27", "2026-09-26"), today).level).toBe("none");
  });
  // Superseded: started work used to be silent, and a task sitting in Progress
  // at 95% of its window got no warning at all. It now says "Wrap up".
  it("switches from Start now to Wrap up once the work has actually started", () => {
    expect(startSignal(T("2026-08-03", "2026-09-02", "in_progress"), today)).toEqual({ level: "wrap", label: "Wrap up" });
    expect(startSignal(T("2026-08-03", "2026-09-02", "done"), today).level).toBe("none");
  });
  it("calls out overdue work that was never started", () => {
    expect(startSignal(T("2026-08-01", "2026-08-25"), today)).toEqual({ level: "late", label: "Not started" });
  });
  it("never fires without a due date — there is nothing to be late for", () => {
    expect(startSignal(T("2026-01-01", null), today).level).toBe("none");
  });
});

describe("follow-up date", () => {
  const today = "2026-08-28";
  it("is a snooze only while it's still ahead", () => {
    expect(isSnoozed({ followUpAt: "2026-09-02" }, today)).toBe(true);
    expect(isSnoozed({ followUpAt: "2026-08-28" }, today)).toBe(false); // today is the day it came back
    expect(isSnoozed({ followUpAt: "2026-08-20" }, today)).toBe(false);
    expect(isSnoozed({ followUpAt: null }, today)).toBe(false);
    expect(isSnoozed({}, today)).toBe(false);
  });
  it("orders by the follow-up while snoozed, and never overwrites the due date", () => {
    const t = { due: "2026-08-26", followUpAt: "2026-09-02" };
    expect(effectiveDueDate(t)).toBe("2026-09-02");
    expect(t.due).toBe("2026-08-26"); // the promise is still on record
  });
  // Superseded: an arrived follow-up used to hand the task back to its due
  // date. It now stays the date the task is judged on, which is what makes a
  // follow-up worth setting at all.
  it("keeps using the follow-up once it has arrived, and the due date without one", () => {
    expect(effectiveDueDate({ due: "2026-08-26", followUpAt: "2026-08-28" })).toBe("2026-08-28");
    expect(effectiveDueDate({ due: "2026-08-26", followUpAt: null })).toBe("2026-08-26");
  });
  it("does not tell you to start something you're waiting on", () => {
    // Overdue and untouched, but snoozed until next week — silent.
    const snoozed = { createdAt: "2026-08-01", due: "2026-08-26", status: "todo" as const, followUpAt: "2026-09-02" };
    expect(startSignal(snoozed, today).level).toBe("none");
    // Same task once the follow-up lands — back to shouting.
    expect(startSignal({ ...snoozed, followUpAt: "2026-08-28" }, today).level).toBe("late");
  });
});

describe("effectiveDueDate with a follow-up but no due date", () => {
  it("uses the follow-up date while it is still in the future", () => {
    expect(effectiveDueDate({ due: null, followUpAt: "2026-09-05" })).toBe("2026-09-05");
  });
  it("still uses it on the day it arrives, instead of going undated", () => {
    expect(effectiveDueDate({ due: null, followUpAt: "2026-09-05" })).toBe("2026-09-05");
  });
  it("keeps surfacing a follow-up that has passed", () => {
    expect(effectiveDueDate({ due: null, followUpAt: "2026-08-20" })).toBe("2026-08-20");
  });
  // Superseded: the due date used to win back once a follow-up had passed.
  // A follow-up now trumps the due date whenever one is set, in both
  // directions, so an expired follow-up keeps surfacing rather than handing
  // the task back to a due date a month out.
  it("keeps using an expired follow-up over a far-off due date", () => {
    expect(effectiveDueDate({ due: "2026-09-30", followUpAt: "2026-08-20" })).toBe("2026-08-20");
  });
  it("surfaces a task whose follow-up is today but is not due for a week", () => {
    expect(effectiveDueDate({ due: "2026-09-04", followUpAt: "2026-08-28" })).toBe("2026-08-28");
  });
  it("is genuinely undated with neither", () => {
    expect(effectiveDueDate({ due: null, followUpAt: null })).toBeNull();
  });
});

describe("startSignal across stages", () => {
  // 10 day window, day 9 of 10, so burn is 90% and past the 70% threshold.
  const burning = { createdAt: "2026-08-19T09:00:00Z", due: "2026-08-29" };
  const today = "2026-08-28";
  const early = { createdAt: "2026-08-19T09:00:00Z", due: "2026-10-30" };

  it("says Start now on unstarted work with the runway nearly gone", () => {
    expect(startSignal({ ...burning, status: "todo" }, today)).toEqual({ level: "start", label: "Start now" });
  });
  it("says Wrap up once the work is underway", () => {
    for (const status of ["in_progress", "review", "changes_requested"] as const) {
      expect(startSignal({ ...burning, status }, today)).toEqual({ level: "wrap", label: "Wrap up" });
    }
  });
  it("stays quiet on Waiting, where neither instruction is actionable", () => {
    expect(startSignal({ ...burning, status: "waiting" }, today).level).toBe("none");
  });
  it("stays quiet on Done", () => {
    expect(startSignal({ ...burning, status: "done" }, today).level).toBe("none");
  });
  it("says Not started when To do work runs past due", () => {
    expect(startSignal({ ...burning, due: "2026-08-26", status: "todo" }, today)).toEqual({ level: "late", label: "Not started" });
  });
  it("does not repeat lateness on started work, which the due chip already shows", () => {
    expect(startSignal({ ...burning, due: "2026-08-26", status: "in_progress" }, today).level).toBe("none");
  });
  it("stays quiet early in the window at every stage", () => {
    for (const status of ["todo", "in_progress", "review", "changes_requested"] as const) {
      expect(startSignal({ ...early, status }, today).level).toBe("none");
    }
  });
  it("stays quiet while snoozed, whatever the stage", () => {
    expect(startSignal({ ...burning, status: "in_progress", followUpAt: "2026-09-10" }, today).level).toBe("none");
  });
  it("stays quiet with no due date", () => {
    expect(startSignal({ createdAt: "2026-08-19T09:00:00Z", due: null, status: "in_progress" }, today).level).toBe("none");
  });
});

describe("a new occurrence of a recurring task", () => {
  it("starts its window at the previous due date, not the original creation", () => {
    // A monthly task first created in January, now rolling from Sep 1 to
    // Oct 1. Inheriting January made the bar read "233 of 237 days used" and
    // pin "Start now" on every recurring task, forever.
    const reset = recurrenceResetFields("2026-09-01");
    expect(reset.createdAt.slice(0, 10)).toBe("2026-09-01");
    expect(startSignal({ createdAt: reset.createdAt, due: "2026-10-01", status: "todo" }, "2026-09-03").level).toBe("none");
  });
  it("still warns near the end of its own cycle", () => {
    const reset = recurrenceResetFields("2026-09-01");
    expect(startSignal({ createdAt: reset.createdAt, due: "2026-10-01", status: "todo" }, "2026-09-25").label).toBe("Start now");
  });
  it("drops last cycle's follow-up date", () => {
    expect(recurrenceResetFields("2026-09-01").followUpAt).toBeNull();
  });
  it("falls back to now when there was no due date to advance from", () => {
    expect(recurrenceResetFields(null, "2026-09-01T12:00:00.000Z").createdAt).toBe("2026-09-01T12:00:00.000Z");
  });
});

describe("prettyLinkName", () => {
  it("turns a slug into a title", () => {
    expect(prettyLinkName("https://scribehow.com/o/dVGrWG/viewer/Publishing_Local_Events_via_ClickUpLocal_Ambassador_Portal"))
      .toBe("Publishing Local Events via ClickUpLocal Ambassador Portal");
  });
  it("skips a shouty order id and keeps looking", () => {
    expect(prettyLinkName("https://www.fiverr.com/orders/FO62A175F5FC6")).toBe("Orders");
  });
  it("skips an id segment and keeps looking", () => {
    expect(prettyLinkName("https://example.com/how-to-fix-the-thing/a1b2c3d4e5f6a7b8")).toBe("How to fix the thing");
  });
  it("falls back to the host when the path is all ids", () => {
    expect(prettyLinkName("https://www.clickuplocal.com/?tab=events&city=lincoln")).toBe("clickuplocal.com");
  });
  it("does not throw on junk", () => {
    expect(prettyLinkName("not a url at all")).toBeTruthy();
  });
});

describe("what someone without client-messaging permission can do", () => {
  const visible = TASK_ACTION_ORDER.filter((k) => !CLIENT_FACING_ACTIONS.has(k));

  it("hides every way of reaching the client", () => {
    expect(visible).not.toContain("email");
    expect(visible).not.toContain("sms");
    expect(visible).not.toContain("chat");
    expect(visible).not.toContain("call");
    expect(visible).not.toContain("meeting"); // booking one is an invitation
  });
  it("keeps the internal half", () => {
    expect(visible).toEqual(["note", "team", "met"]);
  });
  // A VA who sat in on a call still has to be able to write down what was
  // decided, so logging a meeting that happened is not an outbound action.
  it("still lets them log a meeting that already happened", () => {
    expect(CLIENT_FACING_ACTIONS.has("met")).toBe(false);
  });
});

describe("linkSpans", () => {
  const hrefs = (t: string) => linkSpans(t).map((l) => l.href);

  it("finds a full URL", () => {
    expect(hrefs("see https://pro.fiverr.com/mk/do-designs now")).toEqual(["https://pro.fiverr.com/mk/do-designs"]);
  });
  it("finds a scheme-less link, which older entries stored", () => {
    expect(hrefs('renamed from "app.clickuplocal.com/v2/location/7B0Y/payments" to "Invoice"'))
      .toEqual(["https://app.clickuplocal.com/v2/location/7B0Y/payments"]);
  });
  it("leaves ordinary prose alone", () => {
    expect(hrefs("Call Brian, e.g. tomorrow, re: BibBoards Inc. and the 3.5 inch card")).toEqual([]);
  });
  it("does not swallow the sentence's full stop", () => {
    expect(hrefs("see foo.com/a.")).toEqual(["https://foo.com/a"]);
  });
  it("finds several in one line", () => {
    expect(hrefs("https://a.com/x and b.com/y")).toEqual(["https://a.com/x", "https://b.com/y"]);
  });
  it("reports spans that line up with the text", () => {
    const t = "go to https://x.com/a ok";
    const [span] = linkSpans(t);
    expect(t.slice(span.start, span.end)).toBe("https://x.com/a");
  });
});

describe("naming a Google link", () => {
  it("says what a Drive folder is, since its real name needs Drive auth", () => {
    expect(prettyLinkName("https://drive.google.com/drive/folders/1AbC_dEfG")).toBe("Google Drive folder");
  });
  it("distinguishes the document types", () => {
    expect(googleLinkName("https://docs.google.com/document/d/1x/edit")).toBe("Google Doc");
    expect(googleLinkName("https://docs.google.com/spreadsheets/d/1x/edit")).toBe("Google Sheet");
    expect(googleLinkName("https://docs.google.com/presentation/d/1x/edit")).toBe("Google Slides");
  });
  it("leaves everything else to the normal naming", () => {
    expect(googleLinkName("https://pro.fiverr.com/mk/do-designs")).toBeNull();
    expect(prettyLinkName("https://pro.fiverr.com/mk/do-designs")).toBe("Do designs");
  });
});

describe("titles that tell you nothing", () => {
  it("rejects a login interstitial", () => {
    // The exact title Drive hands back for a folder we cannot read.
    expect(isUselessTitle("Open")).toBe(true);
    expect(isUselessTitle("Sign in - Google Accounts")).toBe(true);
    expect(isUselessTitle("  redirecting  ")).toBe(true);
    expect(isUselessTitle("")).toBe(true);
  });
  it("keeps a real one", () => {
    expect(isUselessTitle("Publishing Local Events via the Ambassador Portal")).toBe(false);
  });
});

describe("splitQuotedEmail", () => {
  it("keeps the reply and hides the thread under it", () => {
    const body = [
      "I edited it . Its ready.", "", "Brian", "",
      "August 31 at 2:32 PM, Derek Fox <derek@clickuplocal.com> wrote:",
      "Hi Brian,", "September's Race Directors email is ready.",
    ].join("\n");
    const { visible, quoted } = splitQuotedEmail(body);
    expect(visible).toBe("I edited it . Its ready.\n\nBrian");
    expect(quoted).toContain("September's Race Directors email is ready.");
  });
  it("handles the On ... wrote: shape", () => {
    const { visible } = splitQuotedEmail("Sounds good.\n\nOn Mon, 1 Sep 2026 at 14:32, Derek <d@x.com> wrote:\nthe original");
    expect(visible).toBe("Sounds good.");
  });
  it("collapses the runs of blank lines that eat the height", () => {
    expect(splitQuotedEmail("one\n\n\n\n\ntwo").visible).toBe("one\n\ntwo");
  });
  it("cuts at an Outlook header block with no wrote: line", () => {
    expect(splitQuotedEmail("Thanks!\n\nFrom: Derek\nSent: Monday\nbody").visible).toBe("Thanks!");
  });
  it("leaves an email with no quoted chain alone", () => {
    expect(splitQuotedEmail("Just a short note.").quoted).toBe("");
  });
});

describe("addBusinessDaysIso", () => {
  // 2026-09-01 is a Tuesday.
  it("counts plain weekdays", () => {
    expect(addBusinessDaysIso("2026-09-01", 3)).toBe("2026-09-04"); // Tue -> Fri
  });
  it("steps over the weekend", () => {
    expect(addBusinessDaysIso("2026-09-03", 3)).toBe("2026-09-08"); // Thu -> Tue
  });
  it("never lands on a Saturday or Sunday", () => {
    for (let start = 1; start <= 28; start++) {
      const iso = `2026-09-${String(start).padStart(2, "0")}`;
      for (const n of [1, 2, 3, 5, 10]) {
        const dow = new Date(`${addBusinessDaysIso(iso, n)}T12:00:00Z`).getUTCDay();
        expect(dow).not.toBe(0);
        expect(dow).not.toBe(6);
      }
    }
  });
});

describe("priority from the due date", () => {
  const today = "2026-09-01";
  it("is none with no date, urgent inside three days, normal beyond", () => {
    expect(derivedPriority(null, today)).toBe("none");
    expect(derivedPriority("2026-09-01", today)).toBe("urgent");   // today
    expect(derivedPriority("2026-09-04", today)).toBe("urgent");   // 3 days
    expect(derivedPriority("2026-09-05", today)).toBe("normal");   // 4 days
    expect(derivedPriority("2026-08-28", today)).toBe("urgent");   // overdue
  });
  it("follows the date while the task is on automatic", () => {
    expect(effectivePriority({ priority: "none", due: "2026-09-02", priorityAuto: true }, today)).toBe("urgent");
  });
  it("keeps a hand-set priority forever", () => {
    // The whole point of the flag: an overdue task someone deliberately
    // called Normal stays Normal.
    expect(effectivePriority({ priority: "normal", due: "2026-08-20", priorityAuto: false }, today)).toBe("normal");
  });
  it("never overrides the system-assigned priorities", () => {
    expect(effectivePriority({ priority: "client_request", due: "2026-08-20", priorityAuto: true }, today)).toBe("client_request");
    expect(effectivePriority({ priority: "conversation", due: null, priorityAuto: true }, today)).toBe("conversation");
  });
  it("treats a task with no flag as hand-set, which is what every existing row is", () => {
    expect(effectivePriority({ priority: "none", due: "2026-09-02" }, today)).toBe("none");
  });
});

describe("moving into Get started as the date closes in", () => {
  const today = "2026-09-01";

  it("promotes a To do task inside three days", () => {
    expect(effectiveStatus({ status: "todo", due: "2026-09-03" }, today)).toBe("get_started");
    expect(effectiveStatus({ status: "todo", due: "2026-08-20" }, today)).toBe("get_started"); // overdue
  });
  it("leaves a To do task that is still far out", () => {
    expect(effectiveStatus({ status: "todo", due: "2026-09-30" }, today)).toBe("todo");
    expect(effectiveStatus({ status: "todo", due: null }, today)).toBe("todo");
  });
  it("never touches a stage someone has already moved past To do", () => {
    for (const status of ["in_progress", "review", "changes_requested", "waiting", "approved", "done"] as const) {
      expect(effectiveStatus({ status, due: "2026-09-01" }, today)).toBe(status);
    }
  });
  it("leaves parked work alone: it is waiting on purpose, not late to start", () => {
    expect(effectiveStatus({ status: "todo", due: "2026-09-02", followUpAt: "2026-09-20" }, today)).toBe("todo");
  });
  it("uses the follow-up date when that is what the task is judged on", () => {
    // A follow-up still in the future is a snooze, handled above. Once it
    // arrives, it is the date the task is judged on and it counts.
    expect(effectiveStatus({ status: "todo", due: null, followUpAt: "2026-09-01" }, today)).toBe("get_started");
    expect(effectiveStatus({ status: "todo", due: null, followUpAt: "2026-08-25" }, today)).toBe("get_started");
  });
});

describe("filling a day", () => {
  const t = (size: "quick" | "hour" | "half" | "full" | "multi" | null) => ({ size });

  it("sizes an unsized task rather than treating it as free", () => {
    expect(taskHours({ size: null })).toBe(3);
    expect(taskHours({ size: "quick" })).toBe(0.25);
  });
  it("stops where the day runs out and marks the rest", () => {
    const { planned, usedHours, overflowAt } = fillDay([t("full"), t("half"), t("quick")], 6);
    expect(planned.map((p) => p.fits)).toEqual([true, false, false]);
    expect(usedHours).toBe(6);
    expect(overflowAt).toBe(1);
  });
  it("packs what does fit", () => {
    const { planned, usedHours, overflowAt } = fillDay([t("hour"), t("half"), t("quick")], 6);
    expect(planned.every((p) => p.fits)).toBe(true);
    expect(usedHours).toBe(4.25);
    expect(overflowAt).toBeNull();
  });
  // Otherwise the biggest, most urgent thing on the list is the one thing the
  // plan never shows you.
  it("always shows a task bigger than the whole day", () => {
    const { planned, overflowAt } = fillDay([t("multi"), t("quick")], 3);
    expect(planned[0].fits).toBe(true);
    expect(overflowAt).toBe(1);
  });
  it("returns the overflow rather than dropping it", () => {
    const { planned } = fillDay([t("full"), t("full"), t("full")], 6);
    expect(planned).toHaveLength(3);
  });
  it("counts a multi-day as a full day, so the rest of the week is not free", () => {
    expect(SIZE_META.multi.hours).toBe(SIZE_META.full.hours);
  });
});

describe("laying work across the week", () => {
  const t = (id: string, size: "quick" | "hour" | "half" | "full" | null) => ({ id, size });
  const tue = "2026-09-01"; // a Tuesday

  it("rolls what does not fit into the next day", () => {
    const plan = buildPlan([t("a", "full"), t("b", "full"), t("c", "quick")], 6, 3, tue);
    expect(plan[0].planned.map((p) => p.task.id)).toEqual(["a"]);
    expect(plan[1].planned.map((p) => p.task.id)).toEqual(["b"]);
    expect(plan[2].planned.map((p) => p.task.id)).toEqual(["c"]);
  });
  it("skips the weekend", () => {
    const plan = buildPlan([t("a", "full"), t("b", "full"), t("c", "full")], 6, 3, "2026-09-04"); // Friday
    expect(plan.map((d) => d.date)).toEqual(["2026-09-04", "2026-09-07", "2026-09-08"]);
    expect(plan.every((d) => !isWeekend(d.date))).toBe(true);
  });
  it("starts on Monday when asked on a Saturday", () => {
    expect(buildPlan([t("a", "quick")], 6, 1, "2026-09-05")[0].date).toBe("2026-09-07");
  });
  it("pads the remaining days as free rather than omitting them", () => {
    const plan = buildPlan([t("a", "quick")], 6, 4, tue);
    expect(plan).toHaveLength(4);
    expect(plan.slice(1).every((d) => d.planned.length === 0 && d.usedHours === 0)).toBe(true);
  });
  it("never loses a task", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const plan = buildPlan(ids.map((i) => t(i, "half")), 6, 5, tue);
    expect(plan.flatMap((d) => d.planned.map((p) => p.task.id)).sort()).toEqual(ids);
  });
});

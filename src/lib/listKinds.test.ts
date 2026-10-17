import { describe, expect, it } from "vitest";
import {
  businessDaysBefore, isFinished, listKind, listPlan, makeNextRound, missesEnd, nextDueOf, nextGoesOut, nextRoundGoesOut, nthWeekday,
  planLine, progress, rhythmSentence, roundDates, roundGoesOut, roundId, roundRow, roundStart, roundTitle, type RecipeStep, type RoundStore,
} from "../../mcp/listKinds.mjs";
import { groupQueue, needsBy, queueMove, queuePromotions, queueSettings, POS_STEP, PULL_DAYS, type QTask } from "../../mcp/queue.mjs";

describe("listPlan", () => {
  it("is holds work when the plan is missing, null or unreadable", () => {
    expect(listKind(undefined)).toBe("holds");
    expect(listKind(null)).toBe("holds");
    expect(listKind("finishes")).toBe("holds");
    expect(listKind({ kind: "something else" })).toBe("holds");
    expect(listPlan({})).toEqual({ kind: "holds" });
  });
  it("reads a finishing list's end date, and drops a bad one", () => {
    expect(listPlan({ kind: "finishes", endsOn: "2027-02-26" })).toEqual({ kind: "finishes", endsOn: "2027-02-26" });
    expect(listPlan({ kind: "finishes", endsOn: "Feb 26" })).toEqual({ kind: "finishes", endsOn: null });
  });
  it("reads a repeating list's rhythm and recipe, in range", () => {
    const p = listPlan({ kind: "repeats", rhythm: { every: "month_weekday", nth: 9, weekday: 4 }, recipe: [{ title: " Write it ", who: "u_michaella", before: 4 }, { title: "" }], owner: "u_derek" });
    expect(p.rhythm).toEqual({ every: "month_weekday", nth: 5, weekday: 4 });
    expect(p.recipe).toEqual([{ id: "r1", title: "Write it", who: "u_michaella", before: 4 }]);
    expect(p.owner).toBe("u_derek");
  });
});

describe("goes out days", () => {
  it("finds the third Thursday and the last Friday", () => {
    expect(nthWeekday(2026, 10, 3, 4)).toBe("2026-10-15");
    expect(nthWeekday(2026, 11, 3, 4)).toBe("2026-11-19");
    expect(nthWeekday(2027, 2, 5, 5)).toBe("2027-02-26");
  });
  it("steps monthly on a weekday, monthly on a date, weekly and every 2 weeks", () => {
    const third = { every: "month_weekday", nth: 3, weekday: 4 } as const;
    expect(nextGoesOut(third, "2026-10-15")).toBe("2026-11-19");
    expect(nextGoesOut(third, "2026-10-14")).toBe("2026-10-15");
    expect(nextGoesOut({ every: "month_date", day: 31 }, "2026-11-01")).toBe("2026-11-30");
    expect(nextGoesOut({ every: "week", weekday: 5 }, "2026-10-16")).toBe("2026-10-23");
    expect(nextGoesOut({ every: "2weeks", weekday: 5, from: "2026-10-16" }, "2026-10-16")).toBe("2026-10-30");
    expect(nextGoesOut({ every: "2weeks", weekday: 5, from: "2026-10-16" }, "2026-10-24")).toBe("2026-10-30");
  });
  it("says the rhythm as a sentence", () => {
    expect(rhythmSentence({ every: "month_weekday", nth: 3, weekday: 4 })).toBe("repeats monthly, goes out the third Thursday");
    expect(rhythmSentence({ every: "month_date", day: 15 })).toBe("repeats monthly, goes out on the 15th");
    expect(rhythmSentence({ every: "2weeks", weekday: 1, from: "2026-10-19" })).toBe("repeats every 2 weeks, goes out on Monday");
  });
});

const RECIPE: RecipeStep[] = [
  { id: "r1", title: "Write it", who: "u_michaella", before: 4 },
  { id: "r2", title: "Brian approves", who: "client", before: 2, remind: 2 },
  { id: "r3", title: "Send it", who: "u_michaella", before: 0 },
];
const PLAN = { kind: "repeats" as const, rhythm: { every: "month_weekday" as const, nth: 3, weekday: 4 }, recipe: RECIPE, owner: "u_derek" };

describe("rounds", () => {
  it("counts each step back in business days from the goes out day", () => {
    expect(businessDaysBefore("2026-11-19", 4)).toBe("2026-11-13");
    expect(businessDaysBefore("2026-11-16", 1)).toBe("2026-11-13"); // Monday back over the weekend
    expect(roundDates(RECIPE, "2026-11-19").map((s) => s.due)).toEqual(["2026-11-13", "2026-11-17", "2026-11-19"]);
    expect(roundStart(RECIPE, "2026-11-19")).toBe("2026-11-13");
  });
  it("titles a round by its month, or its date when weekly", () => {
    expect(roundTitle("Stores newsletter", PLAN.rhythm, "2026-11-19", "2026-10-17")).toBe("Stores newsletter: November");
    expect(roundTitle("Stores newsletter", PLAN.rhythm, "2027-01-21", "2026-10-17")).toBe("Stores newsletter: January 2027");
    expect(roundTitle("Blog", { every: "week", weekday: 5 }, "2026-10-23", "2026-10-17")).toBe("Blog: Oct 23");
  });
  it("names a round by its list and day, and reads that back", () => {
    expect(roundId("p_abc", "2026-11-19")).toBe("t_rd_p_abc_20261119");
    expect(roundGoesOut("t_rd_p_abc_20261119", "p_abc")).toBe("2026-11-19");
    expect(roundGoesOut("t_rd_p_abc_20261119", "p_ab")).toBeNull();
    expect(roundGoesOut("t_other", "p_abc")).toBeNull();
  });
  it("makes the first round it still has time for", () => {
    // Oct 15 has gone by; Nov 19 starts Nov 13, after today.
    expect(nextRoundGoesOut(PLAN, [], "2026-10-17")).toBe("2026-11-19");
    // On Oct 8 the October round still has time (it starts Oct 9).
    expect(nextRoundGoesOut(PLAN, [], "2026-10-08")).toBe("2026-10-15");
  });
  it("makes nothing while a round is open, or with no recipe", () => {
    expect(nextRoundGoesOut(PLAN, [{ goesOut: "2026-10-15", open: true }], "2026-10-17")).toBeNull();
    expect(nextRoundGoesOut({ ...PLAN, recipe: [] }, [], "2026-10-17")).toBeNull();
    expect(nextRoundGoesOut({ kind: "finishes" }, [], "2026-10-17")).toBeNull();
  });
  it("makes the one after the last round once that one is done", () => {
    expect(nextRoundGoesOut(PLAN, [{ goesOut: "2026-10-15", open: false }], "2026-10-15")).toBe("2026-11-19");
    // Months idle: the next day on the rhythm that has not gone by.
    expect(nextRoundGoesOut(PLAN, [{ goesOut: "2026-06-18", open: false }], "2026-10-17")).toBe("2026-11-19");
  });
  it("builds the round's task from the recipe", () => {
    let n = 0;
    const row = roundRow({ id: "p_news", client_id: "cl_brian", name: "Stores newsletter" }, PLAN, "2026-11-19", { rid: (p) => `${p}${++n}`, now: "2026-10-17T10:00:00Z", today: "2026-10-17" });
    expect(row.id).toBe("t_rd_p_news_20261119");
    expect(row.title).toBe("Stores newsletter: November");
    expect(row.assignee_id).toBe("u_derek");
    expect(row.status).toBe("delegated");
    expect(row.due).toBe("2026-11-13");
    expect(row.contact_id).toBe("brian");
    expect(row.delegated_to).toEqual(["u_michaella"]);
    expect("follow_up_at" in row).toBe(false);
    const steps = row.subtasks as Record<string, unknown>[];
    expect(steps.map((s) => [s.title, s.due, s.assigneeId ?? null, s.onClient ?? false])).toEqual([
      ["Write it", "2026-11-13", "u_michaella", false],
      ["Brian approves", "2026-11-17", null, true],
      ["Send it", "2026-11-19", "u_michaella", false],
    ]);
    expect(steps[1].remind).toEqual({ every: 2 });
    expect(steps[0].startedAt).toBe("2026-10-17T10:00:00Z");
  });
  it("leaves a client step's reminders to the app's default when the recipe says nothing", () => {
    const row = roundRow({ id: "p", client_id: "cl_x", name: "N" }, { ...PLAN, recipe: [{ id: "a", title: "Approve", who: "client", before: 0 }] }, "2026-11-19", { rid: (p) => p, now: "x" });
    expect((row.subtasks as Record<string, unknown>[])[0].remind).toBeUndefined();
    expect(row.status).toBe("waiting");
    expect(row.waiting_on_client).toBe(true);
  });
});

describe("makeNextRound", () => {
  const fakeStore = (rows: { id: string; status: string; deleted_at?: string | null }[]): RoundStore & { inserted: string[] } => {
    const inserted: string[] = [];
    return {
      inserted,
      async plan() { return { project: { id: "p_news", client_id: "cl_brian", name: "Stores newsletter" }, plan: PLAN }; },
      async rounds() { return rows; },
      async insert(row) {
        // The primary key: the same round id is refused.
        if (rows.some((r) => r.id === row.id)) return "exists";
        rows.push({ id: row.id as string, status: row.status as string });
        inserted.push(row.id as string);
        return "made";
      },
    };
  };
  const o = { today: "2026-10-17", now: "2026-10-17T10:00:00Z", rid: (p: string) => `${p}x` };
  it("makes the next round once, however many times it is asked", async () => {
    const rows = [{ id: "t_rd_p_news_20261015", status: "done" }];
    const store = fakeStore(rows);
    expect((await makeNextRound(store, "p_news", o)).made).toBe("t_rd_p_news_20261119");
    expect((await makeNextRound(store, "p_news", o)).made).toBeNull();
    expect((await makeNextRound(store, "p_news", o)).made).toBeNull();
    expect(store.inserted).toEqual(["t_rd_p_news_20261119"]);
  });
  it("never makes a round two callers raced to: the second insert is refused", async () => {
    const rows: { id: string; status: string }[] = [];
    const store = fakeStore(rows);
    const racing = { ...store, rounds: async () => [] as typeof rows };
    const [a, b] = await Promise.all([makeNextRound(racing, "p_news", o), makeNextRound(racing, "p_news", o)]);
    expect([a.made, b.made].filter(Boolean)).toEqual(["t_rd_p_news_20261119"]);
  });
  it("is quiet when the store fails", async () => {
    const store = { ...fakeStore([]), rounds: async () => { throw new Error("no column"); } };
    expect(await makeNextRound(store, "p_news", o)).toEqual({ made: null, goesOut: null });
  });
});

describe("a finishing list", () => {
  const T = (over: Partial<{ id: string; status: string; due: string | null; deadline: boolean; subtasks: { onClient?: boolean; done?: boolean; due?: string | null }[] }>) => ({ id: "t", status: "todo", due: null, ...over });
  const plan = listPlan({ kind: "finishes", endsOn: "2027-02-26" });
  it("counts its progress", () => {
    expect(progress([T({ status: "done" }), T({}), T({}), T({}), T({})])).toEqual({ done: 1, total: 5 });
  });
  it("is done when every task in it is done, and not when it is empty", () => {
    expect(isFinished(plan, [T({ status: "done" }), T({ status: "done" })])).toBe(true);
    expect(isFinished(plan, [T({ status: "done" }), T({})])).toBe(false);
    expect(isFinished(plan, [])).toBe(false);
    expect(isFinished(listPlan(null), [T({ status: "done" })])).toBe(false);
  });
  it("says what will miss the end date: a due or a client's need by after it", () => {
    const late = T({ id: "late", due: "2027-03-02" });
    const clientLate = T({ id: "c", subtasks: [{ onClient: true, done: false, due: "2027-03-01" }] });
    const fine = T({ id: "ok", due: "2027-02-26" });
    const doneLate = T({ id: "d", status: "done", due: "2027-04-01" });
    expect(missesEnd(plan, [late, clientLate, fine, doneLate]).map((t) => t.id)).toEqual(["late", "c"]);
    expect(missesEnd(listPlan({ kind: "finishes" }), [late])).toEqual([]);
  });
  it("finds the next due date among open tasks", () => {
    expect(nextDueOf([T({ due: "2026-10-21" }), T({ subtasks: [{ onClient: true, due: "2026-10-19" }] }), T({ status: "done", due: "2026-10-01" })])).toBe("2026-10-19");
  });
  it("says itself in one line for Claude", () => {
    expect(planLine({ kind: "finishes", endsOn: "2027-02-26" }, [T({ status: "done" }), T({ due: "2026-10-21" })], "p", "2026-10-17")).toBe("finishes 2027-02-26 · 1 of 2 done · next due 2026-10-21");
    expect(planLine(null, [T({}), T({ status: "done" })], "p", "2026-10-17")).toBe("holds work · 1 open");
    expect(planLine(PLAN, [], "p", "2026-10-17")).toBe("repeats monthly, goes out the third Thursday · 3 step recipe · next round goes out 2026-11-19");
  });
});

describe("up to Now 3 weeks before it is needed", () => {
  const TODAY = "2026-10-17";
  let k = 0;
  const qt = (over: Partial<QTask> = {}): QTask => { k++; return { id: `q${k}`, title: `Q ${k}`, status: "todo", due: null, createdAt: `2026-10-01T00:00:${String(k).padStart(2, "0")}Z`, priority: "normal", assigneeId: "u_derek", subtasks: [{ id: `s${k}`, title: "Make it", done: false }], ...over }; };
  const PULL = { now: 1, spacing: 3, pull: PULL_DAYS };

  it("keeps pull in the setting only when it is set", () => {
    expect(queueSettings({ now: 2, spacing: 3 })).toEqual({ now: 2, spacing: 3 });
    expect(queueSettings({ now: 2, spacing: 3, pull: 21 })).toEqual({ now: 2, spacing: 3, pull: 21 });
  });
  it("reads when it is needed: a deadline or the client's step", () => {
    expect(needsBy(qt({ due: "2026-11-01", deadline: true }))).toBe("2026-11-01");
    expect(needsBy(qt({ due: "2026-11-01" }))).toBeNull();
    expect(needsBy(qt({ subtasks: [{ id: "a", title: "Approve", done: false, onClient: true, due: "2026-11-02" }] }))).toBe("2026-11-02");
  });
  it("brings an Up next task up to Now 21 days before its need by, not 22", () => {
    const now = qt({ queuePos: POS_STEP, due: "2026-10-20" });
    const soon = qt({ queuePos: 2 * POS_STEP, due: "2026-11-07", deadline: true }); // 21 days out
    const later = qt({ queuePos: 3 * POS_STEP, due: "2026-11-08", deadline: true }); // 22 days out
    const g = groupQueue([now, soon, later], PULL, TODAY);
    expect(g.now.map((t) => t.id)).toEqual([now.id, soon.id]);
    expect(g.upNext.map((u) => u.task.id)).toEqual([later.id]);
    // The day after, the later one comes up too.
    expect(groupQueue([now, soon, later], PULL, "2026-10-18").now.map((t) => t.id)).toEqual([now.id, soon.id, later.id]);
  });
  it("changes nothing on a list without pull", () => {
    const now = qt({ queuePos: POS_STEP, due: "2026-10-20" });
    const soon = qt({ queuePos: 2 * POS_STEP, due: "2026-10-25", deadline: true });
    expect(groupQueue([now, soon], { now: 1, spacing: 3 }, TODAY).now.map((t) => t.id)).toEqual([now.id]);
  });
  it("dates a pulled task no later than its need by, and keeps a deadline's own date", () => {
    const now = qt({ queuePos: POS_STEP, due: "2026-10-20" });
    const client = qt({ queuePos: 2 * POS_STEP, subtasks: [{ id: "c", title: "Approve", done: false, onClient: false }, { id: "d", title: "Chelsea approves", done: false, onClient: true, due: "2026-10-20" }] });
    const deadline = qt({ queuePos: 3 * POS_STEP, due: "2026-11-01", deadline: true });
    const patches = queuePromotions([now, client, deadline], PULL, TODAY);
    // Today plus 3 business days is Oct 21; the client needs it by Oct 20.
    expect(patches).toEqual([{ id: client.id, due: "2026-10-20", queueSavedDue: null }]);
  });
  it("keeps a pulled task Now when another task is dragged above it", () => {
    const a = qt({ queuePos: POS_STEP, due: "2026-10-20" });
    const pulled = qt({ queuePos: 2 * POS_STEP, due: "2026-10-30", deadline: true });
    const c = qt({ queuePos: 3 * POS_STEP });
    const moves = queueMove([a, pulled, c], PULL, c.id, a.id, TODAY);
    expect(moves.find((p) => p.id === pulled.id)?.due).toBeUndefined();
  });
});

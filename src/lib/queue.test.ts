import { describe, expect, it } from "vitest";
import {
  addBusinessDaysIso as queueAddBusinessDays, deadlineWarnings, entryRank, groupQueue, isQueueWaiting, ordinal, placeBetween, placesFor,
  POS_STEP, promoteQueueStore, queueEntry, queueExit, queueMove, queueMoveUp, queueOffPatches, queueOnPatches, queuePromotions,
  queueSettings, queueTaskFromRow, upNextIds, bottomPlaceStore, type QTask,
} from "../../mcp/queue.mjs";
import { addBusinessDaysIso, stepStage } from "./data";

const Q = { now: 1, spacing: 3 };
const TODAY = "2026-10-14"; // a Wednesday
let n = 0;
const task = (over: Partial<QTask> = {}): QTask => {
  n++;
  return { id: `t${n}`, title: `Task ${n}`, status: "in_progress", due: null, createdAt: `2026-10-01T00:00:${String(n).padStart(2, "0")}Z`, priority: "normal", assigneeId: "u_derek", subtasks: [{ id: `s${n}`, title: "Edit the cut", done: false }], ...over };
};
const line = (count: number, over: (i: number) => Partial<QTask> = () => ({})) => Array.from({ length: count }, (_, i) => task({ queuePos: (i + 1) * POS_STEP, ...over(i) }));

describe("queueSettings", () => {
  it("is off for null, missing or not an object", () => {
    expect(queueSettings(null)).toBeNull();
    expect(queueSettings(undefined)).toBeNull();
    expect(queueSettings("on")).toBeNull();
  });
  it("defaults and clamps", () => {
    expect(queueSettings({})).toEqual({ now: 1, spacing: 3 });
    expect(queueSettings({ now: 0, spacing: -2 })).toEqual({ now: 1, spacing: 0 });
    expect(queueSettings({ now: "2", spacing: 5 })).toEqual({ now: 2, spacing: 5 });
  });
});

describe("dates", () => {
  it("counts business days the same as the app", () => {
    for (const [d, k] of [["2026-10-14", 3], ["2026-10-16", 1], ["2026-10-17", 2], ["2026-10-14", 0]] as const) {
      expect(queueAddBusinessDays(d, k)).toBe(addBusinessDaysIso(d, k));
    }
  });
});

describe("isQueueWaiting", () => {
  it("is the client's turn on a client step, a reply check in, a waiting stage or a wait on the task", () => {
    expect(isQueueWaiting(task({ subtasks: [{ title: "Mike reviews", done: false, onClient: true }] }))).toBe(true);
    expect(isQueueWaiting(task({ subtasks: [{ title: "Check in", done: false, finishWhen: "reply" }] }))).toBe(true);
    expect(isQueueWaiting(task({ subtasks: [{ title: "Wait for the logo", done: false }] }))).toBe(true);
    expect(isQueueWaiting(task({ waitingOnClient: true }))).toBe(true);
  });
  it("is a teammate's turn on someone else's step, but not Claude's", () => {
    expect(isQueueWaiting(task({ subtasks: [{ title: "Cut it", done: false, assigneeId: "u_justin" }] }))).toBe(true);
    expect(isQueueWaiting(task({ subtasks: [{ title: "Cut it", done: false, assigneeId: "u_claude" }] }))).toBe(false);
    expect(isQueueWaiting(task({ subtasks: [{ title: "Cut it", done: false, assigneeId: "u_derek" }] }))).toBe(false);
  });
  it("reads the current step: done steps and client requests are skipped", () => {
    const t = task({ subtasks: [{ title: "Mike reviews", done: true, onClient: true }, { title: "Changes", done: false, fromClient: true, onClient: true }, { title: "Post it", done: false }] });
    expect(isQueueWaiting(t)).toBe(false);
  });
  it("agrees with the app's stepStage on waiting", () => {
    const steps = [{ title: "Waiting on Mike", stage: undefined }, { title: "Edit", stage: "waiting" as const }, { title: "Edit", onClient: true }, { title: "Edit" }];
    for (const s of steps) expect(isQueueWaiting(task({ subtasks: [{ ...s, done: false }] }))).toBe(stepStage({ ...s }, "u_derek") === "waiting");
  });
  it("without steps, follows the status", () => {
    expect(isQueueWaiting(task({ subtasks: [], status: "waiting" }))).toBe(true);
    expect(isQueueWaiting(task({ subtasks: [], status: "todo" }))).toBe(false);
    expect(isQueueWaiting(task({ status: "done", waitingOnClient: true }))).toBe(false);
  });
});

describe("groupQueue", () => {
  it("Now is the first not waiting, Waiting the ones on someone else, Up next the rest labelled from 2nd", () => {
    const [a, b, c, d] = line(4, (i) => (i === 0 ? { due: "2026-10-15" } : i === 1 ? { waitingOnClient: true, due: "2026-10-15" } : {}));
    const done = task({ status: "done" });
    const g = groupQueue([d, c, b, a, done], Q);
    expect(g.now.map((t) => t.id)).toEqual([a.id]);
    expect(g.waiting.map((t) => t.id)).toEqual([b.id]);
    expect(g.upNext.map((u) => [u.task.id, u.label])).toEqual([[c.id, "2nd"], [d.id, "3rd"]]);
    expect(g.done.map((t) => t.id)).toEqual([done.id]);
  });
  it("fills Now from the top of the line when nothing has started", () => {
    const [a, b, c] = line(3);
    const g = groupQueue([a, b, c], { now: 2, spacing: 3 });
    expect(g.now.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(g.upNext.map((u) => u.label)).toEqual(["3rd"]);
  });
  it("a task back from waiting rejoins Now and pushes nobody out", () => {
    // b went to waiting (keeps its date), c was promoted with a date; b is back.
    const [b, c, d] = line(3, (i) => (i < 2 ? { due: "2026-10-17" } : {}));
    const g = groupQueue([b, c, d], Q);
    expect(g.now.map((t) => t.id)).toEqual([b.id, c.id]);
    expect(g.upNext.map((u) => [u.task.id, u.label])).toEqual([[d.id, "3rd"]]);
  });
  it("a deadline in line is not started by its date", () => {
    const [a, b] = line(2, (i) => (i === 0 ? { due: "2026-10-15" } : { deadline: true, due: "2026-11-01" }));
    const g = groupQueue([a, b], Q);
    expect(g.now.map((t) => t.id)).toEqual([a.id]);
    expect(g.upNext[0].task.id).toBe(b.id);
  });
  it("a task not placed yet sits where its priority puts it, its date ignored", () => {
    const [a, b, c] = line(3, (i) => (i === 0 ? { due: "2026-10-15" } : i === 1 ? { priority: "urgent" } : {}));
    const urgent = task({ priority: "urgent", due: "2026-10-14" });
    const high = task({ priority: "client_request", due: "2026-10-14" });
    const normal = task({ due: "2026-10-14" });
    const g = groupQueue([a, b, c, urgent, high, normal], Q);
    expect(g.now.map((t) => t.id)).toEqual([a.id]);
    expect(g.upNext.map((u) => u.task.id)).toEqual([urgent.id, b.id, high.id, c.id, normal.id]);
  });
  it("upNextIds is the line", () => {
    const [a, b, c] = line(3);
    expect([...upNextIds([a, b, c], Q)]).toEqual([b.id, c.id]);
  });
});

describe("entryRank", () => {
  it("urgent, the two automatic tiers as high, the rest normal", () => {
    expect(entryRank("urgent")).toBe("urgent");
    expect(entryRank("client_request")).toBe("high");
    expect(entryRank("conversation")).toBe("high");
    expect(entryRank("normal")).toBe("normal");
    expect(entryRank("none")).toBe("normal");
  });
});

describe("ordinal", () => {
  it("names places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
  });
});

describe("placeBetween and placesFor", () => {
  it("halves the gap, or says renumber", () => {
    expect(placeBetween(null, null)).toBe(POS_STEP);
    expect(placeBetween(1000, null)).toBe(2000);
    expect(placeBetween(null, 1000)).toBe(0);
    expect(placeBetween(1000, 2000)).toBe(1500);
    expect(placeBetween(1000, 1001)).toBeNull();
  });
  it("writes only what is out of place", () => {
    const [a, b, c] = line(3);
    expect(placesFor([a, b, c])).toEqual([]);
    expect(placesFor([c, a, b])).toEqual([{ id: c.id, queuePos: 0 }]);
    const fresh = task();
    expect(placesFor([a, fresh, b])).toEqual([{ id: fresh.id, queuePos: 1500 }]);
  });
  it("renumbers when there is no room", () => {
    const a = task({ queuePos: 1000 }), b = task({ queuePos: 1001 }), fresh = task();
    expect(placesFor([a, fresh, b])).toEqual([{ id: a.id, queuePos: 1000 }, { id: fresh.id, queuePos: 2000 }, { id: b.id, queuePos: 3000 }].filter((p, i) => [a, fresh, b][i].queuePos !== p.queuePos));
  });
});

describe("queuePromotions", () => {
  it("the Now one done: the next one is Now, due today plus the spacing", () => {
    const [a, b, c] = line(3, (i) => (i === 0 ? { due: "2026-10-14", status: "done" } : {}));
    expect(queuePromotions([a, b, c], Q, TODAY)).toEqual([{ id: b.id, due: "2026-10-19", queueSavedDue: null }]);
  });
  it("the Now one goes to waiting: the next one is Now, the waiting one keeps its date", () => {
    const [a, b] = line(2, (i) => (i === 0 ? { due: "2026-10-16", waitingOnClient: true } : {}));
    expect(queuePromotions([a, b], Q, TODAY)).toEqual([{ id: b.id, due: "2026-10-19", queueSavedDue: null }]);
  });
  it("nothing when Now is full, and nothing when one comes back from waiting", () => {
    const [a, b] = line(2, (i) => (i === 0 ? { due: "2026-10-16" } : {}));
    expect(queuePromotions([a, b], Q, TODAY)).toEqual([]);
    const [w, now, next] = line(3, (i) => (i < 2 ? { due: "2026-10-16" } : {}));
    expect(queuePromotions([w, now, next], Q, TODAY)).toEqual([]);
  });
  it("a deadline coming up keeps its own date", () => {
    const [a, b] = line(2, (i) => (i === 0 ? { status: "done" } : { deadline: true, due: "2026-11-01" }));
    expect(queuePromotions([a, b], Q, TODAY)).toEqual([]);
  });
  it("a task not placed yet that comes up is placed and dated", () => {
    const done = task({ queuePos: 1000, status: "done" });
    const fresh = task({ due: "2026-10-14" });
    expect(queuePromotions([done, fresh], Q, TODAY)).toEqual([{ id: fresh.id, queuePos: 1000, due: "2026-10-19", queueSavedDue: null }]);
  });
  it("counts business days over a weekend", () => {
    const [a, b] = line(2, (i) => (i === 0 ? { status: "done" } : {}));
    expect(queuePromotions([a, b], Q, "2026-10-16")[0].due).toBe("2026-10-21");
  });
});

describe("queueOnPatches and queueOffPatches", () => {
  it("lines up by due, no date last then made order; the first N keep their dates, the rest are saved and cleared", () => {
    const late = task({ due: "2026-10-20" });
    const soon = task({ due: "2026-10-15" });
    const none = task({ due: null });
    const pinned = task({ due: "2026-11-01", deadline: true });
    const waiting = task({ due: "2026-10-18", waitingOnClient: true });
    const done = task({ status: "done", due: "2026-10-01" });
    const patches = queueOnPatches([late, soon, none, pinned, waiting, done], Q);
    expect(patches).toEqual([
      { id: soon.id, queuePos: 1000 },
      { id: waiting.id, queuePos: 2000 },
      { id: late.id, queuePos: 3000, queueSavedDue: "2026-10-20", due: null },
      { id: pinned.id, queuePos: 4000 },
      { id: none.id, queuePos: 5000 },
    ]);
  });
  it("same day: made order breaks the tie (Mike's videos)", () => {
    const vids = Array.from({ length: 4 }, () => task({ due: "2026-10-14" }));
    const p = queueOnPatches([...vids].reverse(), Q);
    expect(p.map((x) => x.id)).toEqual(vids.map((v) => v.id));
    expect(p[0].due).toBeUndefined();
    expect(p.slice(1).every((x) => x.due === null && x.queueSavedDue === "2026-10-14")).toBe(true);
  });
  it("turning off puts every saved date back", () => {
    const a = task({ queuePos: 1000, due: null, queueSavedDue: "2026-10-20" });
    const b = task({ queuePos: 2000, due: "2026-10-15" });
    expect(queueOffPatches([a, b])).toEqual([{ id: a.id, due: "2026-10-20", queueSavedDue: null }]);
  });
  it("on then off is where it started", () => {
    const ts = [task({ due: "2026-10-20" }), task({ due: "2026-10-15" }), task({ due: null })];
    const on = queueOnPatches(ts, Q);
    const after = ts.map((t) => ({ ...t, ...on.find((p) => p.id === t.id) }));
    const off = queueOffPatches(after);
    const back = after.map((t) => ({ ...t, ...off.find((p) => p.id === t.id) }));
    expect(back.map((t) => t.due)).toEqual(ts.map((t) => t.due));
  });
});

describe("queueEntry", () => {
  const list = () => line(3, (i) => (i === 0 ? { due: "2026-10-15" } : {}));
  it("urgent enters right after Now", () => {
    const ts = list();
    const e = queueEntry(ts, Q, task({ priority: "urgent", due: "2026-10-14" }));
    expect(e.self.queuePos).toBe(1500);
    expect(e.self.due).toBeNull();
    expect(e.self.queueSavedDue).toBe("2026-10-14");
  });
  it("high enters at the top of Up next, below the urgent ones there", () => {
    const ts = list();
    ts[1].priority = "urgent";
    const e = queueEntry(ts, Q, task({ priority: "client_request" }));
    expect(e.self.queuePos).toBe(2500);
    expect(e.self.due).toBeUndefined();
  });
  it("normal and none go to the bottom; a repeat's copy goes to the bottom whatever its priority", () => {
    expect(queueEntry(list(), Q, task({ priority: "none" })).self.queuePos).toBe(4000);
    expect(queueEntry(list(), Q, task({ priority: "urgent" }), { bottom: true }).self.queuePos).toBe(4000);
  });
  it("a deadline keeps its date", () => {
    const e = queueEntry(list(), Q, task({ deadline: true, due: "2026-11-01" }));
    expect(e.self.due).toBeUndefined();
  });
  it("into an empty list it is first, and the Now check dates it", () => {
    const t = task({ due: "2026-10-30" });
    const e = queueEntry([], Q, t);
    const arrived = { ...t, ...e.self };
    expect(queuePromotions([arrived], Q, TODAY)).toEqual([{ id: t.id, due: "2026-10-19", queueSavedDue: null }]);
  });
  it("moving out keeps the place and brings the saved date back", () => {
    expect(queueExit(task({ queuePos: 3000, due: null, queueSavedDue: "2026-10-20" }))).toEqual({ id: expect.any(String), due: "2026-10-20", queueSavedDue: null });
    expect(queueExit(task({ queuePos: 3000, due: "2026-10-16" }))).toBeNull();
  });
});

describe("queueMove", () => {
  it("one write to move a task in Up next", () => {
    const [a, b, c, d] = line(4, (i) => (i === 0 ? { due: "2026-10-15" } : {}));
    expect(queueMove([a, b, c, d], Q, d.id, b.id, TODAY)).toEqual([{ id: d.id, queuePos: 1500 }]);
  });
  it("dragged above the Now one, it is Now: dated, and the old one's date is saved", () => {
    const [a, b, c] = line(3, (i) => (i === 0 ? { due: "2026-10-15" } : {}));
    const p = queueMove([a, b, c], Q, c.id, a.id, TODAY);
    expect(p).toContainEqual({ id: c.id, queuePos: 0, due: "2026-10-19", queueSavedDue: null });
    expect(p).toContainEqual({ id: a.id, due: null, queueSavedDue: "2026-10-15" });
  });
  it("to the end of the line", () => {
    const [a, b, c] = line(3, (i) => (i === 0 ? { due: "2026-10-15" } : {}));
    expect(queueMove([a, b, c], Q, b.id, null, TODAY)).toEqual([{ id: b.id, queuePos: 4000 }]);
  });
  it("Move it up puts it at the top of Up next", () => {
    const [a, b, c, d] = line(4, (i) => (i === 0 ? { due: "2026-10-15" } : i === 3 ? { deadline: true, due: "2026-10-20" } : {}));
    expect(queueMoveUp([a, b, c, d], Q, d.id, TODAY)).toEqual([{ id: d.id, queuePos: 1500 }]);
    expect(queueMoveUp([a, b, c, d], Q, b.id, TODAY)).toEqual([]);
  });
});

describe("deadlineWarnings", () => {
  it("warns when, at this pace, a deadline in line lands after it", () => {
    // Now due Oct 16; then 2nd lands Oct 21, 3rd Oct 26, 4th (deadline Oct 27) Oct 29.
    const [a, b, c, d] = line(4, (i) => (i === 0 ? { due: "2026-10-16" } : i === 3 ? { deadline: true, due: "2026-10-27", title: "First Time Buyer Programs" } : {}));
    expect(deadlineWarnings([a, b, c, d], Q, TODAY)).toEqual([{ id: d.id, title: "First Time Buyer Programs", deadline: "2026-10-27", lands: "2026-10-29" }]);
  });
  it("quiet when it makes it, and two at a time doubles the pace", () => {
    const [a, b, c, d] = line(4, (i) => (i === 0 ? { due: "2026-10-16" } : i === 3 ? { deadline: true, due: "2026-10-29" } : {}));
    expect(deadlineWarnings([a, b, c, d], Q, TODAY)).toEqual([]);
    const [e, f, g, h] = line(4, (i) => (i === 3 ? { deadline: true, due: "2026-10-22" } : {}));
    expect(deadlineWarnings([e, f, g, h], { now: 2, spacing: 3 }, TODAY)).toEqual([]);
  });
});

describe("stores", () => {
  it("promote: quiet without a queue, writes the next one's date with one", async () => {
    const [a, b] = line(2, (i) => (i === 0 ? { status: "done" } : {}));
    const writes: unknown[] = [];
    const store = (queue: unknown) => ({ queue: async () => queue, tasks: async () => [a, b], write: async (p: unknown) => { writes.push(p); } });
    expect(await promoteQueueStore(store(null), "p1", TODAY)).toEqual([]);
    expect(writes).toEqual([]);
    await promoteQueueStore(store({ now: 1, spacing: 3 }), "p1", TODAY);
    expect(writes).toEqual([{ id: b.id, due: "2026-10-19", queueSavedDue: null }]);
  });
  it("promote: a database without the columns is no queue", async () => {
    const store = { queue: async () => { throw new Error("column projects.queue does not exist"); }, tasks: async () => null, write: async () => undefined };
    expect(await promoteQueueStore(store, "p1", TODAY)).toEqual([]);
  });
  it("bottom place for a repeat's copy", async () => {
    const ts = line(2);
    expect(await bottomPlaceStore({ queue: async () => ({}), tasks: async () => ts, write: async () => undefined }, "p1")).toBe(3000);
    expect(await bottomPlaceStore({ queue: async () => null, tasks: async () => ts, write: async () => undefined }, "p1")).toBeNull();
  });
  it("reads a row", () => {
    expect(queueTaskFromRow({ id: "t", title: "x", status: "todo", due: null, queue_pos: 5, deadline: true, created_at: "c", subtasks: null })).toMatchObject({ id: "t", queuePos: 5, deadline: true, subtasks: [] });
  });
});

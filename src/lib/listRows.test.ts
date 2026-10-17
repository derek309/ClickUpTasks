import { describe, it, expect } from "vitest";
import { clientListRows, listRow } from "./listKinds";
import { compareUrgency, lateAndToday, urgencyKeyFrom } from "./urgency";
import { TODAY, addDaysIso, formatDayDate, formatDue, type Project, type Task } from "./data";
import { roundId } from "../../mcp/listKinds.mjs";

let n = 0;
const t = (o: Partial<Task>): Task =>
  ({ id: `t${++n}`, projectId: "p", clientId: "cl_brian", title: "", status: "todo", priority: "normal", due: null, followUpAt: null, priorityAuto: false, subtasks: [], waitingOnClient: false, assigneeId: "u_derek", ...o } as Task);
const list = (id: string, name: string, plan?: Project["plan"]): Project => ({ id, clientId: "cl_brian", name, description: "", ...(plan !== undefined ? { plan } : {}) });

describe("a client's lists sorted like the sidebar's clients", () => {
  const lists = [list("quiet", "Blog"), list("coming", "Promotional"), list("late", "Hot Chocolate"), list("today", "Tasks"), list("empty", "Archive")];
  const tasks: Record<string, Task[]> = {
    quiet: [t({})],
    coming: [t({ due: addDaysIso(TODAY, 5) })],
    late: [t({ due: addDaysIso(TODAY, -2) }), t({ due: TODAY })],
    today: [t({ due: TODAY }), t({ due: TODAY, priority: "urgent" })],
    empty: [],
  };
  const tasksFor = (id: string) => tasks[id] ?? [];

  it("late first, then today, then what's coming, then quiet", () => {
    const { going } = clientListRows(lists, tasksFor, { clientFirst: "Brian" });
    expect(going.map((r) => r.project.id)).toEqual(["late", "today", "coming", "quiet", "empty"]);
    expect(going.map((r) => r.quiet)).toEqual([false, false, false, true, true]);
  });
  it("is the same order the sidebar's client sort gives the same tasks", () => {
    // The client sort: the urgency key of each one's open tasks, by compareUrgency.
    const clientOrder = lists.map((l) => ({ id: l.id, k: urgencyKeyFrom(tasksFor(l.id).filter((x) => x.status !== "done")) }))
      .sort((a, b) => compareUrgency(a.k, b.k)).map((x) => x.id);
    expect(clientListRows(lists, tasksFor, { clientFirst: "Brian" }).going.map((r) => r.project.id)).toEqual(clientOrder);
  });
  it("carries the same red and orange counts as the sidebar", () => {
    const row = listRow(lists[2], tasks.late, { clientFirst: "Brian" });
    expect([row.late, row.today]).toEqual([1, 1]);
    expect(lateAndToday(tasks.late)).toEqual({ late: 1, today: 1 });
  });
});

describe("each row's one line", () => {
  it("holds work: open and today", () => {
    expect(listRow(list("a", "Tasks"), [t({ due: TODAY }), t({}), t({ status: "done" })], { clientFirst: "Brian" }).status).toBe("2 open · 1 today");
    expect(listRow(list("a", "Tasks", null), [], { clientFirst: "Brian" }).status).toBe("Nothing open");
  });
  it("finishes: end date, progress, now and who has the rest, and will miss", () => {
    const end = addDaysIso(TODAY, 60);
    const p = list("hc", "Hot Chocolate", { kind: "finishes", endsOn: end });
    const rows = [
      t({ projectId: "hc", status: "done" }),
      t({ projectId: "hc", due: addDaysIso(TODAY, 3) }),
      t({ projectId: "hc", due: addDaysIso(TODAY, 3) }),
      t({ projectId: "hc", waitingOnClient: true, status: "waiting" }),
      t({ projectId: "hc", due: addDaysIso(end, 4) }),
    ];
    const row = listRow(p, rows, { clientFirst: "Chelsea" });
    expect(row.status).toBe(`Finishes ${formatDayDate(end)} · 1 of 5 · 3 now, 1 with Chelsea`);
    expect(row.miss).toBe(`will miss ${formatDue(end)}`);
    expect(row.finished).toBe(false);
  });
  it("finishes: done when every task is done, and it leaves the going rows", () => {
    const p = list("hc", "Hot Chocolate", { kind: "finishes", endsOn: null });
    const done = [t({ projectId: "hc", status: "done" }), t({ projectId: "hc", status: "done" })];
    expect(listRow(p, done, { clientFirst: "Chelsea" }).status).toBe("Finished · 2 of 2");
    const { going, finished } = clientListRows([p, list("x", "Tasks")], (id) => (id === "hc" ? done : []), { clientFirst: "Chelsea" });
    expect(going.map((r) => r.project.id)).toEqual(["x"]);
    expect(finished.map((r) => r.project.id)).toEqual(["hc"]);
  });
  it("repeats: this round's step and when it goes out", () => {
    const goesOut = addDaysIso(TODAY, 5);
    const p = list("nl", "Stores newsletter", { kind: "repeats", rhythm: { every: "month_weekday", nth: 3, weekday: 4 }, recipe: [{ id: "a", title: "Write it", who: "u_derek", before: 4 }], owner: "u_derek" });
    const round = t({ id: roundId("nl", goesOut), projectId: "nl", subtasks: [
      { id: "s1", title: "Write it", done: true },
      { id: "s2", title: "Brian approves", done: false, onClient: true },
    ] as Task["subtasks"] });
    expect(listRow(p, [round], { clientFirst: "Brian" }).status).toBe(`Monthly · this round: Brian approves · goes out ${formatDayDate(goesOut)}`);
  });
  it("repeats: the next round's start when none is open, faded", () => {
    const p = list("bl", "Blog", { kind: "repeats", rhythm: { every: "week", weekday: 1 }, recipe: [{ id: "a", title: "Write it", who: "u_derek", before: 2 }], owner: "u_derek" });
    const row = listRow(p, [], { clientFirst: "Brian" });
    expect(row.status).toMatch(/^Weekly · next round starts /);
    expect(row.quiet).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { sortTasks, hoistPinned } from "./taskSort";
import { TODAY, addDaysIso, type Task } from "./data";

const t = (o: Partial<Task>): Task =>
  ({ id: "t", title: "", status: "todo", priority: "normal", due: null, followUpAt: null,
     priorityAuto: false, comments: [], createdAt: "2026-01-01T00:00:00Z", assigneeId: null, ...o } as unknown as Task);

const ids = (list: Task[]) => list.map((x) => x.id);
const opts = (o: Partial<Parameters<typeof sortTasks>[1]> = {}) =>
  ({ sortBy: "due" as const, sortDir: "asc" as const, ...o });

describe("ordering a task list", () => {
  it("sorts by date and reverses cleanly", () => {
    const list = [t({ id: "b", due: addDaysIso(TODAY, 2) }), t({ id: "a", due: TODAY })];
    expect(ids(sortTasks(list, opts()))).toEqual(["a", "b"]);
    expect(ids(sortTasks(list, opts({ sortDir: "desc" })))).toEqual(["b", "a"]);
  });

  it("puts undated tasks last in both directions rather than first in one", () => {
    const list = [t({ id: "none" }), t({ id: "soon", due: TODAY })];
    expect(ids(sortTasks(list, opts()))[0]).toBe("soon");
  });

  it("sorts follow up on the follow-up date alone, not the due date", () => {
    // The column answers "what comes back to me and when", so a task with no
    // follow-up belongs at the end even when it is due tomorrow.
    const list = [t({ id: "dueSoon", due: TODAY }), t({ id: "followsUp", followUpAt: addDaysIso(TODAY, 3) })];
    expect(ids(sortTasks(list, opts({ sortBy: "followUp" })))).toEqual(["followsUp", "dueSoon"]);
  });

  // The bug that already happened: the unread boost was a hardcoded 4, which
  // became a tie the day a priority tier was added at rank 4.
  it("puts an unread reply above every priority tier", () => {
    const list = [t({ id: "urgent", priority: "urgent" }), t({ id: "replied", priority: "none" })];
    const out = sortTasks(list, opts({ sortBy: "priority", hasUnreadReply: (x) => x.id === "replied" }));
    expect(ids(out)[0]).toBe("replied");
  });

  it("sorts created oldest first, which is what that column is asked", () => {
    const list = [t({ id: "new", createdAt: "2026-06-01T00:00:00Z" }), t({ id: "old", createdAt: "2026-01-01T00:00:00Z" })];
    expect(ids(sortTasks(list, opts({ sortBy: "created" })))).toEqual(["old", "new"]);
  });

  it("does not mutate the list it was given", () => {
    const list = [t({ id: "b", due: addDaysIso(TODAY, 2) }), t({ id: "a", due: TODAY })];
    sortTasks(list, opts());
    expect(ids(list)).toEqual(["b", "a"]);
  });
});

describe("holding just-added tasks at the top", () => {
  it("hoists pinned tasks in pin order, ahead of everything else", () => {
    const list = [t({ id: "a" }), t({ id: "b" }), t({ id: "c" })];
    expect(ids(hoistPinned(list, ["c", "a"]))).toEqual(["c", "a", "b"]);
  });
  it("is a no-op with nothing pinned, and ignores ids no longer in the list", () => {
    const list = [t({ id: "a" }), t({ id: "b" })];
    expect(ids(hoistPinned(list, []))).toEqual(["a", "b"]);
    expect(ids(hoistPinned(list, ["gone"]))).toEqual(["a", "b"]);
  });
  it("survives a sort, so a new task stays put instead of jumping away", () => {
    const list = [t({ id: "old", due: TODAY }), t({ id: "new", due: addDaysIso(TODAY, 9) })];
    expect(ids(sortTasks(list, opts({ pinnedIds: ["new"] })))).toEqual(["new", "old"]);
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import { WRITE_SETTLE_MS, mergeFetched, noteTaskWrite, tasksWrittenSince } from "./localTaskWrites";

afterEach(() => vi.useRealTimers());

describe("the focus refetch and a local edit", () => {
  // Audit 2026-09-29, 1.4: the fetch read the row before the tick was saved,
  // and its older copy replaced the ticked one on screen.
  it("keeps a tick made while the refetch was in flight", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const since = Date.now() - WRITE_SETTLE_MS;          // refetch starts
    const before = { id: "t_tick", subtasks: [{ id: "s_1", done: false }] };
    const snapshot = [structuredClone(before)];
    vi.advanceTimersByTime(400);
    const onScreen = [{ ...before, subtasks: [{ id: "s_1", done: true }] }];
    noteTaskWrite("t_tick");                              // user ticks, save goes out
    vi.advanceTimersByTime(800);                          // older snapshot arrives
    expect(mergeFetched(onScreen, snapshot, tasksWrittenSince(since))[0].subtasks[0].done).toBe(true);
  });

  it("still takes other rows and new rows from the fetch", () => {
    const prev = [{ id: "a", v: 1 }, { id: "b", v: 1 }];
    const merged = mergeFetched(prev, [{ id: "a", v: 2 }, { id: "b", v: 2 }, { id: "c", v: 2 }], new Set(["b"]));
    expect(merged).toEqual([{ id: "a", v: 2 }, { id: "b", v: 1 }, { id: "c", v: 2 }]);
  });

  it("forgets a write once it is older than the settle window", () => {
    vi.useFakeTimers({ now: 5_000_000 });
    noteTaskWrite("t_old");
    vi.advanceTimersByTime(WRITE_SETTLE_MS + 1);
    expect(tasksWrittenSince(Date.now() - WRITE_SETTLE_MS).has("t_old")).toBe(false);
  });
});

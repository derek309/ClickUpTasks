import { describe, expect, it } from "vitest";
import { closeOpenSteps, type Subtask } from "./data";

describe("closeOpenSteps", () => {
  it("ticks every open step and leaves done ones as they were", () => {
    const at = "2026-10-14T22:24:26.000Z";
    const steps = [
      { id: "a", title: "Email James", done: true, doneAt: "2026-10-13T10:00:00.000Z", outcome: "Sent" },
      { id: "b", title: "Fine print", done: false },
      { id: "c", title: "Decide who edits", done: false, outcome: "Half way" },
    ] as Subtask[];
    const out = closeOpenSteps(steps, at, "u_derek");
    expect(out[0]).toEqual(steps[0]);
    expect(out[1]).toMatchObject({ done: true, doneAt: at, doneBy: "u_derek", outcome: "Closed with the task" });
    expect(out[2]).toMatchObject({ done: true, doneAt: at, outcome: "Half way" });
    expect(out.every((s) => s.done)).toBe(true);
  });
});

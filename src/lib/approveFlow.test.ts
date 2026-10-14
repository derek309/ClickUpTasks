import { describe, expect, it } from "vitest";
import { tickedSteps, type Subtask } from "./data";

// t_mv01d2mnx "MEDAL of brands", 2026-10-13: Derek finished step 6 at 18:01:05
// and, 7 seconds later, his Done on step 7 (which Claude had finished at 17:57,
// still open on his page) flipped it back open.
const medal = (): Subtask[] => [
  { id: "s5", title: "Waiting on Brian to review the review", done: true, onClient: true, waitsOn: "page", outcome: "Brian approved" },
  { id: "s6", title: "Reply to brian: Updated for your review", done: true, doneAt: "2026-10-13T18:01:05.289Z", outcome: "Done", assigneeId: "u_derek" },
  { id: "s7", title: "Build the HTML review version", done: true, doneAt: "2026-10-13T17:57:00.000Z", outcome: "Done", assigneeId: "u_claude", addedFor: "next:s6" },
];

describe("finishing a step never reopens one", () => {
  it("a finish on a later step already done changes nothing", () => {
    expect(tickedSteps(medal(), "s7", true)).toBeNull();
    expect(tickedSteps(medal(), "s6", true)).toBeNull();
  });

  it("a finish on an open step finishes it, and only it", () => {
    const list = medal().map((x) => (x.id === "s6" ? { ...x, done: false } : x));
    const out = tickedSteps(list, "s6", true)!;
    expect(out.map((x) => [x.id, x.done])).toEqual([["s5", true], ["s6", true], ["s7", true]]);
  });

  it("a reopen is only ever asked for, and a plain tick still flips", () => {
    expect(tickedSteps(medal(), "s7", false)!.find((x) => x.id === "s7")!.done).toBe(false);
    expect(tickedSteps(medal(), "s7")!.find((x) => x.id === "s7")!.done).toBe(false);
    expect(tickedSteps(medal(), "nope", true)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { handoffLink, handoffOf, handoffProgress } from "./data";

describe("handoffOf", () => {
  it("fills an older delegation from its instructions", () => {
    const h = handoffOf({ note: "Send both emails" });
    expect(h.goal).toBe("Send both emails");
    expect(h.steps).toEqual([]);
    expect(h.thread).toEqual([]);
  });

  it("keeps a written goal over the instructions", () => {
    expect(handoffOf({ note: "old", handoff: { goal: "new" } }).goal).toBe("new");
  });
});

describe("handoffProgress", () => {
  it("counts ticked steps", () => {
    const h = handoffOf({ handoff: { steps: [{ id: "a", text: "one", done: true }, { id: "b", text: "two", done: false }] } });
    expect(handoffProgress(h)).toEqual({ done: 1, total: 2 });
  });
});

describe("handoffLink", () => {
  it("adds the delegation to an absolute task link", () => {
    expect(handoffLink("https://clickuptasks.vercel.app/?task=t_1", "s_2")).toBe("https://clickuptasks.vercel.app/?task=t_1&handoff=s_2");
  });

  it("keeps a relative task link relative", () => {
    expect(handoffLink("?task=t_1", "s_2")).toBe("/?task=t_1&handoff=s_2");
  });
});

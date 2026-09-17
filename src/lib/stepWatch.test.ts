import { describe, expect, it } from "vitest";
import { formatStepTime, formatStepWatch, parseStepWatch, stepWatchState, suggestNextSteps } from "./data";

const nameOf = (id: string) => ({ m_mp: "Michaella Pastrana", m_df: "Derek Fox" } as Record<string, string>)[id] ?? "Someone";

describe("parseStepWatch", () => {
  it("round trips each kind and refuses junk", () => {
    for (const raw of ["reply", "approved:page", "approved:doc", "handoff:s_12ab"]) expect(formatStepWatch(parseStepWatch(raw)!)).toBe(raw);
    expect(parseStepWatch("approved:video")).toBeNull();
    expect(parseStepWatch("handoff:")).toBeNull();
    expect(parseStepWatch(null)).toBeNull();
  });
});

describe("stepWatchState", () => {
  const base = { since: "2026-09-15T10:00:00Z", clientName: "Brian Goodell", messages: [], subtasks: [], reviews: {}, nameOf };
  it("waits for a reply after the step was set", () => {
    const early = { direction: "inbound" as const, at: "2026-09-15T09:00:00Z", channel: "chat" as const };
    expect(stepWatchState({ kind: "reply" }, { ...base, messages: [early] }).met).toBeNull();
    const late = { ...early, at: "2026-09-15T11:00:00Z" };
    expect(stepWatchState({ kind: "reply" }, { ...base, messages: [early, late] }).met).toBe("Brian replied");
  });
  it("sees an approval", () => {
    const w = { kind: "approved" as const, review: "page" as const };
    expect(stepWatchState(w, { ...base, reviews: { page: { title: "Stores Newsletter HTML", status: "with_client", approvedAt: null } } }))
      .toEqual({ waiting: "Waiting on Brian to approve Stores Newsletter HTML", met: null });
    expect(stepWatchState(w, { ...base, reviews: { page: { title: "Stores Newsletter HTML", status: "approved", approvedAt: "x" } } }).met)
      .toBe("Brian approved Stores Newsletter HTML");
  });
  it("sees a finished handoff", () => {
    const sub = { id: "s1", title: "Send Store Newsletters", done: true, assigneeId: "m_mp" };
    expect(stepWatchState({ kind: "handoff", subId: "s1" }, { ...base, subtasks: [sub] }).met).toBe('Michaella finished "Send Store Newsletters"');
  });
});

describe("suggestNextSteps", () => {
  it("offers the handoff, the review and a reply, three at most", () => {
    const out = suggestNextSteps({
      clientName: "Brian Goodell", canMessage: true, taskOwnerId: "m_df", nameOf, today: "2026-09-16",
      subtasks: [{ id: "s1", title: "Send Store Newsletters", done: false, assigneeId: "m_mp", due: "2026-09-17" }, { id: "s2", title: "Mine", done: false, assigneeId: "m_df" }],
      reviews: { page: { title: "Stores Newsletter HTML", status: "with_client" }, doc: { title: "Content", status: "approved" } },
    });
    expect(out.map((s) => s.watch)).toEqual(["handoff:s1", "approved:page", "reply"]);
    expect(out[0].due).toBe("2026-09-17");
  });
});

describe("formatStepTime", () => {
  it("reads like a clock", () => {
    expect(formatStepTime("17:00")).toBe("5 PM");
    expect(formatStepTime("09:30")).toBe("9:30 AM");
    expect(formatStepTime("00:00")).toBe("12 AM");
    expect(formatStepTime("bad")).toBeNull();
  });
});

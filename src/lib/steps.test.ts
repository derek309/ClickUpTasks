import { describe, expect, it } from "vitest";
import { addChangesRound, currentStep, guessStepStage, statusForStep, stepAfter, stepProgress, stepStage, type Subtask } from "./data";

const s = (id: string, title: string, extra: Partial<Subtask> = {}): Subtask => ({ id, title, done: false, ...extra });

describe("steps", () => {
  it("reads a stage from older items' words", () => {
    expect(guessStepStage("Send to client to review")).toBe("review");
    expect(guessStepStage("Make Brian's changes")).toBe("changes_requested");
    expect(guessStepStage("Draft document")).toBe("in_progress");
  });
  it("a step given to a teammate is Delegated, whatever its stage", () => {
    expect(stepStage(s("a", "Schedule the send", { assigneeId: "u_m", stage: "in_progress" }), "u_d")).toBe("delegated");
    expect(stepStage(s("a", "Schedule the send", { assigneeId: "u_d", stage: "waiting" }), "u_d")).toBe("waiting");
  });
  it("the current step is the first not done, client changes aside", () => {
    const list = [s("c", "Swap the logo", { fromClient: true }), s("a", "Draft", { done: true }), s("b", "Review")];
    expect(currentStep(list)?.id).toBe("b");
    expect(stepAfter(list, "b")).toBeNull();
  });
  it("counts handoffs as finished when they are", () => {
    expect(stepProgress([s("a", "x", { done: true, assigneeId: "u_m" }), s("b", "y")])).toEqual({ done: 1, total: 2, pct: 50 });
    expect(stepProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it("status follows the step, except On hold and Done", () => {
    expect(statusForStep("in_progress", "review")).toBe("review");
    expect(statusForStep("on_hold", "review")).toBeNull();
    expect(statusForStep("done", "review")).toBeNull();
    expect(statusForStep("review", "review")).toBeNull();
    expect(statusForStep("review", null)).toBeNull();
  });
  it("adds a round of changes after the review step, once", () => {
    let n = 0;
    const list = [s("a", "Draft", { done: true }), s("r", "Client review", { stage: "review" }), s("z", "Schedule")];
    const out = addChangesRound(list, "r", "Brian", "page:2", () => `n${++n}`)!;
    expect(out.map((x) => [x.title, x.done])).toEqual([["Draft", true], ["Client review", true], ["Make Brian's changes", false], ["Client review", false], ["Schedule", false]]);
    expect(addChangesRound(out, "r", "Brian", "page:2", () => "x")).toBeNull();
  });
});

import { holdOnStep, releaseFromSteps, stepHolding } from "./data";
import { reviewFollowUpDays } from "./reviewReminders";

describe("what a step holds", () => {
  const list = [s("a", "Draft", { holds: ["doc"] }), s("b", "Review")];
  it("puts a deliverable on one step only", () => {
    const moved = holdOnStep(list, "b", "doc");
    expect(moved[0].holds).toBeUndefined();
    expect(moved[1].holds).toEqual(["doc"]);
    expect(stepHolding(moved, "doc")?.id).toBe("b");
  });
  it("leaves a step that already holds it alone", () => {
    expect(holdOnStep(list, "a", "doc")[0]).toBe(list[0]);
  });
  it("takes it off", () => {
    expect(stepHolding(releaseFromSteps(list, "doc"), "doc")).toBeNull();
  });
});

describe("review follow up", () => {
  it("comes the day after the last reminder", () => {
    expect(reviewFollowUpDays(1)).toBe(4);
    expect(reviewFollowUpDays(2)).toBe(7);
    expect(reviewFollowUpDays(0)).toBe(2);
  });
});

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

import { compactTemplateStep, needMet, planFromSteps, stepsFromTemplate, templatesFor, templateSteps } from "./data";

describe("plans", () => {
  it("reads old templates of plain titles", () => {
    expect(templateSteps({ checklistItems: ["Draft", { title: "Review", stage: "review" }, " "] })).toEqual([{ title: "Draft" }, { title: "Review", stage: "review" }]);
  });
  it("makes a task's steps from a plan", () => {
    let n = 0;
    const out = stepsFromTemplate({ checklistItems: ["Draft", { title: "Review", stage: "review", makes: "page", needs: ["store list link"] }] }, () => `s${++n}`);
    expect(out).toEqual([{ id: "s1", title: "Draft", done: false }, { id: "s2", title: "Review", done: false, stage: "review", makes: "page", needs: ["store list link"] }]);
  });
  it("saves a plain step as a plain title", () => {
    expect(compactTemplateStep({ title: " Draft ", needs: [" "] })).toBe("Draft");
  });
  it("saves a task's steps as a plan, leaving rounds of changes out", () => {
    const subs = [
      s("a", "Write the email", { done: true, holds: ["email", "att:x1"] }),
      s("b", "Client review", { stage: "review", holds: ["page"] }),
      s("c", "Make Brian's changes", { addedFor: "page:2", stage: "changes_requested" }),
      s("d", "Schedule the send", { assigneeId: "u_m" }),
      s("e", "Swap the logo", { fromClient: true }),
    ];
    const names: Record<string, string> = { email: "Draft email", "att:x1": "Store list", page: "HTML review" };
    expect(planFromSteps(subs, "u_d", (k) => names[k] ?? null)).toEqual([
      { title: "Write the email", stage: "in_progress", makes: "email", needs: ["Draft email", "Store list"] },
      { title: "Client review", stage: "review", makes: "page", needs: ["HTML review"] },
      "Schedule the send",
    ]);
  });
  it("meets a need by name, loosely", () => {
    expect(needMet("store list link", ["Store list"])).toBe(true);
    expect(needMet("Draft email", ["draft email"])).toBe(true);
    expect(needMet("product photos", ["Store list"])).toBe(false);
  });
  it("offers a client's templates first, never another client's", () => {
    const all = [{ name: "A", clientId: "cl_x" }, { name: "B", clientId: null }, { name: "C", clientId: "cl_y" }];
    expect(templatesFor(all, "cl_x").map((t) => t.name)).toEqual(["A", "B"]);
  });
});

import { inWindow, stepWindow, todoProgress } from "./data";

describe("step pages", () => {
  it("counts a step's to-dos", () => {
    expect(todoProgress([{ id: "a", title: "x", done: true }, { id: "b", title: "y", done: false }])).toEqual({ done: 1, total: 2 });
    expect(todoProgress(undefined)).toEqual({ done: 0, total: 0 });
  });
  it("finds a step's conversation window", () => {
    const subs = [s("a", "Draft", { done: true, doneAt: "2026-10-05T10:00:00Z" }), s("b", "Review"), s("c", "Send", { startedAt: "2026-10-09T09:00:00Z", doneAt: "2026-10-10T09:00:00Z" })];
    expect(stepWindow(subs, "a", "2026-10-01T00:00:00Z")).toEqual({ from: "2026-10-01T00:00:00Z", to: "2026-10-05T10:00:00Z" });
    expect(stepWindow(subs, "b", "2026-10-01T00:00:00Z")).toEqual({ from: "2026-10-05T10:00:00Z", to: null });
    const w = stepWindow(subs, "c", "2026-10-01T00:00:00Z");
    expect(inWindow("2026-10-09T12:00:00Z", w)).toBe(true);
    expect(inWindow("2026-10-11T12:00:00Z", w)).toBe(false);
  });
});

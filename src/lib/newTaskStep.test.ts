import { describe, it, expect } from "vitest";
import { applyStepOne, stepOneWanted } from "./newTaskStep";
import type { Subtask } from "./data";

// Step 1 set up inside the new task box (Derek, 2026-10-14): the task is made
// with step 1 holding the action picked, as + Add step does.

let n = 0;
const base = { title: "Design the spring flyer", owner: "u_derek", meId: "u_derek", today: "2026-10-14", now: "2026-10-14T09:00:00Z", makeId: () => `s_${++n}` };
const setup = (over: Partial<{ who: string | null; when: string | null; whenSet: boolean; action: string | null }> = {}) => ({ who: null, when: "2026-10-15", whenSet: false, action: null, ...over });

describe("whether step 1 is made", () => {
  it("left alone there is no step, as before", () => {
    expect(stepOneWanted(setup(), "u_derek")).toBe(false);
    expect(applyStepOne([], { ...base, setup: setup() })).toEqual({ subtasks: [], stepId: null, open: null });
  });

  it("an action, the client's turn or a date picked make one", () => {
    expect(stepOneWanted(setup({ action: "doc" }), "u_derek")).toBe(true);
    expect(stepOneWanted(setup({ who: "client" }), "u_derek")).toBe(true);
    expect(stepOneWanted(setup({ whenSet: true }), "u_derek")).toBe(true);
  });
});

describe("step 1 holding the action", () => {
  it("a document is put on it, named for the task, yours, by when", () => {
    const r = applyStepOne([], { ...base, setup: setup({ action: "doc" }) });
    expect(r.open).toBeNull();
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]).toMatchObject({ title: "Design the spring flyer", assigneeId: "u_derek", due: "2026-10-15", holds: ["doc"], madeHere: ["doc"] });
  });

  it("an email is held on it, due today, and its window opens", () => {
    const r = applyStepOne([], { ...base, setup: setup({ action: "email" }) });
    expect(r.subtasks[0]).toMatchObject({ holds: ["email"], due: "2026-10-14" });
    expect(r.open).toBe("email");
  });

  it("a text is drafted on it", () => {
    const r = applyStepOne([], { ...base, setup: setup({ action: "text" }) });
    expect(r.subtasks[0].draftMessage).toEqual({ channel: "sms", body: "" });
    expect(r.open).toBe("text");
  });

  it("To dos and Directions open the step's page on their box", () => {
    expect(applyStepOne([], { ...base, setup: setup({ action: "checklist" }) }).open).toBe("checklist");
    expect(applyStepOne([], { ...base, setup: setup({ action: "directions" }) }).open).toBe("directions");
  });

  it("goes on the step the typed lines made, keeping its directions", () => {
    const one: Subtask = { id: "s_dir", title: "Design the spring flyer", done: false, notes: "<p>Bright colours</p>" };
    const r = applyStepOne([one], { ...base, setup: setup({ action: "image" }) });
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]).toMatchObject({ id: "s_dir", notes: "<p>Bright colours</p>", holds: ["image"] });
  });

  it("a handoff's step keeps its own date and takes the action", () => {
    const handoff: Subtask = { id: "s_h", title: "For Justin", done: false, assigneeId: "u_justin", due: "2026-10-20" };
    const r = applyStepOne([handoff], { ...base, setup: setup({ who: "u_justin", action: "page" }) });
    expect(r.subtasks[0]).toMatchObject({ assigneeId: "u_justin", due: "2026-10-20", holds: ["page"] });
  });

  it("an Email review or a Page review is the HTML review, its kind kept on the step", () => {
    const r = applyStepOne([], { ...base, setup: setup({ action: "page:email" }) });
    expect(r.subtasks[0]).toMatchObject({ holds: ["page"], madeHere: ["page"], pageKind: "email" });
    expect(r.open).toBeNull();
    const p = applyStepOne([], { ...base, setup: setup({ action: "page:page" }) });
    expect(p.subtasks[0]).toMatchObject({ holds: ["page"], pageKind: "page" });
  });

  it("the client's turn opens the ask", () => {
    const r = applyStepOne([], { ...base, setup: setup({ who: "client" }) });
    expect(r.open).toBe("ask");
    expect(r.stepId).toBe(r.subtasks[0].id);
  });

  it("on someone else's task the step is noted as yours, not handed to you", () => {
    const r = applyStepOne([], { ...base, owner: "u_justin", setup: setup({ action: "doc" }) });
    expect(r.subtasks[0].assigneeId).toBeUndefined();
    expect(r.subtasks[0].addedBy).toBe("u_derek");
  });
});

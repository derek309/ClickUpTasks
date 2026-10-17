import { describe, it, expect } from "vitest";
import { canSaveNewStep, newStepButton, newStepFields, newStepWhen } from "./newStepBox";
import { applyStepOne } from "./newTaskStep";
import { CLAUDE_ID } from "./data";

// The new step box (Derek, 2026-10-17): its button follows whose turn, and
// what is typed becomes the step's description and to dos, empty ones dropped.
const o = { meId: "u_derek", clientFirst: "Brian", nameOf: (id: string) => (id === "u_mic" ? "Michaella" : "Someone") };

describe("newStepButton", () => {
  it("reads by whose turn", () => {
    expect(newStepButton("u_derek", o)).toBe("Add step");
    expect(newStepButton(null, o)).toBe("Add step");
    expect(newStepButton("u_mic", o)).toBe("Give to Michaella");
    expect(newStepButton(CLAUDE_ID, o)).toBe("Give to Claude");
    expect(newStepButton("client", o)).toBe("Write Brian's email");
  });
});

describe("newStepFields", () => {
  it("keeps the description and to dos typed", () => {
    let n = 0;
    const f = newStepFields({ description: "Why it matters.\n\nhttps://x.test", todos: ["Pick the photo", "Write the caption"] }, () => `td${n++}`);
    expect(f.notes).toBe("<p>Why it matters.</p><p>https://x.test</p>");
    expect(f.todos).toEqual([{ id: "td0", title: "Pick the photo", done: false }, { id: "td1", title: "Write the caption", done: false }]);
  });
  it("drops an empty description and empty to dos", () => {
    expect(newStepFields({ description: "  \n ", todos: ["", "  "] }, () => "x")).toEqual({});
    expect(newStepFields({ description: "", todos: ["", "Call"] }, () => "x").todos).toHaveLength(1);
  });
});

describe("newStepWhen and canSaveNewStep", () => {
  it("Claude's turn is always today", () => {
    expect(newStepWhen(CLAUDE_ID, "2026-10-20", "2026-10-17")).toBe("2026-10-17");
    expect(newStepWhen("u_mic", "2026-10-20", "2026-10-17")).toBe("2026-10-20");
  });
  it("needs a name, something from + Add, or someone else's turn", () => {
    expect(canSaveNewStep({ title: "", action: null, who: "u_derek" }, "u_derek")).toBe(false);
    expect(canSaveNewStep({ title: "Call", action: null, who: "u_derek" }, "u_derek")).toBe(true);
    expect(canSaveNewStep({ title: "", action: "doc", who: "u_derek" }, "u_derek")).toBe(true);
    expect(canSaveNewStep({ title: "", action: null, who: CLAUDE_ID }, "u_derek")).toBe(true);
  });
});

describe("step 1 from the new task box", () => {
  it("holds its to dos and description, empty ones dropped", () => {
    let n = 0;
    const r = applyStepOne([], {
      setup: { who: null, when: null, whenSet: false, action: null, description: "For the open house.", todos: ["Pick the photo", ""] },
      title: "Design the flyer", owner: "u_derek", meId: "u_derek", today: "2026-10-17", now: "2026-10-17T10:00:00Z", makeId: () => `id${n++}`,
    });
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0].notes).toBe("<p>For the open house.</p>");
    expect(r.subtasks[0].todos?.map((t) => t.title)).toEqual(["Pick the photo"]);
  });
  it("makes no step from empty ones", () => {
    const r = applyStepOne([], { setup: { who: null, when: null, whenSet: false, action: null, description: " ", todos: [""] }, title: "X", owner: "u_derek", meId: "u_derek", today: "2026-10-17", now: "n", makeId: () => "id" });
    expect(r.stepId).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildNextStepsToday, type NextStepTask } from "./nextStepsToday";
import type { TaskAction } from "./data";

const task = (id: string, over: Partial<NextStepTask> = {}): NextStepTask => ({
  id, title: `Task ${id}`, clientId: "c", assigneeId: "me", followUpAt: null, status: "todo", comments: [], ...over,
});
const step = (id: string, taskId: string, over: Partial<TaskAction> = {}): TaskAction => ({
  id, taskId, kind: "note", authorId: "me", toId: null, parentId: null, body: "", at: "2026-09-10T00:00:00Z",
  nextStep: `Step ${id}`, nextStepDue: "2026-09-16", nextStepDoneAt: null, ...over,
});

describe("buildNextStepsToday", () => {
  const today = "2026-09-16";

  it("keeps my steps due today or late, late first", () => {
    const rows = buildNextStepsToday(
      [task("a"), task("b"), task("c"), task("d")],
      [step("1", "a"), step("2", "b", { nextStepDue: "2026-09-14" }), step("3", "c", { nextStepDue: "2026-09-20" })],
      "me", today,
    );
    expect(rows.map((r) => r.stepId)).toEqual(["2", "1"]);
    expect(rows[0].late).toBe(true);
  });

  it("uses only the newest open step on a task", () => {
    const rows = buildNextStepsToday([task("a")], [
      step("old", "a", { at: "2026-09-01T00:00:00Z" }),
      step("new", "a", { at: "2026-09-12T00:00:00Z", nextStepDue: "2026-09-25" }),
    ], "me", today);
    expect(rows).toEqual([]);
  });

  it("follows the step owner over the task owner", () => {
    const tasks = [task("a"), task("b", { assigneeId: "other" })];
    const steps = [step("1", "a", { nextStepOwner: "michaella" }), step("2", "b", { nextStepOwner: "me" })];
    expect(buildNextStepsToday(tasks, steps, "me", today).map((r) => r.stepId)).toEqual(["2"]);
  });

  it("lists a task that only has a follow up date, and skips done tasks", () => {
    const rows = buildNextStepsToday([task("a", { followUpAt: "2026-09-15" }), task("b", { followUpAt: "2026-09-15", status: "done" })], [], "me", today);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stepId: null, text: "Check back on this task", late: true });
  });

  it("orders today's by time", () => {
    const rows = buildNextStepsToday([task("a"), task("b"), task("c")], [
      step("1", "a"), step("2", "b", { nextStepTime: "15:00" }), step("3", "c", { nextStepTime: "09:00" }),
    ], "me", today);
    expect(rows.map((r) => r.stepId)).toEqual(["3", "2", "1"]);
  });
});

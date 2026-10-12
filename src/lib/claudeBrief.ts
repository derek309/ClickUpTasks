// What every "Copy for Claude" brief tells Claude about working the steps
// (Derek, 2026-10-12: the copy buttons should carry the steps and how to work
// them, from the list, a task or a step). The tools named here are the
// ClickUpTasks connection's (mcp/core.mjs).
import { currentStep, planSteps, type Subtask } from "./data";

export const STEP_TOOLS = [
  "How to work it (ClickUpTasks connection):",
  "- get_task <task id> shows the steps in order, the current one marked, with directions, to-dos and the client work on each.",
  "- Finish a step with check_item <task id> <step id>: the next step starts like it does in the app.",
  "- Tick a to-do with check_todo <task id> <to-do id>; a client's change request is resolved on their page too.",
  "- An email to the client: draft_email (it gets its own step, or pass step to put it on one). Nothing is sent; a teammate reads and sends it.",
  "- Found more to do? add_checklist_items adds steps. Last step done and nothing left: set_task_status done.",
].join("\n");

/** "Step 2 of 3: Email Pam", or null for a task without steps. */
export function currentStepLine(subtasks: Subtask[]): string | null {
  const plan = planSteps(subtasks);
  if (!plan.length) return null;
  const cur = currentStep(subtasks);
  if (!cur) return `all ${plan.length} steps done`;
  return `step ${plan.findIndex((x) => x.id === cur.id) + 1} of ${plan.length}: ${cur.title}`;
}

/** The plan, one line a step, with ids, the current one marked. */
export function stepsForClaude(subtasks: Subtask[], nameOf: (id: string) => string | null): string[] {
  const plan = planSteps(subtasks);
  const cur = currentStep(subtasks);
  return plan.map((x, i) => {
    const bits = [
      x.done ? x.outcome ?? "done" : x.id === cur?.id ? "CURRENT" : null,
      !x.done && x.due ? `due ${x.due}` : null,
      x.onClient ? "on the client" : x.assigneeId ? nameOf(x.assigneeId) : null,
      (x.todos ?? []).length ? `${(x.todos ?? []).filter((t) => t.done).length} of ${(x.todos ?? []).length} to-dos` : null,
    ].filter(Boolean);
    return `${i + 1}. [${x.done ? "x" : x.id === cur?.id ? ">" : " "}] ${x.title} [${x.id}]${bits.length ? ` · ${bits.join(" · ")}` : ""}`;
  });
}

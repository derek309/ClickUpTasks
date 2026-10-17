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
  "- An email to the client: draft_email (it goes on the current step, or pass step to put it on one). Nothing is sent; a teammate reads and sends it.",
  "- Review comments: get_review lists them with ids, and the files on them (open one with view_review_file). A new version (write_document or add_review_version) takes resolve_comments with the ids it answers, or \"all\"; update_review_comment resolves one.",
  "- Before you stop: tick every step and to-do your work finished, not only the step you were given (For Claude), so the current step is what the person does next. An answer to a client's question that goes out in an email: put that email on the step holding the question (draft_email with step), so sending it finishes that step.",
  "- Found more to do? One step at a time: add it as to-dos on the current step (update_step add_todos); add_checklist_items adds the one next step only once no step is open. Last step done and nothing left: set_task_status done.",
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

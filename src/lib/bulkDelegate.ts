// Handing several tasks to one person in a single pass.
//
// The dock already collects everything one handoff decides, and doing that
// nine times to hand a VA nine tasks is nine times the same brief, the same
// date and the same person, typed again. What actually differs between those
// nine is the task itself, so that is the only thing this does not ask for.
//
// Pure: a selection and one shared brief in, one DelegateSpec per task out.
import { delegationTitle, type DelegateSpec, type Priority, type TaskSize } from "./data";

/** The parts of a handoff that are the same for every task in the batch. */
export type BulkDelegateSpec = {
  toId: string;
  instructions: string;
  /** When THEY owe them. */
  theirDue: string;
  /** When each comes back to you if you have heard nothing. */
  followUpAt: string | null;
  size: TaskSize | null;
  /** Null leaves every task on the priority it already has. */
  priority: Priority | null;
};

/** Just enough of a task to hand it over. */
export type DelegatableTask = { id: string; title: string; priority: Priority };

/** Why this batch cannot go yet, or null when it can. The same three refusals
 *  the dock makes for a single handoff: without a person, an instruction and a
 *  date they owe it by, there is no handoff, only a note that reads like one. */
export function bulkDelegateProblem(spec: BulkDelegateSpec, count: number): string | null {
  if (count === 0) return "Select some tasks first.";
  if (!spec.toId) return "Pick who you are handing these to.";
  if (!spec.instructions.trim()) return "Say what they need to do.";
  if (!spec.theirDue) return "Give them a date to have these by.";
  return null;
}

/**
 * One handoff per task, all sharing the brief.
 *
 * Each is named after its own task rather than after the brief. A single
 * handoff names itself from what you wrote, which reads well when there is one
 * of them; do that to nine and the person on the other end gets nine identical
 * rows on their list and has to open each to tell them apart.
 */
export function bulkDelegations(tasks: DelegatableTask[], spec: BulkDelegateSpec): { taskId: string; spec: DelegateSpec }[] {
  const instructions = spec.instructions.trim();
  return tasks.map((t) => ({
    taskId: t.id,
    spec: {
      toId: spec.toId,
      // Falls back the way the dock does when a task somehow has no title.
      title: t.title.trim() || delegationTitle(instructions),
      instructions,
      theirDue: spec.theirDue,
      followUpAt: spec.followUpAt,
      size: spec.size,
      // No choice means no change: every task keeps what it had.
      priority: spec.priority ?? t.priority,
      // Links ride in the instructions, as they do for a single handoff.
      links: [],
    },
  }));
}

/** What the toast says afterwards. */
export const bulkDelegateSummary = (count: number, toName: string): string =>
  `Delegated ${count} task${count === 1 ? "" : "s"} to ${toName}`;

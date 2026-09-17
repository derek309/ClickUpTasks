// Every next step that is yours and due today or late, across every task, in
// one list (Derek, 2026-09-16, next step card part 3). You tick, move or open
// them without going task by task.
//
// Pure: tasks and open steps in, rows out, so what lands on the list can be
// tested on its own.
import { followUpMoves, type Comment, type TaskAction, type TaskStatus } from "./data";

export type NextStepTask = {
  id: string; title: string; clientId: string; assigneeId: string | null;
  followUpAt?: string | null; status: TaskStatus; comments: Pick<Comment, "kind" | "body" | "at">[];
};

export type NextStepRow = {
  key: string;
  taskId: string;
  taskTitle: string;
  clientId: string;
  /** The step's own id; null when the task only has a follow up date. */
  stepId: string | null;
  text: string;
  due: string;
  time: string | null;
  ownerId: string | null;
  watch: string | null;
  moves: number;
  late: boolean;
};

/** The newest open step on each task: the one its Next step card shows. */
function openStepByTask(steps: TaskAction[]): Map<string, TaskAction> {
  const byTask = new Map<string, TaskAction>();
  for (const s of steps) {
    if (!s.nextStep || s.nextStepDoneAt) continue;
    const have = byTask.get(s.taskId);
    if (!have || s.at > have.at) byTask.set(s.taskId, s);
  }
  return byTask;
}

export function buildNextStepsToday(tasks: NextStepTask[], steps: TaskAction[], meId: string, today: string): NextStepRow[] {
  const open = openStepByTask(steps);
  const rows: NextStepRow[] = [];
  for (const t of tasks) {
    if (t.status === "done") continue;
    const step = open.get(t.id);
    // A step is for its own owner if it has one, otherwise for the task owner.
    const ownerId = step?.nextStepOwner ?? t.assigneeId;
    if (ownerId !== meId) continue;
    const due = (step ? (step.nextStepDue ?? t.followUpAt) : t.followUpAt) ?? null;
    if (!due || due > today) continue;
    rows.push({
      key: step ? step.id : `fu_${t.id}`,
      taskId: t.id, taskTitle: t.title, clientId: t.clientId,
      stepId: step?.id ?? null,
      text: step?.nextStep ?? "Check back on this task",
      due, time: step?.nextStepTime ?? null, ownerId, watch: step?.nextStepWatch ?? null,
      moves: step ? followUpMoves(t.comments, step.at) : 0,
      late: due < today,
    });
  }
  // Late first, the longest late at the top; then today's, the ones with a
  // time in time order, the rest after.
  return rows.sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    if (a.due !== b.due) return a.due.localeCompare(b.due);
    return (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
  });
}

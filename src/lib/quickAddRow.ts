// Turning typed text into task rows WITHOUT asking anyone's permission, least
// of all a model's.
//
// Every way into a task used to go through the AI: the composer's quick button
// called parse-tasks with single:true, and the New task form had a cleanup pass
// that rewrote any title over 80 characters seconds after it was saved. So
// "just add a task" meant waiting on Gemini and getting back a sentence you did
// not write (Derek, 2026-09-28: "we need a quick way that we can just add a
// task and it's just created without changing the name or title").
//
// This is the other half of that: pure, synchronous, offline-proof. The AI
// paths still exist, on their own buttons, chosen deliberately.
import type { Priority, TaskSize } from "./data";

/** One row on its way to becoming a task. Mirrors MindDumpModal's ParsedRow,
 *  declared here so this module owes nothing to a React component. */
export type TaskRow = {
  title: string;
  description: string;
  verbatim: string;
  assignee: string | null;
  due: string | null;
  followUpAt: string | null;
  size: TaskSize | null;
  priority: Priority;
  /** False only when a priority was chosen by hand: see applyDumpDefaults. */
  priorityAuto: boolean;
  keep: boolean;
};

const emptyRow = (): TaskRow => ({
  title: "", description: "", verbatim: "", assignee: null, due: null,
  followUpAt: null, size: null, priority: "normal", priorityAuto: true, keep: true,
});

/** Your words, as a task. The first line is the title and the rest is the
 *  description.
 *
 *  Deliberately NOT truncated. The old fallback cut the title at 70 characters
 *  and pushed the tail into the description, which is a rewrite by another
 *  name; the list clamps long titles visually anyway (GroupedList's
 *  line-clamp-2, full text in the tooltip), so the cut bought nothing and cost
 *  the one guarantee this path exists to make. */
export function verbatimTaskRow(text: string): TaskRow {
  const trimmed = text.trim();
  const firstBreak = trimmed.indexOf("\n");
  return {
    ...emptyRow(),
    title: firstBreak === -1 ? trimmed : trimmed.slice(0, firstBreak).trim(),
    description: firstBreak === -1 ? "" : trimmed.slice(firstBreak + 1).trim(),
  };
}

/** A pasted list, one task per line, in the order you wrote them.
 *
 *  Blank lines are separators rather than tasks, and a leading bullet or
 *  number is punctuation rather than part of the title: pasting from a doc or
 *  an email should not leave "- " and "3. " sitting in the task list. Nothing
 *  else about the line is touched. */
export function linesToRows(text: string): TaskRow[] {
  return text.split("\n")
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ ...emptyRow(), title: line }));
}

export type DumpDefaults = {
  due: string | null;
  followUpAt: string | null;
  assignee: string | null;
  priority: Priority;
  /** True once the priority select has actually been used. Until then the
   *  chosen value is only the default sitting in the box, and the task keeps
   *  its automatic, date-derived priority (effectivePriority in lib/data). */
  priorityTouched: boolean;
  size: TaskSize | null;
};

/** Fills in everything a row did not answer for itself, so nothing arrives
 *  half made. A row that names its own date or owner (because the AI read one
 *  out of the text) keeps it; the defaults only fill the gaps. */
export function applyDumpDefaults(rows: TaskRow[], d: DumpDefaults): TaskRow[] {
  return rows.map((r) => ({
    ...r,
    due: r.due ?? d.due,
    followUpAt: d.followUpAt,
    size: r.size ?? d.size,
    assignee: r.assignee ?? d.assignee,
    // The AI reserves "urgent" for text that says so, so it wins over the
    // default. Anything else takes the chosen value.
    priority: r.priority === "urgent" ? "urgent" : d.priority,
    // A priority chosen by hand sticks (Derek, 2026-09-28). Left automatic it
    // keeps following the due date, which is what it does for every task made
    // anywhere else in the app.
    priorityAuto: d.priorityTouched || r.priority === "urgent" ? false : r.priorityAuto,
    keep: true,
  }));
}

// The box for a new step (Derek, 2026-10-17): laid out as the step card is,
// top to bottom the title, its Description, its Checklist, + Add ▾ and the
// turn sentence ("Your turn, due Tomorrow"), then one button that follows
// whose turn it is. The rules it saves by live here, so they can be tested
// without drawing anything.
import { CLAUDE_ID, type StepTodo, type Subtask } from "./data";
import { descriptionHtml } from "./aiSteps";

/** What the box hands back on save. `who` is a member id, Claude's, "client"
 *  or null for whoever is adding it; `action` is a + Add item's key. */
export type NewStepValue = { title: string; description: string; todos: string[]; who: string | null; when: string; action: string | null };

/** The box's button, by whose turn: Add step for you, Give to Michaella,
 *  Give to Claude, Write Brian's email for the client. */
export function newStepButton(who: string | null, o: { meId: string | null; clientFirst: string; nameOf: (id: string) => string }): string {
  if (who === "client") return `Write ${o.clientFirst}'s email`;
  if (who === CLAUDE_ID) return "Give to Claude";
  if (!who || who === o.meId) return "Add step";
  return `Give to ${o.nameOf(who)}`;
}

/** Claude's turn is always today; anyone else's keeps the date picked. */
export const newStepWhen = (who: string | null, when: string, today: string): string => (who === CLAUDE_ID ? today : when);

/** Whether there is enough to make a step: a name, something picked from
 *  + Add, or someone else's turn (each names it: "For Claude"). */
export function canSaveNewStep(v: Pick<NewStepValue, "title" | "action" | "who">, meId: string | null): boolean {
  return !!v.title.trim() || !!v.action || (!!v.who && v.who !== meId);
}

/** The description and to dos as step fields, empty ones dropped. */
export function newStepFields(v: Pick<NewStepValue, "description" | "todos">, makeId: () => string): Pick<Subtask, "notes" | "todos"> {
  const notes = descriptionHtml(v.description);
  const todos: StepTodo[] = v.todos.map((t) => t.trim()).filter(Boolean).map((title) => ({ id: makeId(), title, done: false }));
  return { ...(notes ? { notes } : {}), ...(todos.length ? { todos } : {}) };
}

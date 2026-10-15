// Step 1 set up inside the new task box (Derek, 2026-10-14): the same three
// rows as everywhere (Whose turn, By when, What's the action). The task is
// made with step 1 already holding what was picked, as + Add step does for a
// new step: a document, image, HTML review or video is put on it, shown, not
// opened; an email, a text or a portal chat is drafted on it and its window
// opens; To dos and Directions open the step's page on their box; the
// client's turn opens the ask, as Delegate to the client does.
//
// Pure: the steps the task is made with in, the steps with step 1 set up and
// what (if anything) to open on the task once it is saved out. A teammate's
// or Claude's turn is the composer's own handoff (useComposer), not this.
import { holdOnStep, isLongTitle, planSteps, type Subtask } from "./data";
import type { StepOneSetup } from "./quickAddRow";

export type StepOneOpen = "checklist" | "directions" | "email" | "text" | "chat" | "ask";

const DELIVERABLES = new Set(["doc", "image", "page", "video"]);

/** A step named for the task: a name that is the whole request is cut to its
 *  first words, as directionsOntoStepOne names one. */
export function stepNameFor(title: string): string {
  const named = title.replace(/\s+/g, " ").trim();
  return (isLongTitle(named) ? named.replace(/[.!?]\s[\s\S]*$/, "").split(" ").slice(0, 8).join(" ") : named) || "Work out what is needed";
}

/** Whether the set up asks for a step 1 at all: an action, the client's
 *  turn or a date picked by hand. Left alone it makes no step, as before. */
export function stepOneWanted(setup: StepOneSetup | null | undefined, meId: string): boolean {
  if (!setup) return false;
  return !!setup.action || setup.who === "client" || setup.whenSet || (!!setup.who && setup.who !== meId);
}

export function applyStepOne(subtasks: Subtask[], o: {
  setup: StepOneSetup | null | undefined;
  title: string;
  /** The task's owner, for whose step it is. */
  owner: string;
  meId: string;
  today: string;
  now: string;
  makeId: () => string;
}): { subtasks: Subtask[]; stepId: string | null; open: StepOneOpen | null } {
  const s = o.setup;
  if (!s || !stepOneWanted(s, o.meId)) return { subtasks, stepId: null, open: null };
  let list = subtasks;
  let step = planSteps(list).find((x) => !x.done) ?? null;
  if (!step) {
    // Whoever added it, when that is the task's owner; a step on someone
    // else's task is noted as theirs (TaskDrawer stepOwnerFields).
    step = { id: o.makeId(), title: stepNameFor(o.title), done: false, startedAt: o.now, ...(o.owner === o.meId ? { assigneeId: o.meId } : { addedBy: o.meId }) };
    list = [step, ...list];
  }
  const id = step.id;
  const edit = (f: (x: Subtask) => Subtask) => { list = list.map((x) => (x.id === id ? f(x) : x)); };
  // By when: the step's own date, unless the handoff already gave it one.
  if (s.when && !step.due) edit((x) => ({ ...x, due: s.when! }));
  const a = s.action;
  let open: StepOneOpen | null = null;
  // An Email review or a Page review is the HTML review with its kind kept on the step.
  const pageKind = a === "page:email" ? "email" as const : a === "page:page" ? "page" as const : null;
  const held = pageKind ? "page" : a;
  if (held && DELIVERABLES.has(held)) {
    list = holdOnStep(list, id, held);
    edit((x) => ({ ...x, madeHere: [...new Set([...(x.madeHere ?? []), held])], ...(pageKind ? { pageKind } : {}) }));
  } else if (a === "email") {
    list = holdOnStep(list, id, "email");
    edit((x) => ({ ...x, due: o.today }));
    open = "email";
  } else if (a === "text" || a === "chat") {
    edit((x) => ({ ...x, due: o.today, draftMessage: { channel: a === "text" ? "sms" as const : "chat" as const, body: "" } }));
    open = a;
  } else if (a === "checklist" || a === "directions") {
    open = a;
  }
  // The client's turn: the ask is written on the task (askClientOn).
  if (!open && s.who === "client") open = "ask";
  return { subtasks: list, stepId: id, open };
}

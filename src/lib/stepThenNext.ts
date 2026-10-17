// The step, then what's next (Derek, 2026-10-17, step-done-then-next-mockup.html):
// while a step is worked its card is about the step alone, top to bottom the
// title, whose turn and when, its Description, its Checklist, what it uses,
// + Add and one Done. What comes after it is asked only once it is done, in
// What's next. The rules the card and What's next follow live here, so they
// can be read and tested without drawing anything.
import { CLAUDE_ID, type StepTodo, type Subtask } from "./data";
import { isClientWait } from "./afterThis";

/** Whose turn a step is, as the card reads it. */
export type Turn = "me" | "teammate" | "client" | "claude";

export function turnOf(s: Pick<Subtask, "onClient" | "finishWhen" | "stage" | "assigneeId"> & Partial<Pick<Subtask, "title">>, o: { meId: string | null; ownerId: string | null }): Turn {
  if (s.onClient || isClientWait(s)) return "client";
  if (s.assigneeId === CLAUDE_ID) return "claude";
  const who = s.assigneeId ?? o.ownerId;
  if (!who || who === o.meId) return "me";
  return "teammate";
}

/** The step's description, led by its words on a client's or Claude's turn
 *  (Derek, 2026-10-17): on the client's turn it is what the portal's orange
 *  box and the reminders say (portalRequests whatWeNeed), on Claude's what the
 *  cloud routine reads. The field is the step's directions (notes) either way. */
export function descriptionLabel(turn: Turn, clientFirst: string): { label: string; tone: "client" | "claude" | null } {
  if (turn === "client") return { label: `What we need from ${clientFirst}`, tone: "client" };
  if (turn === "claude") return { label: "What Claude should do", tone: "claude" };
  return { label: "Description", tone: null };
}

export type CardSection = "description" | "checklist" | "using" | "add" | "done";

/** What the working card shows, in order. Nothing empty shows: no
 *  Description or Checklist heading without something under it (or one being
 *  written). */
export function workingSections(o: {
  done: boolean;
  description: boolean;
  /** To dos on it, from the client's portal too, or the add box opened. */
  checklist: boolean;
  /** What the step uses: its email, document, review, files. */
  using: boolean;
  /** + Add has something to offer (not on a client's wait). */
  canAdd: boolean;
  /** Done (or Send, or the wait's own answers) shows. */
  canFinish: boolean;
}): CardSection[] {
  const out: CardSection[] = [];
  if (o.description) out.push("description");
  if (o.checklist) out.push("checklist");
  if (o.using) out.push("using");
  if (!o.done && o.canAdd) out.push("add");
  if (!o.done && o.canFinish) out.push("done");
  return out;
}

/** + Add's first items: Checklist and Description, each only while the step
 *  has none (both when it is empty). */
export function addLeadItems(o: { description: boolean; checklist: boolean }): ("checklist" | "description")[] {
  return [...(o.checklist ? [] : ["checklist" as const]), ...(o.description ? [] : ["description" as const])];
}

/** Ticking this to do finishes the step: it was open, and every other to do
 *  (the client's portal ones too) is done. Ticking the last one is Done. */
export function lastTickFinishes(todos: Pick<StepTodo, "id" | "done">[], tickedId: string, clientItems: Pick<Subtask, "done">[] = []): boolean {
  const t = todos.find((x) => x.id === tickedId);
  if (!t || t.done) return false;
  return todos.every((x) => x.id === tickedId || x.done) && clientItems.every((c) => c.done);
}

/** What's next's button, by whose turn is picked: Save for you, Give to
 *  Justin, Give to Claude, Write Brian's email for the client. */
export function whatsNextButton(who: string | null, o: { meId: string | null; clientFirst: string; nameOf: (id: string) => string }): string {
  if (who === "client") return `Write ${o.clientFirst}'s email`;
  if (who === CLAUDE_ID) return "Give to Claude";
  if (!who || who === o.meId) return "Save";
  return `Give to ${o.nameOf(who)}`;
}

/** The line under What's next saying what the button will do. */
export function whatsNextSays(who: string | null, o: { meId: string | null; clientFirst: string; nameOf: (id: string) => string }): string {
  if (who === "client") return `We email ${o.clientFirst} the ask and wait for the reply.`;
  if (who === CLAUDE_ID) return "Claude starts on it today.";
  if (!who || who === o.meId) return "It goes on your list.";
  return `It lands on ${o.nameOf(who)}'s list today, and the task shows Delegated.`;
}

/** The step folded after Done: "✓ Hand off · done by Michaella". */
export function doneLine(title: string, doneBy: string | null | undefined, o: { meId: string | null; nameOf: (id: string) => string }): string {
  const name = title.trim() || "Step";
  if (!doneBy) return `✓ ${name} · done`;
  return `✓ ${name} · done by ${doneBy === o.meId ? "you" : o.nameOf(doneBy)}`;
}

/** What the "…" at the end of the turn line offers, by whose turn it is
 *  (Derek, 2026-10-17). Claude's turn has none. */
export type ExtraGroup = "priority" | "onList" | "checkBack" | "reminders";
export function lineExtras(turn: Turn): ExtraGroup[] {
  if (turn === "teammate") return ["priority", "onList", "checkBack"];
  if (turn === "client") return ["reminders", "priority"];
  if (turn === "me") return ["priority"];
  return [];
}

/** The turn word: "Your turn", "Michaella's turn", "Claude's turn", "Brian's turn". */
export function turnWord(who: string | null, o: { meId: string | null; clientFirst: string; nameOf: (id: string) => string }): string {
  if (who === "client") return `${o.clientFirst}'s turn`;
  if (who === CLAUDE_ID) return "Claude's turn";
  if (!who || who === o.meId) return "Your turn";
  return `${o.nameOf(who)}'s turn`;
}

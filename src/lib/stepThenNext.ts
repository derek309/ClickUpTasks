// The step, then what's next (Derek, 2026-10-17, step-done-then-next-mockup.html):
// while a step is worked its card is about the step alone, top to bottom the
// title, whose turn and when, its Description, its Checklist, what it uses,
// + Add and one Done. What comes after it is asked only once it is done, in
// What's next. The rules the card and What's next follow live here, so they
// can be read and tested without drawing anything.
import { CLAUDE_ID, inWindow, stepAfter, type StepTodo, type Subtask, type TaskAction } from "./data";
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
 *  (Derek, 2026-10-17). The client's reminders are a word in the sentence
 *  itself, so their "…" holds Priority only. On a teammate's or Claude's live
 *  step, "If you need to": Take it back and Mark it done (ifNeeded). */
export type ExtraGroup = "priority" | "onList" | "checkBack" | "ifNeeded";
export function lineExtras(turn: Turn): ExtraGroup[] {
  if (turn === "teammate") return ["priority", "onList", "checkBack", "ifNeeded"];
  if (turn === "client") return ["priority"];
  if (turn === "me") return ["priority"];
  return ["ifNeeded"];
}

/** The client's reminders, as the word in their turn line: "reminded every
 *  3 days" or "no reminders" (business days, the step's own remind). */
export function remindWord(every: 2 | 3 | 5 | "once" | null): string {
  if (every === null) return "no reminders";
  if (every === "once") return "reminded once";
  return `reminded every ${every} days`;
}

// ── Give and ask (Derek, 2026-10-17, "Who sees what" and "When Michaella is
// stuck"): a step for someone else is a draft until it is given; a teammate's
// own step has one link, Message <the other person>; her Done comes back to
// whoever gave it.

/** A draft: set up for someone else and not given to them yet. Steps without
 *  draftFor are live, so every step from before stays as it was. */
export const isDraft = (s: Pick<Subtask, "done" | "draftFor">): boolean => !s.done && !!s.draftFor;

/** Picking whose turn on a step that has not been handed off (the viewer's
 *  own, or a draft) only sets whose turn it will be: someone else makes it a
 *  draft for them, yourself makes it yours and live. A step already with
 *  someone else changes hands straight away, as before. Returns the step's
 *  new draftFor ("" to clear it), or null to delegate at once. */
export function pickOnStep(s: Pick<Subtask, "done" | "draftFor"> & Partial<Pick<Subtask, "assigneeId">>, turn: Turn, picked: string, meId: string | null, ownerId: string | null = null): string | null {
  if (s.done) return null;
  // Given to someone already (her step, though she is the one looking): it
  // changes hands at once, as before.
  if (!isDraft(s) && (turn !== "me" || (!!s.assigneeId && s.assigneeId !== ownerId))) return null;
  return picked === meId ? "" : picked;
}

/** Who gave the step: recorded when it was given, else the task's owner. */
export const giverOf = (s: Pick<Subtask, "givenBy">, ownerId: string | null): string | null => s.givenBy ?? ownerId;

/** The one button at the foot of a working step, for the person looking:
 *  "give" on a draft (Give to Michaella), "done" when it is their own turn,
 *  "answered" for the owner on the client's live step (Brian answered),
 *  "none" for the giver on a teammate's or Claude's live step (it is theirs
 *  to finish; Mark it done for her is in "…"). */
export type FinishButton = "give" | "done" | "answered" | "none";
export function finishButton(s: Pick<Subtask, "done" | "draftFor">, turn: Turn): FinishButton | null {
  if (s.done) return null;
  // Only whoever is setting it up gives it; anyone else looking has nothing to press.
  if (isDraft(s)) return turn === "me" ? "give" : "none";
  if (turn === "me") return "done";
  if (turn === "client") return "answered";
  return "none";
}

/** The draft's button: Give to Michaella, Give to Claude, Write Brian's email. */
export function giveLabel(to: string, o: { clientFirst: string; nameOf: (id: string) => string }): string {
  if (to === "client") return `Write ${o.clientFirst}'s email`;
  if (to === CLAUDE_ID) return "Give to Claude";
  return `Give to ${o.nameOf(to)}`;
}

/** Who the step's Message link writes to, or null for none: on a teammate's
 *  live step she writes to whoever gave it to her (Message Derek), anyone
 *  else writes to her (Message Michaella). The client's and Claude's steps
 *  have their own channels, and a draft or a done step has none. */
export function messageTo(s: Pick<Subtask, "done" | "draftFor" | "givenBy" | "assigneeId">, turn: Turn, o: { meId: string | null; ownerId: string | null }): string | null {
  if (s.done || isDraft(s) || turn !== "teammate" && turn !== "me") return null;
  const holder = s.assigneeId ?? o.ownerId;
  if (!holder || holder === CLAUDE_ID) return null;
  if (holder === o.meId) {
    const giver = giverOf(s, o.ownerId);
    return giver && giver !== o.meId && giver !== CLAUDE_ID ? giver : null;
  }
  return holder;
}

/** What a message on the step changes: from the person whose turn it is to
 *  the giver (Message Derek), it is a question for the giver until they
 *  reply; the giver's reply, by Message or on the thread, clears it. Anything else changes nothing (null). The turn never moves. */
export function questionAfter(s: Pick<Subtask, "assigneeId" | "givenBy" | "question">, msg: { from: string; to: string | null; text: string; at: string }, ownerId: string | null): { question: Subtask["question"] } | null {
  const holder = s.assigneeId ?? ownerId;
  const giver = giverOf(s, ownerId);
  if (holder && msg.from === holder && msg.from !== giver && giver && msg.to === giver) {
    const first = msg.text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    return { question: { from: msg.from, to: giver, text: first.slice(0, 200), at: msg.at } };
  }
  if (s.question && msg.from === s.question.to) return { question: undefined };
  return null;
}

/** The question waiting on this person, or null. */
export const questionFor = (s: Pick<Subtask, "done" | "question">, meId: string | null): Subtask["question"] | null =>
  !s.done && s.question && meId && s.question.to === meId ? s.question : null;

/** Who hears about a message on a step, once each: the person it is to,
 *  anyone @mentioned, and, on a reply in the thread, the people already in
 *  it. Never the sender, the client or Claude. */
export function stepMessageNotices(o: { from: string; to: string | null; mentioned: string[]; inThread?: string[] }): string[] {
  const out: string[] = [];
  for (const id of [o.to, ...o.mentioned, ...(o.inThread ?? [])]) {
    if (!id || id === o.from || id === CLAUDE_ID || id === "client" || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Where a Done lands. The giver, or the owner on their own step: What's next
 *  opens for them as always ("next"). Someone else whose step it was (a
 *  teammate, Claude): it comes back to the giver at What's next and they get
 *  no What's next themselves ({ back: giver }). */
export function doneLandsWith(s: Pick<Subtask, "assigneeId" | "givenBy">, doneBy: string | null, ownerId: string | null): "next" | { back: string } {
  const giver = giverOf(s, ownerId);
  const holder = s.assigneeId ?? ownerId;
  if (!doneBy || !giver || doneBy === giver || holder !== doneBy) return "next";
  return { back: giver };
}

/** Her Done, back with the giver (doneLandsWith back): the list with a
 *  "what's next?" step for the giver right after the step she finished, so
 *  the giver picks what comes next. Nothing like a "Check her work" step is
 *  added. Null when the plan's next step is the giver's own already (it is
 *  back with them as it is) or it was asked once. */
export function backToGiver(list: Subtask[], doneId: string, giver: string, ownerId: string | null, makeId: () => string, now: string): Subtask[] | null {
  const key = `next:${doneId}`;
  if (list.some((x) => x.addedFor === key)) return null;
  const at = list.findIndex((x) => x.id === doneId);
  if (at < 0) return null;
  const next = stepAfter(list, doneId);
  if (next && !isDraft(next) && !next.onClient && next.finishWhen !== "reply" && next.stage !== "waiting" && (next.assigneeId ?? ownerId) === giver) return null;
  const base = list[at].title.replace(/: what's next\?$/, "").trim() || "Step";
  const out = [...list];
  out.splice(at + 1, 0, { id: makeId(), title: `${base}: what's next?`, done: false, addedFor: key, startedAt: now, ...(giver !== ownerId ? { assigneeId: giver } : {}) });
  return out;
}

/** The turn word: "Your turn", "Michaella's turn", "Claude's turn", "Brian's turn". */
export function turnWord(who: string | null, o: { meId: string | null; clientFirst: string; nameOf: (id: string) => string }): string {
  if (who === "client") return `${o.clientFirst}'s turn`;
  if (who === CLAUDE_ID) return "Claude's turn";
  if (!who || who === o.meId) return "Your turn";
  return `${o.nameOf(who)}'s turn`;
}

// ── The task view (Derek, 2026-10-17): each step reads, it does nothing. Its
// number and name, the turn line to read ("Carol's turn, need by Fri, Oct 16,
// reminded every 3 days") and one quiet line about what it holds. A click
// anywhere on it opens its page, where all the working happens.

/** The turn line as words: "Carol's turn, need by Fri, Oct 16, reminded every 3 days". */
export function turnSentence(word: string, ...rest: (string | null | undefined | false)[]): string {
  return [word, ...rest.filter((x): x is string => !!x && !!x.trim())].join(", ");
}

/** The one quiet line under a step on the task view: what it holds and where
 *  it stands, a few facts at most, or "" for none. A draft says so first. */
export function stepQuietLine(o: {
  /** Whose turn it will be once given, by name. */
  draftFor?: string | null;
  /** The step's description, as text. */
  description?: string;
  /** The client wrote on it: their first name and how long ago. */
  wrote?: { first: string; ago: string } | null;
  /** Its email went out this long ago. */
  sentAgo?: string | null;
  /** What went out, when a send made this wait: the review or email sent
   *  from the step before ("Holiday Pre Order Email"). */
  sentWhat?: string | null;
  /** Waiting on the client's reply to it. */
  noReply?: boolean;
  todos?: { done: number; total: number };
  /** The longer reason it is whose turn ("Claude is working"). */
  reason?: string | null;
  /** A "what's next?" step: the step it follows. */
  after?: string | null;
}): string {
  const parts: string[] = [];
  if (o.draftFor) parts.push(`Draft · not given to ${o.draftFor} yet`);
  if (o.after) parts.push(`After ${o.after}`);
  if (o.wrote) parts.push(`${o.wrote.first} wrote ${o.wrote.ago}`);
  else if (!o.draftFor && o.reason) parts.push(o.reason);
  const desc = (o.description ?? "").replace(/\s+/g, " ").trim();
  if (desc && !o.wrote && !o.after && parts.length < 2) {
    const first = desc.split(/(?<=[.!?])\s/)[0];
    parts.push(first.length > 80 ? `${first.slice(0, 78).trimEnd()}…` : first);
  }
  if (o.sentAgo) parts.push(o.sentWhat?.trim() ? `${o.sentWhat.trim()} sent ${o.sentAgo}` : `sent ${o.sentAgo}`);
  if (o.noReply) parts.push("no reply yet");
  if (o.todos && o.todos.total > 0) parts.push(`${o.todos.done} of ${o.todos.total} to do`);
  return parts.join(" · ");
}

// ── The step's thread (Derek, 2026-10-17: a Message Michaella showed nowhere
// on the step, so it read as not sent). Team messages and notes written while
// the step ran, the same window threadPeople and stepWindow use.

export type ThreadLine = { id: string; who: string; text: string; at: string };

/** The step's thread, oldest first: who wrote ("You to Michaella",
 *  "Michaella"), the words and when. */
export function stepThread(actions: Pick<TaskAction, "id" | "kind" | "authorId" | "toId" | "body" | "at">[], w: { from: string; to: string | null }, o: { meId: string | null; nameOf: (id: string) => string }): ThreadLine[] {
  return actions
    .filter((a) => (a.kind === "team" || a.kind === "note") && !!a.body.trim() && inWindow(a.at, w))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((a) => {
      const from = !a.authorId ? "Someone" : a.authorId === o.meId ? "You" : o.nameOf(a.authorId);
      const to = a.toId && a.toId !== a.authorId ? (a.toId === o.meId ? "you" : o.nameOf(a.toId)) : null;
      // Someone writing to you reads as just their name.
      const who = to && !(to === "you" && from !== "You") ? `${from} to ${to}` : from;
      return { id: a.id, who, text: a.body.trim(), at: a.at };
    });
}

/** The step's latest message as one quiet line for the task view: "You to
 *  Michaella: Did this one get sent out? · just now", or null for none. */
export function latestStepLine(thread: ThreadLine[], ago: (iso: string) => string): string | null {
  const last = thread[thread.length - 1];
  if (!last) return null;
  const first = last.text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const text = first.length > 90 ? `${first.slice(0, 88).trimEnd()}…` : first;
  return `${last.who}: ${text} · ${ago(last.at)}`;
}

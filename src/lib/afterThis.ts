// "After this" at the bottom of the current step (Derek, 2026-10-15, mockup
// step-flow-mockup.html): the next step, named and set up while you work, so
// one move finishes this step and starts that one. It is the plan's own next
// step, nothing kept apart: when the plan has one, After this shows and edits
// it; when it has none, naming one adds it right after this step. Pure, so the
// step page, the task page and the send path agree and it can be tested.

import { CLAUDE_ID, addBusinessDaysIso, asksWhatsNext, planSteps, type DeliverableKey, type StepRemind, type Subtask } from "./data";

/** The step After this shows for `curId`: the first open plan step after it.
 *  A "what's next?" step is still a question, so it is not one. */
export function afterThisOf<T extends Pick<Subtask, "id" | "done" | "fromClient" | "addedFor" | "title">>(subtasks: T[], curId: string): T | null {
  const plan = planSteps(subtasks);
  const at = plan.findIndex((s) => s.id === curId);
  if (at < 0) return null;
  const next = plan.slice(at + 1).find((s) => !s.done) ?? null;
  return next && !asksWhatsNext(next) ? next : null;
}

/** After this is filled: a next step with a name. */
export const afterThisFilled = (s: Pick<Subtask, "title" | "done" | "addedFor"> | null | undefined): boolean =>
  !!s && !s.done && !!s.title.trim() && !asksWhatsNext(s);

/** Done (or Send) on `doneId` opens the What's next card only when After this
 *  is empty: filled, the next step simply starts (Derek, 2026-10-15). */
export const finishOpensWhatsNext = (subtasks: Subtask[], doneId: string): boolean => !afterThisFilled(afterThisOf(subtasks, doneId));

/** Business days from the day a step becomes the client's turn to its need
 *  by date, when nobody picked one (Derek and Justin, 2026-10-15). */
export const NEED_BY_BUSINESS_DAYS = 3;
export const defaultNeedBy = (today: string): string => addBusinessDaysIso(today, NEED_BY_BUSINESS_DAYS);

/** Words after "Waiting on" that are not a person ("Waiting for approval"),
 *  or are us. */
const NOT_A_NAME = new Set(["a", "an", "the", "us", "me", "you", "them", "him", "her", "it", "this", "that", "claude", "team", "approval", "review", "reply", "replies", "payment", "files", "content", "feedback", "info", "information", "answer", "answers", "confirmation", "response", "now", "more", "access", "details"]);

/** An older step that says it waits on the client by name ("Waiting on James
 *  Reply", "Wait for James to send the logo", "Waiting on the client"): the
 *  client's turn too, so those tasks are not asked again (Derek, 2026-10-15).
 *  A step given to someone (a teammate's wait) never is. `first`, when known,
 *  must be the name it says. */
export function waitsOnClientByTitle(title: string | undefined, o: { assigneeId?: string | null; first?: string | null } = {}): boolean {
  if (!title || (o.assigneeId && o.assigneeId !== "client")) return false;
  const m = /^\s*wait(?:ing)?\s+(?:on|for)\s+(?:(the\s+client)\b|([A-Z][A-Za-z'\u2019-]*))/i.exec(title);
  if (!m) return false;
  if (m[1]) return true;
  const name = m[2].replace(/['\u2019]s?$/i, "");
  // A name starts with a capital, and is not a plain word.
  if (!/^[A-Z]/.test(name) || NOT_A_NAME.has(name.toLowerCase())) return false;
  return !o.first?.trim() || name.toLowerCase() === o.first.trim().toLowerCase();
}

/** A wait on the client: the client's turn. */
export const isClientWait = (s: Pick<Subtask, "onClient" | "finishWhen" | "stage"> & Partial<Pick<Subtask, "title" | "assigneeId">>): boolean =>
  !!s.onClient || s.finishWhen === "reply" || s.stage === "waiting" || waitsOnClientByTitle(s.title, { assigneeId: s.assigneeId });

/** Whose turn the next step is: "client", Claude, a person, or null (the task's owner). */
export function afterThisWho(s: Pick<Subtask, "onClient" | "finishWhen" | "stage" | "assigneeId">, ownerId: string | null): string | null {
  if (isClientWait(s)) return "client";
  return s.assigneeId ?? ownerId ?? null;
}

/** What changes on the next step when its turn is picked. The client's turn
 *  is a wait that ends on their reply (its date the check in); Claude's has no
 *  date (always today when it starts) and no reminder; a person's keeps its
 *  date. A reminder that no longer fits the turn comes off. */
export function patchForWho(s: Partial<Subtask>, who: string | null, o: { ownerId: string | null; meId: string | null; today?: string }): Partial<Subtask> {
  const clientRemind = !!s.remind && ("every" in s.remind || "off" in s.remind);
  const teamRemind = !!s.remind && "at" in s.remind;
  // The client's turn gets a need by date 3 business days out when it has
  // none (Derek and Justin, 2026-10-15), and with it reminders on by default.
  if (who === "client") return { finishWhen: "reply", stage: "waiting", assigneeId: undefined, makes: undefined, draftMessage: undefined, ...(clientRemind ? {} : { remind: undefined }),
    ...(!s.due && o.today ? { due: defaultNeedBy(o.today) } : {}) };
  const base: Partial<Subtask> = { finishWhen: undefined, stage: undefined, assigneeId: who ?? undefined };
  if (who === CLAUDE_ID) return { ...base, due: undefined, remind: undefined };
  const mine = !who || who === o.meId || (who === o.ownerId && !o.meId);
  return { ...base, ...(teamRemind && !mine ? {} : { remind: undefined }) };
}

/** The action words After this offers, by turn: the client's turn waits for
 *  their reply; a person's turn picks what the step makes or writes (the set
 *  up's list); Claude works from the directions, so none. */
export type AfterAction = "wait" | DeliverableKey | "text" | "chat";
export const ACTION_WORDS: Record<Exclude<AfterAction, "wait" | "brief">, string> = {
  email: "write an email", text: "send a text", chat: "chat in the portal", doc: "make a document", image: "make an image", page: "build an HTML review", video: "make a video",
};
export function afterThisAction(s: Pick<Subtask, "onClient" | "finishWhen" | "stage" | "makes" | "draftMessage">): AfterAction | null {
  if (isClientWait(s)) return "wait";
  if (s.draftMessage) return s.draftMessage.channel === "sms" ? "text" : "chat";
  return s.makes ?? null;
}
/** The step's fields for an action picked (null clears it). */
export function patchForAction(a: AfterAction | null): Partial<Subtask> {
  if (a === "text" || a === "chat") return { makes: undefined, draftMessage: { channel: a === "text" ? "sms" : "chat", body: "" } };
  if (!a || a === "wait") return { makes: undefined, draftMessage: undefined };
  return { makes: a, draftMessage: undefined };
}

/** Whose turn takes a reminder: the client's or a teammate's, never Claude's
 *  or your own. */
export function remindKind(who: string | null, o: { ownerId: string | null; meId: string | null }): "client" | "teammate" | null {
  if (who === "client") return "client";
  if (!who || who === CLAUDE_ID || who === o.meId || (!o.meId && who === o.ownerId)) return null;
  return "teammate";
}

/** The reminder word once picked: "email Pamela on Fri, Oct 17" (once, at
 *  the check in), "remind Pamela every 2 days", "remind Justin the day
 *  before", "remind Justin the morning it's due". `checkIn` is the check in
 *  date as words. */
export function remindWord(r: StepRemind, name: string, checkIn?: string | null): string {
  if ("off" in r) return "reminders off";
  if ("every" in r) return r.every === "once" ? (checkIn ? `email ${name} on ${checkIn}` : `email ${name} at check in`) : `remind ${name} every ${r.every} days`;
  return r.at === "day_before" ? `remind ${name} the day before` : `remind ${name} the morning it's due`;
}

/** Finishing `doneId` and starting the next step already set up, in one list:
 *  the step ticked with its outcome, the next one stamped as started. Null
 *  when there is no next step. */
export function finishIntoNext(subtasks: Subtask[], doneId: string, o: { now: string; outcome: string; byId?: string | null }): { subtasks: Subtask[]; next: Subtask } | null {
  const next = afterThisOf(subtasks, doneId);
  if (!next || !afterThisFilled(next)) return null;
  const list = subtasks.map((s) => (s.id === doneId ? { ...s, done: true, doneAt: s.doneAt ?? o.now, outcome: o.outcome, ...(o.byId ? { doneBy: o.byId } : {}) }
    : s.id === next.id && !s.startedAt ? { ...s, startedAt: o.now } : s));
  return { subtasks: list, next: list.find((s) => s.id === next.id)! };
}

/** A next step named in After this when the plan has none: right after `curId`. */
export function addAfterThisStep(subtasks: Subtask[], curId: string, title: string, id: string, fields: Partial<Subtask> = {}): Subtask[] {
  const at = subtasks.findIndex((s) => s.id === curId);
  const list = [...subtasks];
  list.splice(at < 0 ? list.length : at + 1, 0, { ...fields, id, title, done: false });
  return list;
}

/** An emailing step's own name: "Email Pam", "Reply to Pam", "Let Pam know…"
 *  (lib/talkSend's EMAILING, kept here so the two read the same). */
const TALKS = /^(email|e-mail|let\b.*\bknow|tell|send|reply|answer|write to)\b/i;

/** What After this suggests while it is empty (Derek, 2026-10-15): after a
 *  reply or an email to the client, waiting for their reply, their turn, the
 *  check in two business days out, no reminder. Only a suggestion: nothing is
 *  saved until Send or Done takes it (or a word of it is changed). Null for
 *  any other step. */
export function suggestedAfter(cur: Pick<Subtask, "title" | "done" | "onClient" | "fromEmails" | "holds" | "assigneeId" | "finishWhen">, firstName: string, today: string): Pick<Subtask, "title" | "finishWhen" | "stage" | "due"> | null {
  if (cur.done || cur.onClient || cur.finishWhen === "reply" || cur.assigneeId === CLAUDE_ID) return null;
  const talks = !!cur.fromEmails?.length || (cur.holds ?? []).includes("email") || TALKS.test(cur.title.trim());
  if (!talks) return null;
  return { title: `Wait for ${firstName}'s reply`, finishWhen: "reply", stage: "waiting", due: defaultNeedBy(today) };
}

/** Done's words with After this filled: what happens next (Derek, 2026-10-15):
 *  "Done · Pamela's turn next", "Done · your turn next", "Done · Claude next". */
export function doneNextLabel(who: string | null, o: { meId: string | null; ownerId: string | null; clientFirst: string; nameOf: (id: string) => string }): string {
  if (who === "client") return `Done · ${o.clientFirst}'s turn next`;
  if (who === CLAUDE_ID) return "Done · Claude next";
  const person = who ?? o.ownerId;
  if (!person || person === o.meId) return "Done · your turn next";
  return `Done · ${o.nameOf(person)}'s turn next`;
}

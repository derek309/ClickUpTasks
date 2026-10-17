// What sending an email, text or chat to the client does to a task's steps,
// worked out without the task page open: the task page (TaskDrawer's
// finishTalkStep) and the client page's Conversation feed send through the
// same two functions, so a draft sent from either place moves the steps the
// same way (Derek, 2026-10-14, client header).
import { addBusinessDaysIso, addCheckInStep, answerReceived, currentStep, isHandoffStep, isReplyStep, recordFollowUp, statusForStep, stepStage, unansweredOn, type Subtask, type Task } from "./data";
import { afterThisFilled, afterThisOf, finishIntoNext, isClientWait } from "./afterThis";

/** An emailing step, by its name: "Email Pam", "Let Pam know…", "Tell", "Send", "Reply". */
export const EMAILING = /^(email|e-mail|let\b.*\bknow|tell|send|reply|answer|write to)\b/i;

/** after: the step's After this, filled (lib/afterThis): the send finishes
 *  the step and starts it, with no check in of its own and no What's next.
 *  "answered": the reply to the client's message on a step doing other work
 *  went; the message is answered and the step stays open. */
export type TalkPlan = { kind: "reminder" | "wait" | "finish" | "answered"; cur: Subtask; due: string; holder?: Subtask; after?: Subtask };

/** A step whose own work is writing to them ("Email Pam", "Text Pam"). */
const talksByName = (s: Pick<Subtask, "title">) => EMAILING.test(s.title.trim()) || /^(text|chat)\b/i.test(s.title.trim());

/** Which step a send finishes or follows up on, and the check in's date.
 *  Sent from a step's own page: that step. An email from the task's email
 *  window: the open step holding that email, else the current one. A reply
 *  (replyTo) to the client's message on a step doing other work only marks
 *  it answered (Derek, 2026-10-17: their message joins the current step);
 *  a text or chat answers what waits on its step the same way. */
export function talkStepPlan(subtasks: Subtask[], taskOwnerId: string | null, channel: "email" | "sms" | "chat", today: string, followUpDate?: string | null, stepId?: string, replyTo?: string | null): TalkPlan | null {
  const replied = channel === "email" && replyTo ? subtasks.find((x) => !x.done && x.fromEmails?.some((e) => e.messageId === replyTo && !e.answeredAt)) : undefined;
  if (replied && (!stepId || replied.id === stepId) && !isReplyStep(replied) && !talksByName(replied)) return { kind: "answered", cur: replied, due: today };
  const holder = !stepId && channel === "email" ? subtasks.find((x) => !x.done && x.holds?.includes("email")) : undefined;
  const cur = stepId ? subtasks.find((x) => x.id === stepId && !x.done) : holder ?? currentStep(subtasks);
  if (cur && channel !== "email" && unansweredOn(cur) && !isReplyStep(cur) && !talksByName(cur)) return { kind: "answered", cur, due: today };
  // A reminder held on a review out with the client: a follow up on that
  // wait, and the email comes off the step.
  if (cur?.onClient && channel === "email" && cur.holds?.includes("email")) return { kind: "reminder", cur, due: followUpDate || addBusinessDaysIso(today, 2) };
  if (!cur || cur.onClient || isHandoffStep(cur, taskOwnerId)) return null;
  const name = cur.title.trim();
  // The "Follow up in" picked beside Send: the check in, the task's follow
  // up, and a due date already earlier all move to it. Three business days
  // when none was picked.
  const due = followUpDate || addBusinessDaysIso(today, 3);
  // Sent while waiting on them (a check in is current): a follow up on that
  // wait, its date moved, not a step done.
  if (cur.finishWhen === "reply") return { kind: "wait", cur, due };
  const fits = channel === "email" ? cur.holds?.includes("email") || EMAILING.test(name)
    : cur.draftMessage?.channel === channel || (channel === "sms" ? /^text\b/i.test(name) : /^chat\b/i.test(name));
  if (!fits) return null;
  // After this is set up: a wait on the client takes its own check in date
  // (the follow up is that wait's, never a due date's); anything else simply
  // starts (Derek, 2026-10-15).
  const after = afterThisOf(subtasks, cur.id);
  if (after && afterThisFilled(after)) return { kind: "finish", cur, due: isClientWait(after) && after.due ? after.due : due, holder, after };
  return { kind: "finish", cur, due, holder };
}

/** The change to the task a send makes, by its plan: null when the step
 *  can't take a check in. alsoDone is an emailing step above it that this
 *  email answered too ("Reply to media" above "Email Brian"). */
export function talkSendPatch(task: Pick<Task, "subtasks" | "status" | "due" | "assigneeId">, plan: TalkPlan, channel: "email" | "sms" | "chat", firstName: string, makeId: () => string, now = new Date().toISOString(), subject?: string | null): { patch: Partial<Task>; alsoDone?: Subtask } | null {
  const { cur, due, holder } = plan;
  if (plan.kind === "answered") {
    const list = answerReceived(task.subtasks, cur.id, now);
    if (!list) return null;
    return { patch: { subtasks: channel === "email" ? list : list.map((x) => (x.id === cur.id ? { ...x, draftMessage: undefined } : x)) } };
  }
  if (plan.kind === "reminder") {
    const list = recordFollowUp(task.subtasks, cur.id, "email", due, now).map((x) => (x.id === cur.id ? { ...x, holds: x.holds?.filter((h) => h !== "email").length ? x.holds.filter((h) => h !== "email") : undefined } : x));
    return { patch: { subtasks: list, followUpAt: due } };
  }
  if (plan.kind === "wait") {
    const list = recordFollowUp(task.subtasks, cur.id, channel, due, now).map((x) => (x.id === cur.id ? { ...x, draftMessage: undefined } : x));
    return { patch: { subtasks: list, followUpAt: due } };
  }
  // After this is a step of ours (not a wait on them): sending finishes this
  // step and starts that one, no check in added in front of it.
  if (plan.after && !isClientWait(plan.after)) {
    const word = channel === "sms" ? "Text" : channel === "chat" ? "Chat" : "Email";
    const done = finishIntoNext(task.subtasks, cur.id, { now, outcome: `${word} sent to ${firstName}` });
    if (!done) return null;
    const list = channel === "email" ? done.subtasks : done.subtasks.map((x) => (x.id === cur.id ? { ...x, draftMessage: undefined } : x));
    const status = statusForStep(task.status, stepStage(done.next, task.assigneeId));
    return { patch: { subtasks: list, ...(status ? { status } : {}) } };
  }
  const made0 = addCheckInStep(task.subtasks, cur.id, firstName, due, makeId, now, channel, subject);
  if (!made0) return null;
  const before = holder ? currentStep(task.subtasks) : undefined;
  const alsoDone = before && before.id !== cur.id && !before.onClient && !isHandoffStep(before, task.assigneeId) && EMAILING.test(before.title.trim())
    && task.subtasks.findIndex((x) => x.id === before.id) < task.subtasks.findIndex((x) => x.id === cur.id) ? before : undefined;
  const made = alsoDone ? made0.map((x) => (x.id === alsoDone.id ? { ...x, done: true, doneAt: now, outcome: `Email sent to ${firstName}` } : x)) : made0;
  // A sent text or chat leaves no draft behind on its step.
  const sent = channel === "email" ? made : made.map((x) => (x.id === cur.id ? { ...x, draftMessage: undefined } : x));
  // The wait After this set up starts now.
  const list = plan.after ? sent.map((x) => (x.id === plan.after!.id && !x.startedAt ? { ...x, startedAt: now } : x)) : sent;
  const status = statusForStep(task.status, "waiting");
  return { patch: { subtasks: list, followUpAt: due, ...(task.due && task.due < due ? { due } : {}), ...(status ? { status } : {}) }, alsoDone };
}

// How a step waiting on the client reads and ends (Derek, 2026-10-16, phone
// pass on the step UI): the check in named for what it waits for, the
// "checking again" date only when nothing else checks, and no "Email a follow
// up" while the reminders send one. Pure, so the rules are tested.
import { checkInTitle, type Subtask } from "./data";
import { remindersOn } from "./clientRequests";
import { replyWaitSource } from "./stepReminders";

/** A check in still under the name it was made with: the old "Check in if
 *  Carol hasn't replied", or the new bare "Carol's reply". */
const MADE_NAME = /^(check in if .+ hasn['’]t replied|(?!(wait|get|chase|ask)\b)[^:]+['’]s reply)$/i;

/** What a check in step shows as its name (display only; the stored title
 *  stays): "Carol's reply to: <the subject of the email it follows>", by the
 *  same lookup the reminders use (replyWaitSource: the sent step's mail:<id>),
 *  else `fallbackSubject` (the email the waiting card shows), else "Carol's
 *  reply". A name someone typed is kept. */
export function replyWaitTitle(
  step: Pick<Subtask, "id" | "title"> & Partial<Pick<Subtask, "finishWhen" | "addedFor">>,
  subtasks: Pick<Subtask, "id" | "title" | "done" | "holds">[],
  first: string,
  subjectOf: (messageId: string) => string | null | undefined,
  fallbackSubject?: string | null,
): string {
  if (step.finishWhen !== "reply" || !(step.addedFor ?? "").startsWith("checkin:")) return step.title;
  if (!MADE_NAME.test(step.title.trim())) return step.title;
  const src = replyWaitSource(step, subtasks);
  const subject = (src?.messageId ? subjectOf(src.messageId) : null) || fallbackSubject || null;
  return checkInTitle(first, subject);
}

/** Reminders on for a client's step: the reminder engine can email them and
 *  the step's own choice (on by default with a need by date) says on. */
export const stepRemindersOn = (s: Pick<Subtask, "remind" | "due">, canRemind: boolean): boolean =>
  canRemind && remindersOn({ remind: s.remind, needBy: s.due ?? null });

/** The client's step sentence says "checking again <date>" only while the
 *  reminders are off (they do the checking) and the date is not the need by
 *  date said just before it. */
export function showCheckingAgain(o: { remindersOn: boolean; followUp: string | null | undefined; needBy: string | null | undefined }): boolean {
  if (o.remindersOn || !o.followUp) return false;
  return o.followUp.slice(0, 10) !== (o.needBy ?? "").slice(0, 10);
}

/** The What's next choices on a wait for their reply, in order. "Email a
 *  follow up" only while the reminders are off (they queue the follow up for
 *  review); a follow up already written and held here still sends. */
export function waitChoiceKeys(o: { canEmail: boolean; heldDraft: boolean; canText: boolean; remindersOn: boolean }): ("send" | "email" | "text" | "call")[] {
  const out: ("send" | "email" | "text" | "call")[] = [];
  if (o.canEmail && o.heldDraft) out.push("send");
  else if (o.canEmail && !o.remindersOn) out.push("email");
  if (o.canText) out.push("text");
  out.push("call");
  return out;
}

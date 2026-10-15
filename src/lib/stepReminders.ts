// When a step's own reminder goes (Derek, 2026-10-15: After this's "add a
// reminder", off unless picked; "sometimes clients need a reminder on a
// specific task"). Set on the step (Subtask.remind), sent by the weekday 8 AM
// job (cron/portal-reminders, lib/stepReminderServer). Pure, so the decision
// can be tested. Nothing here ever sets a follow up date.

import { CLAUDE_ID, addBusinessDaysIso, addDaysIso, htmlToText, type StepRemind, type Subtask } from "./data";
import { isClientWait } from "./afterThis";

/** 0 Sunday to 6 Saturday, for a yyyy-mm-dd. */
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const isWeekday = (iso: string) => { const d = weekday(iso); return d !== 0 && d !== 6; };

/** The day itself when it is a weekday, else the Friday before it. */
export function weekdayOnOrBefore(iso: string): string {
  let d = iso;
  while (!isWeekday(d)) d = addDaysIso(d, -1);
  return d;
}
/** The weekday before `iso`. */
export function businessDayBefore(iso: string): string {
  let d = addDaysIso(iso, -1);
  while (!isWeekday(d)) d = addDaysIso(d, -1);
  return d;
}

/** Whether the client's reminder on their step goes today.
 *  once: on the check in date (the step's due), the first weekday on or after
 *  it, and only if none went for this step yet.
 *  every N: N business days since the last reminder to that client, the first
 *  one the first business day after the step started.
 *  `lastToClient` is the Pacific date of the newest reminder sent or queued to
 *  this client (any kind), `sentForStep` whether one went for this step. */
export function clientStepReminderDue(remind: StepRemind | undefined, o: { today: string; checkIn: string | null; started: string | null; lastToClient: string | null; sentForStep: boolean }): boolean {
  if (!remind || !("every" in remind) || !isWeekday(o.today)) return false;
  if (remind.every === "once") return !!o.checkIn && o.today >= o.checkIn && !o.sentForStep;
  const n = remind.every;
  if (!o.started || o.today <= o.started) return false;
  // A reminder before this step started doesn't count toward its rhythm.
  if (!o.lastToClient || o.lastToClient < o.started) return true;
  return o.today >= addBusinessDaysIso(o.lastToClient, n);
}

/** Whether a teammate's reminder on their step goes today: the business day
 *  before it is due, or the morning it is due (a weekend date: the Friday). */
export function teammateStepReminderDue(remind: StepRemind | undefined, o: { today: string; due: string | null }): boolean {
  if (!remind || !("at" in remind) || !o.due || !isWeekday(o.today)) return false;
  const day = weekdayOnOrBefore(o.due);
  return o.today === (remind.at === "morning" ? day : businessDayBefore(day));
}

/** Whose reminder a current step can carry: the client's (a wait on them) or
 *  a teammate's (assigned to someone other than Claude and the task's owner). */
export function stepReminderTurn(s: Pick<Subtask, "onClient" | "finishWhen" | "stage" | "assigneeId" | "remind">, ownerId: string | null): "client" | "teammate" | null {
  if (!s.remind) return null;
  if (isClientWait(s)) return "every" in s.remind ? "client" : null;
  if ("at" in s.remind && s.assigneeId && s.assigneeId !== CLAUDE_ID && s.assigneeId !== ownerId) return "teammate";
  return null;
}

/** What the reminder asks about, in the client's words: the step's
 *  directions' first line, else its name without "Wait for Pam's" and the
 *  like ("your class times"), else the task's name. */
export function stepAsk(s: Pick<Subtask, "title" | "notes">, firstName: string, taskTitle: string): string {
  const line = htmlToText(s.notes ?? "").split("\n").map((x) => x.trim()).find(Boolean);
  if (line) return line.length > 140 ? `${line.slice(0, 139).trimEnd()}…` : line.replace(/[.:]+$/, "");
  const esc = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let t = s.title.trim()
    .replace(/^(wait(ing)? (for|on)|ask|check in( on)?|remind|get|chase)\s+/i, "")
    .replace(new RegExp(`^${esc}\\s*:\\s*`, "i"), "")
    .replace(new RegExp(`\\b${esc}'s\\b`, "gi"), "your")
    .trim();
  if (!t || /\b(reply|replied|respond|answer)\b/i.test(t) || t.toLowerCase() === firstName.toLowerCase()) t = taskTitle.trim();
  return t;
}

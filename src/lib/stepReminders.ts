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

/** A wait for their reply to an email we sent: the check in added after it
 *  went ("checkin:<the sent step>"), or a step finished by their reply. */
export const isReplyWait = (s: Partial<Pick<Subtask, "finishWhen" | "addedFor">>): boolean =>
  s.finishWhen === "reply" || (s.addedFor ?? "").startsWith("checkin:");

/** The email a reply wait waits on: the step that sent it (the check in's own
 *  "checkin:<id>", else the nearest finished step before it holding a sent
 *  email), its title, and the email's message id from its "mail:<id>". */
export function replyWaitSource(step: Pick<Subtask, "id"> & Partial<Pick<Subtask, "finishWhen" | "addedFor">>, subtasks: Pick<Subtask, "id" | "title" | "done" | "holds">[]): { stepTitle: string; messageId: string | null } | null {
  if (!isReplyWait(step)) return null;
  const sentId = step.addedFor?.startsWith("checkin:") ? step.addedFor.slice("checkin:".length) : null;
  const mailOf = (s: Pick<Subtask, "holds">) => [...(s.holds ?? [])].reverse().find((h) => h.startsWith("mail:")) ?? null;
  let sent = sentId ? subtasks.find((s) => s.id === sentId) : undefined;
  if (!sent) {
    const at = subtasks.findIndex((s) => s.id === step.id);
    sent = subtasks.slice(0, at < 0 ? subtasks.length : at).reverse().find((s) => s.done && !!mailOf(s));
  }
  if (!sent) return null;
  const mail = mailOf(sent);
  return { stepTitle: sent.title.trim(), messageId: mail ? mail.slice("mail:".length) : null };
}

/** Verbs a client step uses, in their base form, for "Carol signs off and
 *  sends ...": "sign off and send ...". */
const BASE_VERBS = new Set(["approve", "review", "send", "sign", "pick", "choose", "confirm", "answer", "fill", "upload", "share", "book", "pay", "check", "read", "look",
  "tell", "give", "let", "add", "update", "write", "record", "call", "schedule", "reply", "provide", "complete", "decide", "select", "submit", "finish", "test", "try",
  "forward", "email", "text", "get", "make", "take", "put", "set", "film", "shoot", "gather", "collect", "list", "mark", "note", "drop", "post", "film", "fix", "find", "write", "edit"]);
/** "signs" to "sign", "pushes" to "push", "tries" to "try"; never a word in "ss". */
const IRREGULAR: Record<string, string | null> = { has: "have", does: "do", goes: "go", is: null, was: null, says: "say" };
function baseForm(word: string): string | null {
  const w = word.toLowerCase();
  if (w in IRREGULAR) return IRREGULAR[w];
  if (!/^[a-z]+s$/.test(w) || /ss$/.test(w) || w.length < 4) return null;
  if (/ies$/.test(w)) return word.slice(0, -3) + "y";
  if (/(ch|sh|x|z|ss)es$/.test(w)) return word.slice(0, -2);
  return word.slice(0, -1);
}

/** A client step written about them ("Carol signs off on the site and sends
 *  her pet care details") as an ask to them ("Sign off on the site and send
 *  your pet care details"): the leading name goes, the verb at the start of
 *  each " and " clause takes its base form, her, his and their become your.
 *  Anything not led by their name and a verb comes back as it was. */
export function toTheirAsk(text: string, firstName: string): string {
  const first = firstName.trim();
  if (!first) return text;
  const esc = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Their first name, maybe their last name too, then a verb in -s.
  let m: RegExpExecArray | null = null;
  let verb: string | null = null;
  for (const re of [new RegExp(`^${esc}\\s+[A-Z][\\w'-]*\\s+(\\S+)(.*)$`), new RegExp(`^${esc}\\s+(\\S+)(.*)$`)]) {
    m = re.exec(text.trim());
    verb = m ? baseForm(m[1]) : null;
    if (verb) break;
  }
  if (!m || !verb) return text;
  const clauses = `${verb}${m[2]}`.split(/\s+and\s+/i).map((c, i) => {
    if (i === 0) return c;
    const [w, ...rest] = c.split(/\s+/);
    const b = baseForm(w);
    return b && BASE_VERBS.has(b.toLowerCase()) && rest.length ? [b, ...rest].join(" ") : c;
  });
  const out = clauses.join(" and ").replace(/\b(her|his|their)\b/gi, "your");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** How the client is asked, in each place it shows: `ask` in an email body
 *  ("We need <ask> by Fri, Oct 16."), `subject` in a subject line, `title` on
 *  the portal's card. */
export type AskWords = { ask: string; subject: string; title: string };

/** The ask for a wait on their reply to our email "<subject>". */
export function replyAskWords(subject: string): AskWords {
  const s = subject.trim().replace(/^((re|fwd?):\s*)+/i, "");
  return { ask: `your reply to my email “${s}”`, subject: `your reply to “${s}”`, title: `Reply to: ${s}` };
}

/** What a client step asks, in the client's words (Derek, 2026-10-15: "it
 *  shows the task but really it's the step"). A wait on their reply to our
 *  email asks for that reply, by the email's subject (`replyTo`: the email's
 *  subject, else the title of the step that sent it). Otherwise the step's
 *  directions' first line, else its name without "Wait for Pam's" and the
 *  like ("your class times"), turned to them when it is written about them.
 *  Never the bare task name: "your answer on <task>" when nothing else says. */
export function stepAskWords(s: Pick<Subtask, "title" | "notes"> & Partial<Pick<Subtask, "finishWhen" | "addedFor">>, firstName: string, taskTitle: string, o: { replyTo?: string | null } = {}): AskWords {
  const fallback = (): AskWords => { const a = `your answer on ${taskTitle.trim()}`; return { ask: a, subject: a, title: upperFirst(a) }; };
  const plain = (a: string): AskWords => ({ ask: a, subject: a, title: upperFirst(a) });
  const line = htmlToText(s.notes ?? "").split("\n").map((x) => x.trim()).find(Boolean);
  const esc = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const t = line ? "" : s.title.trim()
    .replace(/^(wait(ing)? (for|on)|ask|check in( on)?|remind|get|chase)\s+/i, "")
    .replace(new RegExp(`^${esc}\\s*:\\s*`, "i"), "")
    .replace(new RegExp(`\\b${esc}'s\\b`, "gi"), "your")
    .trim();
  const aboutReply = !t || /\b(reply|replied|respond|answer)\b/i.test(t) || t.toLowerCase() === firstName.toLowerCase();
  if (isReplyWait(s) && ((s.addedFor ?? "").startsWith("checkin:") || (!line && aboutReply))) {
    return o.replyTo?.trim() ? replyAskWords(o.replyTo) : fallback();
  }
  if (line) return plain(toTheirAsk(line.length > 140 ? `${line.slice(0, 139).trimEnd()}…` : line.replace(/[.:]+$/, ""), firstName));
  if (aboutReply) return fallback();
  return plain(toTheirAsk(t, firstName));
}

/** The ask in an email body (stepAskWords). */
export const stepAsk = (s: Pick<Subtask, "title" | "notes"> & Partial<Pick<Subtask, "finishWhen" | "addedFor">>, firstName: string, taskTitle: string, o: { replyTo?: string | null } = {}): string =>
  stepAskWords(s, firstName, taskTitle, o).ask;

const upperFirst = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

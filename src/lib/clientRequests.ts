// What we need from a client, one thing at a time (Derek and Justin,
// 2026-10-15, client-reminders-mockup.html). Every open client step (a wait
// on the client that is the current step of one of their open, shared tasks)
// is a request. They line up in one queue per client across all their lists:
// overdue first, then due today, this week, later and undated, each group in
// our own dragged order (Subtask.clientOrder), then by need by date. Only the
// top request with reminders on is chased:
//   asked      when it becomes their turn (the first email for that step)
//   reminder   every 3 business days while it is not due yet
//   due        on its need by date
//   late       every business day once it is late
//   summary    instead of all that, when 5 or more are late: one email
// At most one email a client a day, except that an answer from them (or our
// "check it" on their emailed reply, ticked) lets the next request be asked
// about 10 minutes later. A reply by email lands on the step it answers and
// hands the turn back to us with a "check it" step; nothing more is asked of
// that client until it is ticked.
//
// Pure, so the order, the timing, the emails and the reply matching can be
// tested; lib/clientRequestsServer runs it. A need by date never sets a
// follow up (data.ts DUE_SETS_FOLLOW_UP); nothing here touches follow ups.

import { addBusinessDaysIso, addDaysIso, currentStep, formatDayDate, formatDue, type ReceivedEmail, type StepRemind, type Subtask } from "./data";
import { isClientWait } from "./afterThis";
import { replyWaitSource } from "./stepReminders";
import { draftLinkHtml, escapeHtml, type DraftLink } from "./draftLink";
import { PORTAL_REMINDER_PREFIX, STEP_REMINDER_PREFIX } from "./portalReminders";

export { defaultNeedBy } from "./afterThis";

/** The request reminders' scheduled_messages id prefix:
 *  smr_req_<stage>_<stepId>_<uuid> (the summary has no step). */
export const REQUEST_PREFIX = "smr_req_";
/** Every reminder to a client that shares the one a day guard. */
export const CLIENT_REMINDER_PREFIXES = [PORTAL_REMINDER_PREFIX, STEP_REMINDER_PREFIX, REQUEST_PREFIX] as const;
/** For supabase .or(): any reminder to a client. */
export const clientReminderIdFilter = (): string => CLIENT_REMINDER_PREFIXES.map((p) => `id.like.${p}%`).join(",");

export type RequestStage = "asked" | "reminder" | "due" | "late" | "summary";
const STAGES: RequestStage[] = ["asked", "reminder", "due", "late", "summary"];

/** Business days the reminders wait between one and the next, by default. */
export const REMIND_EVERY = 3;
/** This many late, and one summary goes instead of the top one's email. */
export const SUMMARY_AT = 5;
/** After an answer, the next request waits this long (Derek: "about 10 minutes later"). */
export const NEXT_ASK_DELAY_MS = 10 * 60 * 1000;
/** The "check it" step an emailed reply makes: `checkit:<stepId>`. */
export const CHECK_IT_PREFIX = "checkit:";

/** The follow-on run's hours: weekdays 9 AM to 5:59 PM in California, after
 *  the 8 AM run and inside the working day. */
export function isFollowOnHour(nowMs: number): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(p.weekday) && h >= 9 && h <= 17;
}

export const requestRowId = (stage: RequestStage, stepId: string | null, uuid: string): string => `${REQUEST_PREFIX}${stage}_${stepId ?? ""}_${uuid}`;

export type ReminderKind = "request" | "step" | "portal" | "other";
/** What a reminder row is about, read from its id. Step ids hold underscores,
 *  the uuid on the end never does. */
export function parseReminderId(id: string): { kind: ReminderKind; stage: RequestStage | null; stepId: string | null } {
  if (id.startsWith(REQUEST_PREFIX)) {
    const rest = id.slice(REQUEST_PREFIX.length);
    const a = rest.indexOf("_");
    const b = rest.lastIndexOf("_");
    const stage = rest.slice(0, a) as RequestStage;
    if (a < 0 || b <= a || !STAGES.includes(stage)) return { kind: "other", stage: null, stepId: null };
    return { kind: "request", stage, stepId: rest.slice(a + 1, b) || null };
  }
  if (id.startsWith(STEP_REMINDER_PREFIX)) {
    const rest = id.slice(STEP_REMINDER_PREFIX.length);
    const b = rest.lastIndexOf("_");
    return { kind: "step", stage: "reminder", stepId: b > 0 ? rest.slice(0, b) : null };
  }
  if (id.startsWith(PORTAL_REMINDER_PREFIX)) return { kind: "portal", stage: null, stepId: null };
  return { kind: "other", stage: null, stepId: null };
}

/** The words a stage goes by in the Reminders view and the step's Asked list. */
export function stageLabel(stage: RequestStage | null, o: { daysLate?: number; kind?: ReminderKind } = {}): string {
  if (o.kind === "portal") return "counts";
  switch (stage) {
    case "asked": return "asked";
    case "reminder": return "reminder";
    case "due": return "due today";
    case "late": return o.daysLate ? `${o.daysLate} ${o.daysLate === 1 ? "day" : "days"} late` : "late";
    case "summary": return "summary";
    default: return "review nudge";
  }
}

/** 0 Sunday to 6 Saturday, for a yyyy-mm-dd. */
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const isBusinessDay = (iso: string) => { const d = weekday(iso); return d !== 0 && d !== 6; };

/** Business days after `from` up to and including `to` (0 when `to` is not later). */
export function businessDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDaysIso(from, 1); d <= to; d = addDaysIso(d, 1)) if (isBusinessDay(d)) n++;
  return n;
}
/** How late a need by date is today, in business days (0 when it isn't). */
export const daysLate = (needBy: string | null, today: string): number => (needBy && today > needBy ? businessDaysBetween(needBy, today) : 0);

/** One client request: the current client step of one of their tasks. */
export type ClientRequest = {
  clientId: string;
  taskId: string;
  taskTitle: string;
  /** The task's own due date: the email's "expected" line, and what moves when this is late. */
  taskDue: string | null;
  listId: string | null;
  stepId: string;
  title: string;
  notes?: string;
  /** The step's due date, read as its need by date. */
  needBy: string | null;
  startedAt: string | null;
  clientOrder: number | null;
  remind?: StepRemind;
  expectedFrom?: string | null;
  finishWhen?: Subtask["finishWhen"];
  addedFor?: string;
  /** A wait on their reply to an email we sent: that email's message id, and
   *  the title of the step that sent it (lib/stepReminders replyWaitSource). */
  replyTo?: { messageId: string | null; stepTitle: string } | null;
};

/** A task's request, when its current step is the client's turn. */
export function requestFromTask(t: { id: string; title: string; clientId: string; projectId?: string | null; due?: string | null; subtasks?: Subtask[] | null }): ClientRequest | null {
  const cur = currentStep(t.subtasks ?? []);
  if (!cur || !isClientWait(cur)) return null;
  return {
    clientId: t.clientId, taskId: t.id, taskTitle: t.title, taskDue: t.due ?? null, listId: t.projectId ?? null,
    stepId: cur.id, title: cur.title, notes: cur.notes, needBy: cur.due ?? null, startedAt: cur.startedAt ?? null,
    clientOrder: typeof cur.clientOrder === "number" ? cur.clientOrder : null, remind: cur.remind, expectedFrom: cur.expectedFrom ?? null,
    finishWhen: cur.finishWhen, addedFor: cur.addedFor, replyTo: replyWaitSource(cur, t.subtasks ?? []),
  };
}

/** Reminders on: by default for a client step with a need by date; "Off"
 *  stops it; the older once and every N choices count as on. */
export function remindersOn(r: Pick<ClientRequest, "remind" | "needBy">): boolean {
  if (!r.remind) return !!r.needBy;
  if ("off" in r.remind) return false;
  return "every" in r.remind;
}
/** Business days between reminders: 3 by default, the older every N as set,
 *  none for the older "once" (asked and the due day only). */
export function remindEvery(remind: StepRemind | undefined): number | null {
  if (remind && "every" in remind) return remind.every === "once" ? null : remind.every;
  return REMIND_EVERY;
}

export type RequestGroup = "overdue" | "today" | "week" | "later";
export const GROUP_LABEL: Record<RequestGroup, string> = { overdue: "Overdue", today: "Today", week: "This week", later: "Later" };
const GROUP_RANK: Record<RequestGroup, number> = { overdue: 0, today: 1, week: 2, later: 3 };
/** This week is the next 5 business days; undated is later. */
export function requestGroup(needBy: string | null, today: string): RequestGroup {
  if (!needBy) return "later";
  if (needBy < today) return "overdue";
  if (needBy === today) return "today";
  return needBy <= addBusinessDaysIso(today, 5) ? "week" : "later";
}

/** The client's queue: overdue first, then today, this week, later (undated
 *  last); inside a group our dragged order, then the need by date. */
export function orderRequests<T extends Pick<ClientRequest, "needBy" | "clientOrder" | "startedAt" | "stepId">>(list: T[], today: string): T[] {
  const inf = Number.POSITIVE_INFINITY;
  return [...list].sort((a, b) =>
    GROUP_RANK[requestGroup(a.needBy, today)] - GROUP_RANK[requestGroup(b.needBy, today)]
    || (a.clientOrder ?? inf) - (b.clientOrder ?? inf)
    || (a.needBy ?? "9999").localeCompare(b.needBy ?? "9999")
    || (a.startedAt ?? "").localeCompare(b.startedAt ?? "")
    || a.stepId.localeCompare(b.stepId));
}
/** The one being chased: the first in the queue with reminders on. */
export const chasedRequest = <T extends Pick<ClientRequest, "remind" | "needBy">>(ordered: T[]): T | null => ordered.find(remindersOn) ?? null;

/** The clientOrder each request takes after a drag inside its group: the
 *  group in its new order, numbered from 1 (only the ones that change). */
export function reorderedClientOrder(group: { stepId: string; clientOrder: number | null }[], fromId: string, toId: string): { stepId: string; clientOrder: number }[] {
  const ids = group.map((g) => g.stepId);
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return [];
  const moved = [...ids];
  moved.splice(to, 0, moved.splice(from, 1)[0]);
  return moved.map((stepId, i) => ({ stepId, clientOrder: i + 1 })).filter((x) => group.find((g) => g.stepId === x.stepId)!.clientOrder !== x.clientOrder);
}

/** What went for one step: the Pacific date of the first and of the newest
 *  reminder row (whatever became of it, so a skipped one still counts toward
 *  the rhythm), and how many were sent. */
export type StepHistory = { first: string; last: string; sent: number };

/** Today's email for the request, or null. Weekdays only. The first one for
 *  a step is "asked" (or "due"/"late" when its date has already come). */
export function requestStageToday(o: { today: string; needBy: string | null; remind?: StepRemind; history: StepHistory | null }): RequestStage | null {
  if (!isBusinessDay(o.today)) return null;
  const late = !!o.needBy && o.today > o.needBy;
  const dueDay = !!o.needBy && o.today === o.needBy;
  if (!o.history) return late ? "late" : dueDay ? "due" : "asked";
  if (o.history.last >= o.today) return null;
  if (late) return remindEvery(o.remind) === null ? null : "late";
  if (dueDay) return "due";
  const n = remindEvery(o.remind);
  return n !== null && o.today >= addBusinessDaysIso(o.history.last, n) ? "reminder" : null;
}

/** The client's open "check it" steps: their emailed reply, ours to read. */
export const openCheckIt = (subtasks: Pick<Subtask, "done" | "addedFor">[]): boolean => subtasks.some((s) => !s.done && !!s.addedFor?.startsWith(CHECK_IT_PREFIX));
/** When the client last answered something on this task (a step they
 *  finished) or we last ticked a "check it" on their reply. */
export function lastAnswerAt(subtasks: Pick<Subtask, "done" | "doneAt" | "doneBy" | "addedFor">[]): string | null {
  let at: string | null = null;
  for (const s of subtasks) {
    if (!s.done || !s.doneAt) continue;
    if (s.doneBy !== "client" && !s.addedFor?.startsWith(CHECK_IT_PREFIX)) continue;
    if (!at || s.doneAt > at) at = s.doneAt;
  }
  return at;
}

export type ClientPlan =
  | { stage: Exclude<RequestStage, "summary">; request: ClientRequest; overdue: number; notBefore: string | null }
  | { stage: "summary"; request: null; overdue: number; notBefore: null }
  | { skip: "weekend" | "check_it" | "review_waiting" | "nothing" | "already_today" | "not_today" | "wait_for_morning" };

/** What to queue for one client now. `mode` "morning" is the 8 AM run (every
 *  stage); "follow-on" runs through the day and only asks (a new top request,
 *  or the next one after they answered). `answeredAt` is the newest answer on
 *  any of their tasks, `lastSentAt` the newest reminder to them (ISO). */
export function planForClient(o: {
  today: string; nowIso: string; mode: "morning" | "follow-on";
  requests: ClientRequest[]; history: Map<string, StepHistory>;
  lastSentAt: string | null; lastSentDay: string | null; answeredAt: string | null;
  checkItOpen: boolean; reviewWaiting: boolean;
}): ClientPlan {
  if (!isBusinessDay(o.today)) return { skip: "weekend" };
  if (o.checkItOpen) return { skip: "check_it" };
  if (o.reviewWaiting) return { skip: "review_waiting" };
  const ordered = orderRequests(o.requests, o.today);
  if (!ordered.length) return { skip: "nothing" };
  const overdue = ordered.filter((r) => requestGroup(r.needBy, o.today) === "overdue").length;
  const sentToday = !!o.lastSentDay && o.lastSentDay >= o.today;
  const answered = !!o.answeredAt && (!o.lastSentAt || o.answeredAt > o.lastSentAt);
  if (overdue >= SUMMARY_AT) {
    if (o.mode !== "morning") return { skip: "wait_for_morning" };
    return sentToday ? { skip: "already_today" } : { stage: "summary", request: null, overdue, notBefore: null };
  }
  const top = chasedRequest(ordered);
  if (!top) return { skip: "nothing" };
  const history = o.history.get(top.stepId) ?? null;
  const stage = requestStageToday({ today: o.today, needBy: top.needBy, remind: top.remind, history });
  if (!stage || stage === "summary") return { skip: "not_today" };
  const first = !history;
  if (o.mode === "follow-on" && !first) return { skip: "wait_for_morning" };
  if (sentToday && !(first && answered)) return { skip: "already_today" };
  // The next one after an answer: about 10 minutes after it.
  const notBefore = answered && o.answeredAt ? new Date(Math.max(Date.parse(o.nowIso), Date.parse(o.answeredAt) + NEXT_ASK_DELAY_MS)).toISOString() : null;
  return { stage, request: top, overdue, notBefore };
}

export type ComingUp = { day: string; clientId: string; stage: RequestStage; request: ClientRequest | null; overdue: number };

/** What the rules will queue for one client on the next `days` business days
 *  if nothing is answered: nothing is made until its day. `from` is the first
 *  day to look at (today when nothing went today, else tomorrow). */
export function comingUpForClient(o: { from: string; days: number; requests: ClientRequest[]; history: Map<string, StepHistory>; lastSentDay: string | null; checkItOpen: boolean }): ComingUp[] {
  if (o.checkItOpen || !o.requests.length) return [];
  const out: ComingUp[] = [];
  const history = new Map(o.history);
  let lastSentDay = o.lastSentDay;
  let day = isBusinessDay(o.from) ? o.from : addBusinessDaysIso(o.from, 1);
  for (let i = 0; i < o.days; i++, day = addBusinessDaysIso(day, 1)) {
    const plan = planForClient({ today: day, nowIso: `${day}T15:00:00.000Z`, mode: "morning", requests: o.requests, history, lastSentAt: lastSentDay ? `${lastSentDay}T15:00:00.000Z` : null, lastSentDay, answeredAt: null, checkItOpen: false, reviewWaiting: false });
    if ("skip" in plan) continue;
    out.push({ day, clientId: o.requests[0].clientId, stage: plan.stage, request: plan.request, overdue: plan.overdue });
    lastSentDay = day;
    if (plan.request) {
      const h = history.get(plan.request.stepId);
      history.set(plan.request.stepId, { first: h?.first ?? day, last: day, sent: (h?.sent ?? 0) + 1 });
    }
  }
  return out;
}

// ── The emails ──────────────────────────────────────────────────────────────

/** Asks that start with what to do ("approve the flyer"): "you to approve the flyer". */
const VERB = /^(approve|review|send|sign|pick|choose|confirm|answer|fill|upload|share|book|pay|check|read|look|tell|give|let|add|update|write|record|call|schedule|reply|provide|complete|decide|select|submit|finish|test|try|forward|email|text)\b/i;
export const verbLed = (ask: string) => VERB.test(ask.trim());
const lowerFirst = (s: string) => (verbLed(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "you to approve the flyer", "your class times". */
const askPhrase = (ask: string) => (verbLed(ask) ? `you to ${lowerFirst(ask)}` : lowerFirst(ask));
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

/** The subject by stage (Derek and Justin, 2026-10-15). */
export function requestSubject(stage: RequestStage, o: { ask: string; subjectAsk?: string; needBy: string | null; firstAsked: string; today: string; overdue?: number }): string {
  const ask = (o.subjectAsk?.trim() || o.ask).trim();
  const late = daysLate(o.needBy, o.today);
  let s: string;
  switch (stage) {
    case "asked": s = `We need ${askPhrase(ask)}${o.needBy ? ` by ${formatDayDate(o.needBy)}` : ""}`; break;
    case "reminder": s = `Reminder: ${lowerFirst(ask)}, first asked ${formatDue(o.firstAsked)}`; break;
    case "due": s = verbLed(ask) ? `Due today: ${lowerFirst(ask)}` : `${upperFirst(ask)} is due today`; break;
    case "late": s = verbLed(ask) ? `${days(Math.max(1, late))} late: ${lowerFirst(ask)}` : `${upperFirst(ask)} is ${days(Math.max(1, late))} late`; break;
    case "summary": s = `${things(o.overdue ?? 0)} we need from you ${(o.overdue ?? 0) === 1 ? "is" : "are"} overdue`; break;
  }
  return upperFirst(s).slice(0, 150);
}

/** "today", "1 day ago", "3 days ago", in calendar days. */
export function agoWords(from: string, today: string): string {
  const n = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return n <= 0 ? "today" : `${days(n)} ago`;
}

/** One ask, never the list (Derek and Justin, 2026-10-15): Hi, the ask, when
 *  we first asked, what it holds up and when that is expected, one button to
 *  that request in the portal, "or reply", the rest one muted line away. The
 *  button goes in as a link line; the server makes it a button. */
export function requestEmail(o: {
  stage: RequestStage; firstName: string | null; ask: string;
  /** The ask as a subject line says it, when shorter than the body's
   *  ("your reply to “<subject>”"); the ask otherwise. */
  subjectAsk?: string;
  taskTitle: string; needBy: string | null; firstAsked: string; today: string;
  /** The task's due date, when it has one: "<task> is expected Oct 27". */
  expected: string | null;
  link: DraftLink | null; listUrl: string | null; more: number; overdue?: number; sender: string | null;
}): { subject: string; body: string } {
  const hi = `<p>Hi ${escapeHtml(o.firstName?.trim() || "there")},</p>`;
  const thanks = `<p>Thanks!${o.sender?.trim() ? `<br>${escapeHtml(o.sender.trim())}` : ""}</p>`;
  const subject = requestSubject(o.stage, o);
  if (o.stage === "summary") {
    const n = o.overdue ?? 0;
    return {
      subject,
      body: `${hi}<p>${things(n)} we need from you ${n === 1 ? "is" : "are"} overdue. Each one is in your client portal, where you can answer it or send what we need.</p>`
        + `${draftLinkHtml(o.listUrl ? { url: o.listUrl, label: "See everything we need" } : null)}${thanks}`,
    };
  }
  const ask = escapeHtml(askPhrase(o.ask.trim() || o.taskTitle.trim()));
  const when = o.needBy ? escapeHtml(formatDayDate(o.needBy)) : "";
  const lead = o.stage === "asked" ? `We need ${ask}${when ? ` by ${when}` : ""}.`
    : o.stage === "due" ? `We need ${ask} today.`
    : o.stage === "late" ? `We still need ${ask}.${when ? ` It was due ${when}.` : ""}`
    : `A reminder: we still need ${ask}${when ? ` by ${when}` : ""}.`;
  const firstAsked = o.stage === "asked" ? "" : `<p>We first asked on ${escapeHtml(formatDue(o.firstAsked))}, ${agoWords(o.firstAsked, o.today)}.</p>`;
  const task = o.taskTitle.trim();
  const expected = expectedSentence(task, o.expected);
  const holds = expected ? `<p>${escapeHtml(expected)}</p>`
    : task && task.toLowerCase() !== o.ask.trim().toLowerCase() ? `<p>It's what holds up ${escapeHtml(task)}.</p>` : "";
  const more = o.more > 0 && o.listUrl
    ? `<p style="color:#6b7280">${o.more} more ${o.more === 1 ? "thing is" : "things are"} waiting on you. <a href="${escapeHtml(o.listUrl)}" style="color:#6b7280">See everything we need</a></p>` : "";
  return {
    subject,
    body: `${hi}<p>${lead}</p>${firstAsked}${holds}${draftLinkHtml(o.link)}<p>Or reply to this email with your answer.</p>${more}${thanks}`,
  };
}

// ── Expected date ───────────────────────────────────────────────────────────

/** Whether a task's name reads as a thing on its own ("Newsletter", "PPAI
 *  flyer", "The Fall Sale page"): four words or fewer, not an action, not
 *  plural, plain words. "November classes is expected" reads badly. */
export function readsAsThing(title: string): boolean {
  const t = title.trim().replace(/[.!?]+$/, "");
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4 || verbLed(t)) return false;
  if (!/^[A-Za-z][A-Za-z'&\s]*$/.test(t)) return false;
  const last = words[words.length - 1].toLowerCase();
  return !(/s$/.test(last) && !/(ss|us|is)$/.test(last));
}

/** The expected line the client reads, in the email and the portal, one way
 *  everywhere (Derek, 2026-10-15): "Your newsletter is expected Oct 27." for
 *  a short name that reads as a thing, else "We expect to finish "November
 *  classes" by Oct 30.". Null without a date or a name. */
export function expectedSentence(taskTitle: string, due: string | null): string | null {
  const title = taskTitle.trim().replace(/[.!?]+$/, "");
  if (!due || !title) return null;
  if (!readsAsThing(title)) return `We expect to finish "${title}" by ${formatDue(due)}.`;
  // One plain word reads as "your newsletter"; a longer name stays as typed
  // ("PPAI flyer"), so a name keeps its capital.
  const named = /^[A-Za-z][a-z]+$/.test(title) ? `Your ${title.toLowerCase()}` : upperFirst(title);
  return `${named} is expected ${formatDue(due)}.`;
}

/** Our side's line for a task whose date moved: "Expected done: November
 *  classes, Oct 24 → Oct 27". */
export const expectedDoneLine = (taskTitle: string, from: string, to: string): string =>
  `Expected done: ${taskTitle.trim().replace(/[.!?]+$/, "")}, ${formatDue(from)} → ${formatDue(to)}`;

/** A task waiting on a late client step: its due date moves out by the
 *  business days late, counted from where it was before the first move, so
 *  it keeps pace and never piles up (Derek and Justin, 2026-10-15). Only a
 *  task with a due date; null when nothing moves. Never a follow up. */
export function expectedMove(o: { taskDue: string | null; expectedFrom: string | null | undefined; needBy: string | null; today: string }): { due: string; from: string; late: number } | null {
  if (!o.taskDue) return null;
  const late = daysLate(o.needBy, o.today);
  if (late <= 0) return null;
  const from = o.expectedFrom ?? o.taskDue;
  const due = addBusinessDaysIso(from, late);
  return due > o.taskDue ? { due, from, late } : null;
}
/** The task comment the move leaves: "Expected date moved to Oct 27: Brian's
 *  "Approve the flyer" is 3 days late". */
export const expectedMoveComment = (due: string, first: string, stepTitle: string, late: number): string =>
  `Expected date moved to ${formatDue(due)}: ${first}'s "${stepTitle.trim()}" is ${days(late)} late`;

// ── An emailed reply ────────────────────────────────────────────────────────

/** The step an emailed reply answers: the newest request reminder sent into
 *  that email's thread. `rows` are reminder rows (id, the message they
 *  became, their task); `threadMessageIds` the messages in the reply's thread. */
export function requestStepForThread(rows: { id: string; sent_message_id: string | null; task_id: string | null; scheduled_at?: string | null }[], threadMessageIds: string[]): { stepId: string; taskId: string | null } | null {
  const inThread = new Set(threadMessageIds);
  const hits = rows.filter((r) => r.sent_message_id && inThread.has(r.sent_message_id))
    .sort((a, b) => (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""));
  for (const r of hits) {
    const p = parseReminderId(r.id);
    if (p.stepId && (p.kind === "request" || p.kind === "step")) return { stepId: p.stepId, taskId: r.task_id };
  }
  return null;
}

/** Their emailed reply hands that one step back to us (Derek and Justin,
 *  2026-10-15): the client's step is done ("Brian replied") and a "Brian
 *  replied: check it" step, ours, due today, holding their email, starts right
 *  after it. Null when the step is not an open client step. */
export function finishRequestStep(subtasks: Subtask[], stepId: string, o: { first: string; email: ReceivedEmail; now: string; today: string; makeId: () => string }): Subtask[] | null {
  const at = subtasks.findIndex((s) => s.id === stepId);
  const s = subtasks[at];
  if (!s || s.done || !isClientWait(s)) return null;
  const list = subtasks.map((x) => (x.id === stepId ? { ...x, done: true, doneAt: o.now, outcome: `${o.first} replied`, doneBy: "client" } : x));
  list.splice(at + 1, 0, {
    id: o.makeId(), title: `${o.first} replied: check it`, done: false, addedFor: `${CHECK_IT_PREFIX}${stepId}`,
    startedAt: o.now, due: o.today, fromEmails: [o.email],
  });
  return list;
}

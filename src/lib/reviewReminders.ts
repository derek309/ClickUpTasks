// When a review sitting with the client gets a reminder email (Derek,
// 2026-09-21: "if a client has something to review ... set a 24-hour reminder
// for them to review it and approve it ... stop after 3 ... allow us to be able
// to log in and redo it ... make sure that it's 3 business days").
//
// Pure: times in, a decision out, no database and no clock of its own, so the
// part most likely to be quietly wrong (counting business days across weekends
// and daylight saving) can be tested on its own.
//
// Business days are counted in the team's own timezone. The cron runs in UTC,
// and a weekday in UTC is not always a weekday in California: 8 AM on a Monday
// in UTC is still Sunday night there. Holidays are not counted as days off.

const TZ = "America/Los_Angeles";
const DAY_MS = 86_400_000;

/** Reminders in one round. After this many the team is told instead, so a
 *  review nobody is watching never turns into weeks of daily emails. */
export const MAX_REMINDERS = 3;
/** The default frequency: every business day, the "24 hours" Derek asked for. */
export const DEFAULT_REMINDER_EVERY = 1;
/** The widest gap allowed, matching the database check. */
export const MAX_REMINDER_EVERY = 10;

/** The calendar date an instant falls on in the team's timezone. */
function localDate(iso: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(iso));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: part("year"), m: part("month"), d: part("day") };
}

/** A calendar date as noon UTC, so stepping a day at a time can never slip into
 *  the wrong date across a daylight saving change. */
const noonUtc = ({ y, m, d }: { y: number; m: number; d: number }) => Date.UTC(y, m - 1, d, 12);
const isWeekday = (ms: number) => { const w = new Date(ms).getUTCDay(); return w !== 0 && w !== 6; };

/** Whether an instant falls on a weekday in the team's timezone. */
export const isBusinessDay = (iso: string) => isWeekday(noonUtc(localDate(iso)));

/** Business days after `from`'s date, up to and including `to`'s date. The same
 *  day is 0; Friday to the following Monday is 1. A `from` after `to` is 0. */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  let day = noonUtc(localDate(fromIso));
  const end = noonUtc(localDate(toIso));
  let n = 0;
  while (day < end) {
    day += DAY_MS;
    if (isWeekday(day)) n += 1;
  }
  return n;
}

export type ReminderState = {
  /** The latest version the team sent. The round starts here. */
  sentAt: string;
  /** When someone pressed Restart, which starts a fresh round. */
  roundAt: string | null;
  lastReminderAt: string | null;
  remindersSent: number;
  /** Business days between reminders; 0 is off. */
  everyDays: number;
  /** The latest the client said anything: a message on the task, or a comment
   *  on the review. */
  clientRepliedAt: string | null;
  now: string;
};

export type ReminderDecision = {
  due: boolean;
  /** Reminders already sent in the current round. */
  sentThisRound: number;
  reason: "off" | "weekend" | "capped" | "replied" | "not yet" | "due";
};

const later = (a: string, b: string | null) => (b && b > a ? b : a);

/** Where the current round stands. Shared by the cron and the review's own
 *  screen, so the two can never disagree about how many have gone out. A
 *  reminder from before the round began belongs to an earlier round: a new
 *  version or a Restart starts the count again. */
export function reminderRound(s: Pick<ReminderState, "sentAt" | "roundAt" | "lastReminderAt" | "remindersSent">): { start: string; sent: number; capped: boolean } {
  const start = later(s.sentAt, s.roundAt);
  const sent = s.lastReminderAt && s.lastReminderAt >= start ? s.remindersSent : 0;
  return { start, sent, capped: sent >= MAX_REMINDERS };
}

/** Whether a reminder goes out on this run. */
export function reminderDue(s: ReminderState): ReminderDecision {
  const { start: roundStart, sent: sentThisRound } = reminderRound(s);
  const decide = (reason: ReminderDecision["reason"]): ReminderDecision => ({ due: reason === "due", sentThisRound, reason });

  if (s.everyDays <= 0) return decide("off");
  if (!isBusinessDay(s.now)) return decide("weekend");
  if (sentThisRound >= MAX_REMINDERS) return decide("capped");
  const since = sentThisRound === 0 ? roundStart : s.lastReminderAt!;
  // They answered since the round began or the last nudge: someone is on it,
  // and a reminder the day after they wrote back reads as not listening.
  if (s.clientRepliedAt && s.clientRepliedAt > since) return decide("replied");
  if (businessDaysBetween(since, s.now) < s.everyDays) return decide("not yet");
  return decide("due");
}

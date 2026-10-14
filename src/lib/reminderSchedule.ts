// When a client gets their "we need N things from you" reminder (Derek,
// 2026-10-14: "a remind every X business days or set custom, can you pick
// days of the week ... then we can set by client"). Set on the client page's
// waiting card (ClientNeeds), saved in clients.reminders
// (supabase/client-reminders.sql). Nothing chosen is what it always was:
// Mondays, written for review and sent by a person. Pure, so the 8 AM job
// and the card's line agree and the decision can be tested.

import { addBusinessDaysIso } from "./data";

export type ReminderSchedule = "monday" | "every" | "days" | "off";

export type ClientReminders = {
  schedule: ReminderSchedule;
  /** Business days between reminders, for "every" (2 to 10). */
  every?: number;
  /** Weekdays for "days": 1 Monday to 5 Friday. */
  days?: number[];
  /** true: the 8 AM job queues it to go on its own. false: it waits in the
   *  Inbox, "Reminder emails going out", until someone sends it. */
  auto: boolean;
  /** The Pacific date the schedule was chosen: "every" starts the first
   *  weekday after it when no reminder has gone since. */
  since?: string;
};

export const DEFAULT_REMINDERS: ClientReminders = { schedule: "monday", auto: false };
/** The choices the card offers for "every"; any 2 to 10 saved still works. */
export const EVERY_CHOICES = [2, 3, 5] as const;
const DEFAULT_EVERY = 3;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const WEEKDAY_PLURAL = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays"] as const;

/** Whatever is saved (null, a half filled object, nonsense) as a whole setting. */
export function reminderSettings(raw: unknown): ClientReminders {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_REMINDERS };
  const r = raw as Record<string, unknown>;
  const schedule: ReminderSchedule = r.schedule === "every" || r.schedule === "days" || r.schedule === "off" ? r.schedule : "monday";
  const auto = r.auto === true;
  const since = typeof r.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.since) ? r.since : undefined;
  const out: ClientReminders = { schedule, auto, ...(since ? { since } : {}) };
  if (schedule === "every") {
    const n = Math.round(Number(r.every));
    out.every = Number.isFinite(n) && n >= 2 && n <= 10 ? n : DEFAULT_EVERY;
  }
  if (schedule === "days") {
    const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 5))].sort((a, b) => a - b) : [];
    // No days left means no reminders, the same as Off.
    if (!days.length) return { schedule: "off", auto, ...(since ? { since } : {}) };
    // Only Monday is the default schedule.
    if (days.length === 1 && days[0] === 1) return { schedule: "monday", auto, ...(since ? { since } : {}) };
    out.days = days;
  }
  return out;
}

/** 0 Sunday to 6 Saturday, for a yyyy-mm-dd. */
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** Whether the 8 AM job reminds this client today. `lastReminder` is the
 *  Pacific date of the newest reminder sent or queued for them (null when
 *  none ever was). Never on a weekend. */
export function isReminderDay(raw: unknown, today: string, lastReminder: string | null): boolean {
  const s = reminderSettings(raw);
  const dow = weekday(today);
  if (dow === 0 || dow === 6) return false;
  switch (s.schedule) {
    case "off": return false;
    case "monday": return dow === 1;
    case "days": return (s.days ?? []).includes(dow);
    case "every": {
      const n = s.every ?? DEFAULT_EVERY;
      // Counted from the last one, unless the schedule was chosen after it:
      // then the first weekday after it was chosen.
      if (lastReminder && (!s.since || lastReminder >= s.since)) return today >= addBusinessDaysIso(lastReminder, n);
      if (s.since) return today > s.since;
      return true;
    }
  }
}

/** Where the 8 AM job queues it: "pending" the 15 minute sender sends,
 *  `reviewStatus` waits for a person. */
export const reminderQueueStatus = (raw: unknown, reviewStatus: string): string => (reminderSettings(raw).auto ? "pending" : reviewStatus);

/** The card's line: "Reminds Mondays · for review", "Reminds every 3
 *  business days · sends itself", "Reminders off". */
export function reminderLine(raw: unknown): string {
  const s = reminderSettings(raw);
  if (s.schedule === "off") return "Reminders off";
  const when = s.schedule === "monday" ? "Mondays"
    : s.schedule === "every" ? `every ${s.every} business days`
    : listWords((s.days ?? []).map((d) => WEEKDAY_PLURAL[d - 1]));
  return `Reminds ${when} · ${s.auto ? "sends itself" : "for review"}`;
}

const listWords = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

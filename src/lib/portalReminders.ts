// The Monday and Wednesday morning email to each client (Derek, 2026-10-05):
// what we need from them, and what's still in the works, with a button to
// their portal. Pure, so the wording and the timing can be tested.

import { draftLinkAsButton, draftLinkHtml, escapeHtml } from "./draftLink";

export const PORTAL_REMINDER_PREFIX = "smr_portal_";
const TZ = "America/Los_Angeles";

/** Monday, 8 AM in California (the cron runs at 15:00 and 16:00 UTC so one
 *  of them is 8 AM whether it's summer or winter). Every weekday was tried
 *  for follow ups and held back to Monday (Derek, 2026-10-07: "leave it on
 *  Monday for now"); a follow up that came due by then joins Monday's email. */
export function isReminderHour(nowMs: number): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return p.weekday === "Mon" && Number(p.hour) % 24 === 8;
}

/** At most one reminder to a client in this many business days, however many
 *  follow ups come due (Derek: "I don't want the client getting tons of emails"). */
export const REMINDER_GAP_BUSINESS_DAYS = 3;

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export type ReminderTask = { title: string; due: string | null };

/** The Sunday that ends this week (today, when today is Sunday). */
export function endOfWeek(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/** This week's only, so a reminder doesn't bury them (Derek, 2026-10-07: "not
 *  the whole week ... what we're actually working on this week"): late, or
 *  due by Sunday. Something with no date isn't this week's. */
export function thisWeek<T extends ReminderTask>(tasks: T[], today: string): T[] {
  const end = endOfWeek(today);
  return tasks.filter((t) => !!t.due && t.due <= end);
}

/** Every reminder email waits in the Inbox for someone to read it first
 *  (Derek, 2026-10-07): queued at this status, which the 15 minute sender
 *  never picks up; Send there moves it on. */
export const REVIEW_STATUS = "review";

/** The email, or null when nothing is waiting on them this week (no reminder
 *  then). Counts only, never what the items are (Derek, 2026-10-13: Carol
 *  answered a listed email item by item instead of opening her tasks): how
 *  many are overdue, due today and coming up, and one button to her tasks,
 *  where she answers, adds a task or talks to us. */
export function portalReminderEmail(o: { firstName: string | null; needs: ReminderTask[]; all?: ReminderTask[]; working?: ReminderTask[]; showWorking?: boolean; portalUrl: string; monday: boolean; today: string }): { subject: string; body: string } | null {
  if (!o.needs.length) return null;
  const every = o.all?.length ? o.all : o.needs;
  const overdue = every.filter((t) => t.due && t.due < o.today).length;
  const today = every.filter((t) => t.due === o.today).length;
  const later = every.length - overdue - today;
  const parts = [overdue && `${overdue} overdue`, today && `${today} due today`, later && `${later} coming up`].filter(Boolean) as string[];
  const line = (n: number, what: string, color: string) => n ? `<li><b style="color:${color}">${n}</b> ${what}</li>` : "";
  const button = { url: o.portalUrl, label: "Open your tasks" };
  return {
    subject: `${overdue ? "Your attention needed" : o.monday ? "This week" : "Quick check in"}: ${parts.join(", ")}`,
    body: draftLinkAsButton(
      `<p>Hi${o.firstName ? ` ${escapeHtml(o.firstName)}` : ""},</p>` +
      `<p>${overdue ? "We need your help to keep your project moving." : "Here is where things stand with what we need from you."} On your tasks page right now:</p>` +
      `<ul>${line(overdue, overdue === 1 ? "task is overdue" : "tasks are overdue", "#b91c1c")}${line(today, today === 1 ? "is due today" : "are due today", "#b45309")}${line(later, later === 1 ? "is coming up" : "are coming up", "#334155")}</ul>` +
      `<p><b>Click the button below to take care of them.</b></p>${draftLinkHtml(button)}` +
      `<p>On your tasks page you can:</p>` +
      `<ul><li>Answer each one, or send files, right on the task</li><li>Add something new with <b>New task</b></li><li>Chat with us about any of them</li></ul>` +
      `<p>Please use your tasks page rather than replying to this email, so nothing gets missed.</p><p>Thanks!</p>`,
      button,
    ),
  };
}

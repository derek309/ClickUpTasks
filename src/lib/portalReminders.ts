// The Monday and Wednesday morning email to each client (Derek, 2026-10-05):
// what we need from them, and what's still in the works, with a button to
// their portal. Pure, so the wording and the timing can be tested.

import { draftLinkAsButton, draftLinkHtml, escapeHtml } from "./draftLink";

export const PORTAL_REMINDER_PREFIX = "smr_portal_";
const TZ = "America/Los_Angeles";

/** Monday or Wednesday, 8 AM in California (the cron runs at 15:00 and 16:00
 *  UTC so one of them is 8 AM whether it's summer or winter). */
export function isReminderHour(nowMs: number): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return (p.weekday === "Mon" || p.weekday === "Wed") && Number(p.hour) % 24 === 8;
}

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export type ReminderTask = { title: string; due: string | null };

/** The email, or null when nothing is waiting on them (no reminder then). */
export function portalReminderEmail(o: { firstName: string | null; needs: ReminderTask[]; working: ReminderTask[]; showWorking: boolean; portalUrl: string; monday: boolean; today: string }): { subject: string; body: string } | null {
  if (!o.needs.length) return null;
  const item = (t: ReminderTask) => {
    const late = t.due && t.due < o.today;
    const when = t.due ? ` <span style="color:${late ? "#b91c1c" : "#b45309"}">(needed by ${shortDate(t.due)}${late ? ", late" : ""})</span>` : "";
    return `<li>${escapeHtml(t.title)}${when}</li>`;
  };
  const working = o.showWorking && o.working.length
    ? `<p>And here is what we are working on for you right now:</p><ul>${o.working.slice(0, 5).map((t) => `<li>${escapeHtml(t.title)}</li>`).join("")}</ul>${o.working.length > 5 ? `<p>Plus ${o.working.length - 5} more.</p>` : ""}`
    : "";
  const button = { url: o.portalUrl, label: "Open your tasks" };
  const n = o.needs.length;
  return {
    subject: o.monday ? `This week: ${n} ${n === 1 ? "thing" : "things"} we need from you` : `Quick check in: ${n} ${n === 1 ? "thing" : "things"} still waiting on you`,
    body: draftLinkAsButton(
      `<p>Hi${o.firstName ? ` ${escapeHtml(o.firstName)}` : ""},</p>` +
      `<p>${o.monday ? "Here is what we need from you to keep things moving this week:" : "A quick reminder of what is still waiting on you:"}</p>` +
      `<ul>${o.needs.map(item).join("")}</ul>${working}` +
      `<p>You can answer, send files or start a doc right from your tasks page.</p>${draftLinkHtml(button)}<p>Thanks!</p>`,
      button,
    ),
  };
}

// The reminder email to a client: how many things we need from them, and a
// link to their client portal (Derek, 2026-10-14: "just tell them counts of
// what we need, we can't move forward until we get this, link to the client
// portal, we don't want them replying"). One wording, used by Remind on the
// client page (Cockpit remindDraftFor) and by the 8 AM job
// (portalReminderServer), so the two can't drift. Pure, so it can be tested.

import { draftLinkHtml, escapeHtml, type DraftLink } from "./draftLink";
import { orderLists } from "./listOrder";

export const PORTAL_REMINDER_PREFIX = "smr_portal_";
const TZ = "America/Los_Angeles";

/** 8 AM in California on a weekday (the cron runs at 15:00 and 16:00 UTC
 *  Monday to Friday so one of them is 8 AM whether it's summer or winter).
 *  Which weekdays a client is reminded on is their own setting
 *  (reminderSchedule.ts); Mondays when nothing is chosen. */
export function isReminderHour(nowMs: number): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(p.weekday) && Number(p.hour) % 24 === 8;
}

/** Reminder emails written for review wait in the Inbox for someone to read
 *  them first (Derek, 2026-10-07): queued at this status, which the 15 minute
 *  sender never picks up; Send there moves it on. A client set to "send on
 *  its own" is queued as pending instead. */
export const REVIEW_STATUS = "review";

export type ReminderGroup = { name: string; count: number };

/** What is waiting, counted by list in the client's list order; anything on
 *  no list (or a list that's gone) counts under Other. */
export function reminderGroups(waiting: { projectId: string | null }[], lists: { id: string; name: string; position?: number | null }[]): ReminderGroup[] {
  const order = orderLists(lists);
  return [...order.map((pr) => ({ name: pr.name, count: waiting.filter((t) => t.projectId === pr.id).length })),
    { name: "Other", count: waiting.filter((t) => !order.some((pr) => pr.id === t.projectId)).length }].filter((g) => g.count > 0);
}

/** The reminder, or null when nothing is waiting. Counts only, never what the
 *  items are (Carol answered a listed email item by item instead of opening
 *  her portal, 2026-10-13); a count per list when there are several. The
 *  link goes in as a plain link line; the server turns it into a button. */
export function reminderEmail(o: { firstName: string | null; groups: ReminderGroup[]; link: DraftLink | null }): { subject: string; body: string; aiContext: string } | null {
  const total = o.groups.reduce((n, g) => n + g.count, 0);
  if (!total) return null;
  const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;
  const several = o.groups.length > 1;
  const countHtml = several ? `<ul>${o.groups.map((g) => `<li><p>${escapeHtml(g.name)}: ${g.count}</p></li>`).join("")}</ul>` : "";
  return {
    subject: `We need ${things(total)} from you to move forward`,
    body: `<p>Hi ${escapeHtml(o.firstName?.trim() || "there")},</p><p>We can't move forward until we get ${things(total)} from you${several ? ":" : "."}</p>`
      + `${countHtml}<p>Each one is in your client portal, where you can answer it or upload what we need.</p>`
      + `${draftLinkHtml(o.link)}<p>Please use the portal rather than replying to this email, so nothing gets missed.</p><p>Thanks!</p>`,
    aiContext: `A short reminder that we can't move forward until the client gets us ${things(total)}. Give only the counts${several ? ` by list (${o.groups.map((g) => `${g.name}: ${g.count}`).join(", ")})` : ""}, never the items themselves. Send them to the client portal link to answer or upload each one, and ask them to use the portal rather than replying to the email.`,
  };
}

export const REMINDER_LINK_LABEL = "Open your client portal";

/** Step reminders the 8 AM job queues (lib/stepReminderServer): their own id
 *  prefix, the step's id in it, so "once" goes once per step. */
export const STEP_REMINDER_PREFIX = "smr_step_";
export const STEP_REMINDER_LINK_LABEL = "Open it in your client portal";

/** The reminder about one item on one step (Derek, 2026-10-15: "sometimes
 *  clients need a reminder on a specific task"): what we asked, why it
 *  matters, the portal link to that item, and to answer there rather than
 *  replying. Short, never the counts email. The link goes in as a plain link
 *  line; the server turns it into a button. */
export function stepReminderEmail(o: { firstName: string | null; ask: string; taskTitle: string; link: DraftLink | null }): { subject: string; body: string } {
  const ask = o.ask.trim() || o.taskTitle.trim();
  const task = o.taskTitle.trim();
  const why = task && task.toLowerCase() !== ask.toLowerCase() ? `We need it to move ${escapeHtml(task)} forward.` : "We need it to move forward.";
  return {
    subject: `Reminder: ${ask}`.slice(0, 120),
    body: `<p>Hi ${escapeHtml(o.firstName?.trim() || "there")},</p><p>A quick reminder about ${escapeHtml(ask)}. ${why}</p>`
      + `${draftLinkHtml(o.link)}<p>Please answer there rather than replying to this email.</p><p>Thanks!</p>`,
  };
}

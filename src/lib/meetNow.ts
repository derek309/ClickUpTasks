// Meet now (Derek, 2026-10-14: when a client says "let's meet", start a
// meeting right away and send them the link). The pure parts, shared by the
// route that starts it (api/calendar/meet-now), the sheet that sends the link
// (MeetNowSheet) and the client page's next meeting line.
import { asksWhatsNext, currentStep, type Subtask } from "./data";

/** How long a meeting started now is booked for. */
export const MEET_NOW_MINUTES = 30;
/** A meeting started now still shows Join now this long after its end:
 *  meetings run over. */
export const MEET_NOW_GRACE_MS = 60 * 60_000;

export type MeetNowMeeting = NonNullable<Subtask["meeting"]>;

/** A link someone can join from: an https address (Zoom, Meet, Teams...). */
export function cleanMeetingLink(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s) ? `https://${s}` : s;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}

/** The words that go with the link, the same in an email and a text. */
export function meetNowText(first: string, url: string): string {
  const name = first.trim();
  return `Hi${name ? ` ${name}` : ""}, here's the link to join me now: ${url}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email: a short subject, and the text as HTML with its links clickable. */
export function meetNowEmail(text: string): { subject: string; html: string } {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const html = paras.map((p) => `<p>${esc(p).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, "<br>")}</p>`).join("");
  return { subject: "Join me now", html };
}

/** The meeting's two steps, as a booked meeting has them (withMeetingSteps):
 *  "Meet with <first>", current, due today and holding the link, then "Add
 *  the meeting transcript" for Granola to fill. Both marked meetNow, so a
 *  booked meeting's sync leaves them be.
 *
 *  Where they go: the step it was started from when that step is still
 *  empty (just added, nothing on it) or asks what's next, which becomes the
 *  meeting; else in front of the current step. Either way the meeting is the
 *  current step. */
export function withMeetNowSteps(subtasks: Subtask[], o: { first: string; due: string; attachmentId: string; meeting: MeetNowMeeting; fromStepId?: string | null },
  makeId: () => string, now = new Date().toISOString()): Subtask[] {
  const meetFields = { title: `Meet with ${o.first}`, due: o.due, addedFor: "meeting", meetNow: true, startedAt: now, meeting: o.meeting, holds: [`att:${o.attachmentId}`] };
  const transcript: Subtask = { id: makeId(), title: "Add the meeting transcript", done: false, due: o.due, addedFor: "transcript", finishWhen: "transcript", meetNow: true };
  const from = o.fromStepId ? subtasks.find((x) => x.id === o.fromStepId && !x.done && !x.fromClient) : null;
  const empty = (x: Subtask) => !x.holds?.length && !x.notes?.trim() && !x.todos?.length && !x.draftMessage && !x.onClient && !x.fromEmails?.length && !x.makes;
  const cur = currentStep(subtasks);
  const reuse = from && (empty(from) || asksWhatsNext(from)) ? from : cur && asksWhatsNext(cur) ? cur : null;
  const meet: Subtask = reuse
    ? { ...reuse, ...meetFields, finishWhen: undefined, namedFrom: undefined }
    : { id: makeId(), done: false, ...meetFields };
  const rest = subtasks.filter((x) => x.id !== reuse?.id);
  // In front of the current step (the reused one stands where it was when it
  // was current, else it moves up there).
  const anchor = cur && cur.id !== reuse?.id ? rest.findIndex((x) => x.id === cur.id) : reuse && cur?.id === reuse.id ? subtasks.findIndex((x) => x.id === reuse.id) : -1;
  const at = anchor >= 0 ? anchor : rest.length;
  return [...rest.slice(0, at), meet, transcript, ...rest.slice(at)];
}

/** The open Meet now step still worth joining: started and not finished,
 *  until an hour after its end. */
export function liveMeeting(subtasks: Pick<Subtask, "done" | "meeting">[] | null | undefined, nowMs: number): MeetNowMeeting | null {
  for (const s of subtasks ?? []) {
    if (s.done || !s.meeting) continue;
    const end = Date.parse(s.meeting.end);
    if (Number.isFinite(end) && end + MEET_NOW_GRACE_MS > nowMs) return s.meeting;
  }
  return null;
}

/** A client's meeting going on now, from their open tasks. */
export function liveMeetingOf(tasks: { status: string; subtasks?: Pick<Subtask, "done" | "meeting">[] | null }[], nowMs: number): MeetNowMeeting | null {
  for (const t of tasks) {
    if (t.status === "done") continue;
    const m = liveMeeting(t.subtasks, nowMs);
    if (m) return m;
  }
  return null;
}

/** The meeting's times: from this minute, MEET_NOW_MINUTES long. */
export function meetNowTimes(nowMs: number): { start: string; end: string } {
  const start = Math.floor(nowMs / 60_000) * 60_000;
  return { start: new Date(start).toISOString(), end: new Date(start + MEET_NOW_MINUTES * 60_000).toISOString() };
}

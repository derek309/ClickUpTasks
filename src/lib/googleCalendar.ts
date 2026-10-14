// SERVER ONLY. Meeting links from a teammate's Google Calendar (Derek,
// 2026-10-07: "why is the zoom link not showing for my meeting with Justin").
// The calendar page reads GoHighLevel, where a meeting on someone's Google
// Calendar comes back only as blocked time, with no link. This reads the same
// week from Google through the Workspace service account Gmail already uses
// (domain-wide delegation, scope calendar.events.readonly, added in Google
// Admin) and gives each blocked time the meeting link of the Google event at
// the same time. Until that scope is added Google refuses, and the page stays
// as it was.

import { JWT } from "google-auth-library";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SA_EMAIL = process.env.GOOGLE_SA_CLIENT_EMAIL;
const SA_KEY = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
export const calendarConfigured = Boolean(SA_EMAIL && SA_KEY);

export type GoogleMeeting = { start: number; end: number; title: string; joinUrl: string | null };

const VIDEO = /https?:\/\/[^\s<>"')\]]*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|meet\.goto\.com)[^\s<>"')\]]*/i;

/** The link to join a Google Calendar event: Meet, a conference entry point,
 *  then a video link written in the location or description. */
export function meetingLinkOf(ev: any): string | null {
  if (typeof ev?.hangoutLink === "string" && ev.hangoutLink) return ev.hangoutLink;
  const video = (ev?.conferenceData?.entryPoints ?? []).find((p: any) => p?.entryPointType === "video" && typeof p.uri === "string");
  if (video) return video.uri as string;
  for (const text of [ev?.location, ev?.description]) {
    const m = typeof text === "string" ? text.match(VIDEO) : null;
    if (m) return m[0].replace(/&amp;/g, "&");
  }
  return null;
}

/** One person's Google Calendar events in the window, with their links. */
export async function googleMeetings(userEmail: string, startMs: number, endMs: number): Promise<GoogleMeeting[]> {
  if (!calendarConfigured) return [];
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [SCOPE], subject: userEmail });
  const qs = new URLSearchParams({ timeMin: new Date(startMs).toISOString(), timeMax: new Date(endMs).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const res = await jwt.request<{ items?: any[] }>({ url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`, timeout: 10000 });
  return (res.data.items ?? [])
    .filter((ev) => ev?.status !== "cancelled" && ev?.start?.dateTime && ev?.end?.dateTime)
    .map((ev) => ({ start: Date.parse(ev.start.dateTime), end: Date.parse(ev.end.dateTime), title: String(ev.summary ?? ""), joinUrl: meetingLinkOf(ev) }));
}

/** Blocked times (GoHighLevel's copy of a Google event) get the link of the
 *  Google event at the same start and end on one of their people's calendars. */
export function withGoogleLinks<E extends { busy: boolean; start: string; end: string; people: string[]; joinUrl: string | null }>(events: E[], byMember: Map<string, GoogleMeeting[]>): E[] {
  return events.map((e) => {
    if (!e.busy || e.joinUrl) return e;
    const s = Date.parse(e.start), en = Date.parse(e.end);
    for (const m of e.people) {
      const hit = (byMember.get(m) ?? []).find((g) => g.joinUrl && g.start === s && g.end === en);
      if (hit) return { ...e, joinUrl: hit.joinUrl };
    }
    return e;
  });
}

// ── Meet now (Derek, 2026-10-14) ─────────────────────────────────────────
// A meeting starting now on the person's own Google Calendar, with a Google
// Meet link and the client as a guest (so Granola knows who it was with).
// Needs the wider scope calendar.events added to the same service account's
// domain-wide delegation in Google Admin; until then Google refuses
// (unauthorized_client) and the caller falls back to the person's own
// meeting link.
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export type GoogleMeetResult = { ok: true; url: string; eventId: string; invited: string | null } | { ok: false; refused: boolean; error: string };

/** Google said no to the scope (not set up in Google Admin), rather than failing. */
export const isScopeRefusal = (msg: string) => /unauthorized_client|access_denied|insufficient|forbidden|\b403\b|not authorized/i.test(msg);

/** Where the event is made. With a guest, Google emails them its invitation
 *  (sendUpdates all), so the meeting lands on their calendar with its link
 *  (Derek, 2026-10-14: the invite rather than a written email). */
export function meetNowEventUrl(invite: boolean): string {
  return `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${invite ? "all" : "none"}`;
}

/** The event Google is asked for: Meet made by Google (link null), or the
 *  person's own link in its location and description. */
export function meetNowEventBody(o: { title: string; start: string; end: string; guest: { email: string; name?: string | null } | null; link: string | null; requestId: string }) {
  return {
    summary: o.title,
    start: { dateTime: o.start },
    end: { dateTime: o.end },
    attendees: o.guest ? [{ email: o.guest.email, ...(o.guest.name ? { displayName: o.guest.name } : {}) }] : [],
    ...(o.link
      ? { location: o.link, description: `Join: ${o.link}` }
      : { conferenceData: { createRequest: { requestId: o.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
  };
}

/** Makes the event on userEmail's primary calendar. With link null, Google
 *  makes the Meet; with a link, the event carries that link instead. */
export async function createGoogleMeeting(userEmail: string, o: { title: string; start: string; end: string; guest: { email: string; name?: string | null } | null; link: string | null }): Promise<GoogleMeetResult> {
  if (!calendarConfigured) return { ok: false, refused: true, error: "Google isn't set up here." };
  try {
    const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [WRITE_SCOPE], subject: userEmail });
    const body = meetNowEventBody({ ...o, requestId: `meetnow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    const res = await jwt.request<any>({
      url: meetNowEventUrl(!!o.guest),
      method: "POST", data: body, timeout: 15000,
    });
    let ev = res.data;
    // Google can make the Meet a moment after the event: look again briefly.
    for (let i = 0; !o.link && !meetingLinkOf(ev) && i < 3; i++) {
      await new Promise((r) => setTimeout(r, 800));
      ev = (await jwt.request<any>({ url: `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev.id)}`, timeout: 10000 })).data;
    }
    const url = o.link ?? meetingLinkOf(ev);
    if (!url) return { ok: false, refused: false, error: "Google made the event without a Meet link." };
    return { ok: true, url, eventId: String(ev.id), invited: o.guest?.email ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, refused: isScopeRefusal(msg), error: msg.slice(0, 200) };
  }
}

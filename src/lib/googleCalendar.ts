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

// SERVER ONLY. Calendars, read live from GoHighLevel (Derek, 2026-10-05:
// "my calendars live in GoHighLevel"). GoHighLevel stays the record: nothing
// here is stored, booked or reminded. One file knows the calendar endpoints,
// so the hourly appointment sync (api/ghl/sync-appointments) and the calendar
// view (api/calendar) read them the same way.
//
// Who has a calendar: teammates whose profile has a GoHighLevel user id
// (profiles.ghl_user_id, filled by the GHL pull). Events come per person per
// sub-account, across every calendar they are on, plus their blocked time.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = "https://services.leadconnectorhq.com";
const CAL_VERSION = "2021-04-15";
const headers = (token: string, version = CAL_VERSION) => ({ Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" });

export type CalendarActor = { id: string; memberId: string | null };

/** Every calendar in a sub-account. Throws with the status on a refusal. */
export async function ghlCalendars(locationId: string, token: string): Promise<any[]> {
  const res = await fetch(`${API}/calendars/?locationId=${encodeURIComponent(locationId)}`, { headers: headers(token), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`calendars ${res.status}`);
  return (await res.json())?.calendars ?? [];
}

/** Appointments in a window, for one calendar or one person. */
export async function ghlEvents(locationId: string, token: string, by: { calendarId: string } | { userId: string }, startMs: number, endMs: number): Promise<any[]> {
  const who = "calendarId" in by ? `calendarId=${encodeURIComponent(by.calendarId)}` : `userId=${encodeURIComponent(by.userId)}`;
  const res = await fetch(`${API}/calendars/events?locationId=${encodeURIComponent(locationId)}&${who}&startTime=${startMs}&endTime=${endMs}`, { headers: headers(token), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`events ${res.status}`);
  return (await res.json())?.events ?? [];
}

/** A person's blocked (busy) time in a window. */
export async function ghlBlocked(locationId: string, token: string, userId: string, startMs: number, endMs: number): Promise<any[]> {
  const res = await fetch(`${API}/calendars/blocked-slots?locationId=${encodeURIComponent(locationId)}&userId=${encodeURIComponent(userId)}&startTime=${startMs}&endTime=${endMs}`, { headers: headers(token), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`blocked ${res.status}`);
  return (await res.json())?.events ?? [];
}

/** An appointment that is really on: not deleted, cancelled or invalid. */
export function isLiveAppointment(ev: any): boolean {
  if (!ev || ev.deleted) return false;
  const status = String(ev.appointmentStatus ?? ev.appoinmentStatus ?? "").toLowerCase();
  return status !== "cancelled" && status !== "invalid" && !!ev.startTime;
}

export type CalendarPerson = { memberId: string; name: string; ghlUserId: string };

export type CalendarEvent = {
  id: string;
  start: string;
  end: string;
  title: string;
  /** Member ids of the people it's for (both on a shared meeting). */
  people: string[];
  calendarName: string | null;
  ghlContactId: string | null;
  clientId: string | null;
  contactName: string | null;
  /** A join link GoHighLevel keeps in "address" (Zoom, Meet). */
  joinUrl: string | null;
  /** Blocked time rather than an appointment. */
  busy: boolean;
};

/** One GoHighLevel event or blocked slot, in the shape the view reads. */
export function normalizeEvent(ev: any, o: { busy: boolean; memberId: string; calendarNames: Map<string, string> }): CalendarEvent {
  const address = typeof ev.address === "string" ? ev.address.trim() : "";
  return {
    id: String(ev.id),
    start: String(ev.startTime),
    end: String(ev.endTime ?? ev.startTime),
    title: (typeof ev.title === "string" && ev.title.trim()) || (o.busy ? "Busy" : "Appointment"),
    people: [o.memberId],
    calendarName: ev.calendarId ? o.calendarNames.get(ev.calendarId) ?? null : null,
    ghlContactId: o.busy ? null : ev.contactId ?? null,
    clientId: null,
    contactName: null,
    joinUrl: /^https?:\/\//i.test(address) ? address : null,
    busy: o.busy,
  };
}

/** The same meeting seen from two people's calendars, once, with both.
 *  Blocked time comes back from each sub-account and once per person (a shared
 *  Google meeting), so it merges by time and title; blocked time that is really
 *  an appointment already listed is left out. */
export function mergeEvents(list: CalendarEvent[]): CalendarEvent[] {
  const byKey = new Map<string, CalendarEvent>();
  const keyOf = (e: CalendarEvent) => (e.busy ? `busy|${Date.parse(e.start)}|${Date.parse(e.end)}|${e.title.trim().toLowerCase()}` : `appt|${e.id}`);
  for (const e of list) {
    const k = keyOf(e);
    const had = byKey.get(k);
    if (had) had.people = [...new Set([...had.people, ...e.people])];
    else byKey.set(k, { ...e, people: [...e.people] });
  }
  const all = [...byKey.values()];
  const appts = all.filter((e) => !e.busy);
  const kept = all.filter((e) => !e.busy || !appts.some((a) => Date.parse(a.start) === Date.parse(e.start) && Date.parse(a.end) === Date.parse(e.end) && (a.title.trim().toLowerCase() === e.title.trim().toLowerCase() || a.people.some((p) => e.people.includes(p)))));
  return kept.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Number(a.busy) - Number(b.busy) || a.title.localeCompare(b.title));
}

/** A block of a day or more (a working location like Home or Office). */
export const isAllDay = (e: { start: string; end: string }) => Date.parse(e.end) - Date.parse(e.start) >= 23 * 3_600_000;

/** A calendar's public booking page, on the sub-account's own domain when it has one. */
export function bookingUrl(calendarId: string, domain: string | null | undefined): string {
  const host = (domain ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "") || "api.leadconnectorhq.com";
  return `https://${host}/widget/booking/${encodeURIComponent(calendarId)}`;
}

/** Teammates with a GoHighLevel user id. Today: Derek and Justin. */
export async function calendarPeople(): Promise<CalendarPerson[]> {
  const { data } = await supabaseAdmin.from("profiles").select("id, member_id, name, ghl_user_id").not("ghl_user_id", "is", null);
  return ((data ?? []) as any[])
    .filter((p) => String(p.ghl_user_id ?? "").trim())
    .map((p) => ({ memberId: (p.member_id || p.id) as string, name: (p.name as string) || "Teammate", ghlUserId: String(p.ghl_user_id).trim() }));
}

// Calendars and a sub-account's domain change rarely; events change often.
const calCache = new Map<string, { at: number; calendars: any[]; domain: string | null }>();
async function locationInfo(locationId: string, token: string): Promise<{ calendars: any[]; domain: string | null }> {
  const hit = calCache.get(locationId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const calendars = await ghlCalendars(locationId, token);
  const loc = await fetch(`${API}/locations/${encodeURIComponent(locationId)}`, { headers: headers(token, "2021-07-28"), signal: AbortSignal.timeout(10000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const info = { at: Date.now(), calendars, domain: (loc?.location?.domain as string | undefined) || null };
  calCache.set(locationId, info);
  return info;
}

let eventCache: { at: number; days: number; events: CalendarEvent[]; errors: string[] } | null = null;

/** The next `days` days for everyone with a calendar, read live (60 second cache). */
export async function listEvents(_actor: CalendarActor, opts: { days?: number } = {}): Promise<{ people: CalendarPerson[]; events: CalendarEvent[]; errors: string[] }> {
  const days = Math.min(Math.max(opts.days ?? 14, 1), 31);
  const people = await calendarPeople();
  if (eventCache && eventCache.days === days && Date.now() - eventCache.at < 60_000) return { people, events: eventCache.events, errors: eventCache.errors };

  // From the start of today, Pacific, so this morning's meetings still show.
  const now = Date.now();
  const startMs = startOfPacificDay(now);
  const endMs = startMs + days * 86_400_000;
  const errors: string[] = [];
  const found: CalendarEvent[] = [];
  for (const locationId of await configuredLocations()) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    let names = new Map<string, string>();
    try { names = new Map((await locationInfo(locationId, token)).calendars.map((c: any) => [String(c.id), String(c.name ?? "")])); }
    catch (e) { errors.push(`${locationId}: ${e instanceof Error ? e.message : "calendars failed"}`); }
    await Promise.all(people.map(async (p) => {
      try {
        const [evs, blocked] = await Promise.all([
          ghlEvents(locationId, token, { userId: p.ghlUserId }, startMs, endMs),
          ghlBlocked(locationId, token, p.ghlUserId, startMs, endMs),
        ]);
        for (const ev of evs) if (isLiveAppointment(ev)) found.push(normalizeEvent(ev, { busy: false, memberId: p.memberId, calendarNames: names }));
        for (const ev of blocked) if (ev && !ev.deleted && ev.startTime) found.push(normalizeEvent(ev, { busy: true, memberId: p.memberId, calendarNames: names }));
      } catch (e) {
        errors.push(`${locationId}/${p.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }));
  }
  const events = mergeEvents(found);

  // Who each appointment is with, as a client in this app.
  const ghlIds = [...new Set(events.map((e) => e.ghlContactId).filter((x): x is string => !!x))];
  if (ghlIds.length) {
    const { data } = await supabaseAdmin.from("contacts").select("ghl_contact_id, name, client_id").in("ghl_contact_id", ghlIds);
    const byGhl = new Map(((data ?? []) as any[]).map((c) => [c.ghl_contact_id as string, c]));
    for (const e of events) {
      const c = e.ghlContactId ? byGhl.get(e.ghlContactId) : null;
      if (c) { e.clientId = (c.client_id as string | null) ?? null; e.contactName = (c.name as string | null) ?? null; }
    }
  }
  eventCache = { at: Date.now(), days, events, errors };
  return { people, events, errors };
}

/** Midnight today in Los Angeles, as a timestamp. */
export function startOfPacificDay(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const sinceMidnight = ((get("hour") % 24) * 3600 + get("minute") * 60 + get("second")) * 1000 + (nowMs % 1000);
  return nowMs - sinceMidnight;
}

export type BookingLink = { memberId: string; label: string; url: string; shared: boolean };

/** Every active calendar each person is on, with its public booking page (Derek's pick). */
// The actor is for the MCP tools to come (Phase 4); every teammate sees the same links today.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function bookingLinks(_actor: CalendarActor): Promise<BookingLink[]> {
  const people = await calendarPeople();
  const out: BookingLink[] = [];
  for (const locationId of await configuredLocations()) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    let info: { calendars: any[]; domain: string | null };
    try { info = await locationInfo(locationId, token); } catch { continue; }
    for (const c of info.calendars) {
      if (!c?.id || c.isActive === false) continue;
      const members: string[] = ((c.teamMembers ?? []) as any[]).map((t) => String(t?.userId ?? "")).filter(Boolean);
      const url = bookingUrl(String(c.id), info.domain);
      for (const p of people) {
        // A personal calendar with no team list belongs to whoever it's named for.
        const mine = members.includes(p.ghlUserId) || (!members.length && String(c.name ?? "").toLowerCase().startsWith(p.name.toLowerCase()));
        if (mine) out.push({ memberId: p.memberId, label: String(c.name ?? "Booking page"), url, shared: members.length > 1 });
      }
    }
  }
  return out.sort((a, b) => Number(a.shared) - Number(b.shared) || a.label.localeCompare(b.label));
}

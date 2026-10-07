// SERVER ONLY. Calendars, read live from GoHighLevel (Derek, 2026-10-05:
// "my calendars live in GoHighLevel"). GoHighLevel stays the record: nothing
// here is stored, booked or reminded. One file knows the calendar endpoints,
// so the hourly appointment sync (api/ghl/sync-appointments) and the calendar
// view (api/calendar) read them the same way.
//
// Who has a calendar: teammates whose profile has a GoHighLevel user id
// (profiles.ghl_user_id, filled by the GHL pull). Events come per person per
// sub-account, across every calendar they are on, plus their blocked time.
import { calendarConfigured, googleMeetings, withGoogleLinks, type GoogleMeeting } from "./googleCalendar";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";
import { contactHome } from "@/lib/ghlPerson";
import { resolveOrPromoteTrackedClient, upsertConversationTask, toPacificDate, todayPacific, bumpStatusToInterview } from "@/lib/ghlConversationTask";
import { titleCase } from "@/lib/data";

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

export type CalendarPerson = { memberId: string; name: string; ghlUserId: string; email?: string | null };

export type CalendarEvent = {
  id: string;
  start: string;
  end: string;
  title: string;
  /** Member ids of the people it's for (both on a shared meeting). */
  people: string[];
  /** GoHighLevel's appointment status: confirmed, showed, noshow (null for busy time). */
  status?: string | null;
  calendarId: string | null;
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
    calendarId: o.busy ? null : ev.calendarId ?? null,
    calendarName: ev.calendarId ? o.calendarNames.get(ev.calendarId) ?? null : null,
    ghlContactId: o.busy ? null : ev.contactId ?? null,
    clientId: null,
    contactName: null,
    joinUrl: /^https?:\/\//i.test(address) ? address : null,
    busy: o.busy,
    status: o.busy ? null : String(ev.appointmentStatus ?? ev.appoinmentStatus ?? "confirmed").toLowerCase() || null,
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
  const { data } = await supabaseAdmin.from("profiles").select("id, member_id, name, ghl_user_id, email").not("ghl_user_id", "is", null);
  return ((data ?? []) as any[])
    .filter((p) => String(p.ghl_user_id ?? "").trim())
    .map((p) => ({ memberId: (p.member_id || p.id) as string, name: (p.name as string) || "Teammate", ghlUserId: String(p.ghl_user_id).trim(), email: (p.email as string | null) ?? null }));
}

// Calendars and a sub-account's domain change rarely; events change often.
const calCache = new Map<string, { at: number; calendars: any[]; domain: string | null; name: string | null }>();
async function locationInfo(locationId: string, token: string): Promise<{ calendars: any[]; domain: string | null; name: string | null }> {
  const hit = calCache.get(locationId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const calendars = await ghlCalendars(locationId, token);
  const loc = await fetch(`${API}/locations/${encodeURIComponent(locationId)}`, { headers: headers(token, "2021-07-28"), signal: AbortSignal.timeout(10000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const info = { at: Date.now(), calendars, domain: (loc?.location?.domain as string | undefined) || null, name: (loc?.location?.name as string | undefined) || null };
  calCache.set(locationId, info);
  return info;
}

let eventCache: { at: number; days: number; events: CalendarEvent[]; errors: string[] } | null = null;

/** The next `days` days for everyone with a calendar, read live (60 second cache). */
export async function listEvents(_actor: CalendarActor, opts: { days?: number; fresh?: boolean } = {}): Promise<{ people: CalendarPerson[]; events: CalendarEvent[]; errors: string[] }> {
  // Up to about three months: the calendar's week arrows go twelve weeks on.
  const days = Math.min(Math.max(opts.days ?? 14, 1), 100);
  const people = await calendarPeople();
  // fresh: right after a booking, move or cancel. Each route runs on its own
  // in production, so the one that wrote can't empty this cache itself.
  if (!opts.fresh && eventCache && eventCache.days === days && Date.now() - eventCache.at < 60_000) return { people, events: eventCache.events, errors: eventCache.errors };

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
  // Meeting links from Google Calendar for blocked times (googleCalendar.ts).
  // Quietly nothing until the calendar scope is added in Google Admin.
  const byMember = new Map<string, GoogleMeeting[]>();
  if (calendarConfigured) await Promise.all(people.filter((p) => p.email?.endsWith("@clickuplocal.com")).map(async (p) => {
    try { byMember.set(p.memberId, await googleMeetings(p.email!, startMs, endMs)); }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); if (!/unauthorized_client|forbidden|403|insufficient/i.test(msg)) errors.push(`google/${p.name}: ${msg.slice(0, 120)}`); }
  }));
  const events = withGoogleLinks(mergeEvents(found), byMember);

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

export type BookingLink = { memberId: string; label: string; url: string; shared: boolean; calendarId: string; locationId: string; minutes: number; locationName: string };

/** Every active calendar each person is on, with its public booking page (Derek's pick). */
// The actor is for the MCP tools to come (Phase 4); every teammate sees the same links today.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function bookingLinks(_actor: CalendarActor): Promise<BookingLink[]> {
  const people = await calendarPeople();
  const out: BookingLink[] = [];
  for (const locationId of await configuredLocations()) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    let info: { calendars: any[]; domain: string | null; name: string | null };
    try { info = await locationInfo(locationId, token); } catch { continue; }
    for (const c of info.calendars) {
      if (!c?.id || c.isActive === false) continue;
      const members: string[] = ((c.teamMembers ?? []) as any[]).map((t) => String(t?.userId ?? "")).filter(Boolean);
      const url = bookingUrl(String(c.id), info.domain);
      for (const p of people) {
        // A personal calendar with no team list belongs to whoever it's named for.
        const mine = members.includes(p.ghlUserId) || (!members.length && String(c.name ?? "").toLowerCase().startsWith(p.name.toLowerCase()));
        if (mine) out.push({ memberId: p.memberId, label: String(c.name ?? "Booking page"), url, shared: members.length > 1, calendarId: String(c.id), locationId, minutes: slotMinutes(c), locationName: info.name ?? locationId });
      }
    }
  }
  return out.sort((a, b) => Number(a.shared) - Number(b.shared) || a.label.localeCompare(b.label));
}

// ── Phase 2: book, reschedule and cancel (Derek, 2026-10-05) ──────────────
// Written to GoHighLevel, which sends its own confirmations and reminders by
// each calendar's settings. Nothing is stored here; the client's Conversation
// task moves to the meeting date straight away, as the hourly sync would.

/** A calendar's meeting length in minutes (slotDuration, in mins or hours). */
export function slotMinutes(c: any): number {
  const n = Number(c?.slotDuration) || 30;
  return String(c?.slotDurationUnit ?? "mins").startsWith("hour") ? n * 60 : n;
}

type CalendarRef = { id: string; locationId: string; name: string; minutes: number; members: string[] };
async function findCalendar(calendarId: string): Promise<{ cal: CalendarRef; token: string } | null> {
  for (const locationId of await configuredLocations()) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    let info: { calendars: any[] };
    try { info = await locationInfo(locationId, token); } catch { continue; }
    const c = info.calendars.find((x: any) => String(x.id) === calendarId);
    if (c) return { token, cal: { id: calendarId, locationId, name: String(c.name ?? ""), minutes: slotMinutes(c), members: ((c.teamMembers ?? []) as any[]).map((t) => String(t?.userId ?? "")).filter(Boolean) } };
  }
  return null;
}

const slotCache = new Map<string, { at: number; slots: string[] }>();
/** Open start times on a calendar for the next `days` days, Pacific (60 second cache). */
export async function freeSlots(calendarId: string, days = 7): Promise<{ slots: string[]; minutes: number; locationId: string } | { error: string }> {
  const found = await findCalendar(calendarId);
  if (!found) return { error: "That calendar isn't in GoHighLevel any more." };
  const key = `${calendarId}|${days}`;
  const hit = slotCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return { slots: hit.slots, minutes: found.cal.minutes, locationId: found.cal.locationId };
  const from = Date.now();
  const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}/free-slots?startDate=${from}&endDate=${from + days * 86_400_000}&timezone=America/Los_Angeles`, { headers: headers(found.token), signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { error: `GoHighLevel didn't give the open times (${res.status}).` };
  const j: any = await res.json().catch(() => ({}));
  const slots = Object.keys(j).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().flatMap((k) => ((j[k]?.slots ?? []) as string[]))
    .filter((t) => Date.parse(t) > from);
  slotCache.set(key, { at: Date.now(), slots });
  return { slots, minutes: found.cal.minutes, locationId: found.cal.locationId };
}

/** The contact behind a GoHighLevel id, and the sub-account it lives in. */
async function contactFor(ghlContactId: string) {
  const { data: contact } = await supabaseAdmin.from("contacts").select("id, name, client_id").eq("ghl_contact_id", ghlContactId).maybeSingle();
  const home = await contactHome(ghlContactId);
  return { contact: contact as { id: string; name: string; client_id: string } | null, locationId: home?.locationId ?? null };
}

/** The meeting's date on the client's Conversation task, as the hourly sync does. */
async function bumpTask(ghlContactId: string, startIso: string, title: string, joinUrl: string | null) {
  const { contact } = await contactFor(ghlContactId);
  if (!contact) return;
  contact.client_id = await resolveOrPromoteTrackedClient(contact);
  await bumpStatusToInterview(contact.client_id);
  await upsertConversationTask(contact, ghlContactId, { due: toPacificDate(startIso), title, location: joinUrl });
}

export type BookResult = { ok: true; id: string; start: string; calendarName: string } | { ok: false; error: string; status: number };

/** Book a contact on a calendar at one of its open times. The person booking is
 *  the one it's assigned to when they're on that calendar. */
export async function bookAppointment(actor: CalendarActor, input: { calendarId: string; ghlContactId: string; start: string; custom?: boolean }): Promise<BookResult> {
  const found = await findCalendar(input.calendarId);
  if (!found) return { ok: false, status: 404, error: "That calendar isn't in GoHighLevel any more." };
  const { contact, locationId } = await contactFor(input.ghlContactId);
  if (!locationId) return { ok: false, status: 400, error: "This person isn't a GoHighLevel contact yet. Add them first." };
  if (locationId !== found.cal.locationId) return { ok: false, status: 400, error: "That calendar is in the other sub-account from this contact. Pick one of their sub-account's calendars." };
  const startMs = Date.parse(input.start);
  if (!Number.isFinite(startMs) || startMs < Date.now()) return { ok: false, status: 400, error: "Pick a time that hasn't passed." };
  const { data: me } = actor.memberId ? await supabaseAdmin.from("profiles").select("ghl_user_id").eq("member_id", actor.memberId).maybeSingle() : { data: null };
  const mine = String((me as any)?.ghl_user_id ?? "").trim();
  const assignedUserId = mine && found.cal.members.includes(mine) ? mine : found.cal.members[0] ?? (mine || undefined);
  const name = contact?.name ? titleCase(contact.name) : "Client";
  const title = `${name} + ${found.cal.name}`;
  const res = await fetch(`${API}/calendars/events/appointments`, {
    method: "POST", headers: { ...headers(found.token), "Content-Type": "application/json" },
    body: JSON.stringify({ calendarId: found.cal.id, locationId: found.cal.locationId, contactId: input.ghlContactId, startTime: input.start,
      endTime: new Date(startMs + found.cal.minutes * 60_000).toISOString(), title, appointmentStatus: "confirmed", ...(assignedUserId ? { assignedUserId } : {}), toNotify: true,
      // A time someone typed (Derek, 2026-10-05): GoHighLevel books it even when it isn't an open slot.
      ...(input.custom ? { ignoreFreeSlotValidation: true } : {}) }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j?.id) return { ok: false, status: res.status === 400 || res.status === 422 ? 409 : 502, error: /slot|available/i.test(String(j?.message ?? "")) ? "That time was just taken. Pick another." : `GoHighLevel didn't book it (${res.status}). ${String(j?.message ?? "").slice(0, 120)}` };
  slotCache.clear(); eventCache = null;
  await bumpTask(input.ghlContactId, input.start, `Meeting with ${name}`, typeof j.address === "string" && /^https?:/.test(j.address) ? j.address : null).catch(() => {});
  return { ok: true, id: String(j.id), start: input.start, calendarName: found.cal.name };
}

async function appointmentOf(id: string): Promise<{ appt: any; token: string } | null> {
  for (const locationId of await configuredLocations()) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    const res = await fetch(`${API}/calendars/events/appointments/${encodeURIComponent(id)}`, { headers: headers(token), signal: AbortSignal.timeout(10000) }).catch(() => null);
    const appt = res?.ok ? (await res.json().catch(() => null))?.appointment : null;
    if (appt && appt.locationId === locationId && !appt.deleted) return { appt, token };
  }
  return null;
}

/** Move an appointment to another open time on its calendar. */
export async function rescheduleAppointment(_actor: CalendarActor, input: { id: string; start: string; custom?: boolean }): Promise<BookResult> {
  const found = await appointmentOf(input.id);
  if (!found) return { ok: false, status: 404, error: "That appointment isn't in GoHighLevel any more." };
  const cal = await findCalendar(String(found.appt.calendarId));
  const startMs = Date.parse(input.start);
  if (!Number.isFinite(startMs) || startMs < Date.now()) return { ok: false, status: 400, error: "Pick a time that hasn't passed." };
  const length = Date.parse(found.appt.endTime) - Date.parse(found.appt.startTime);
  const res = await fetch(`${API}/calendars/events/appointments/${encodeURIComponent(input.id)}`, {
    method: "PUT", headers: { ...headers(found.token), "Content-Type": "application/json" },
    body: JSON.stringify({ calendarId: found.appt.calendarId, startTime: input.start, endTime: new Date(startMs + (length > 0 ? length : (cal?.cal.minutes ?? 30) * 60_000)).toISOString(), toNotify: true, ...(input.custom ? { ignoreFreeSlotValidation: true } : {}) }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: 502, error: `GoHighLevel didn't move it (${res.status}). ${String(j?.message ?? "").slice(0, 120)}` };
  slotCache.clear(); eventCache = null;
  if (found.appt.contactId) await bumpTask(String(found.appt.contactId), input.start, String(found.appt.title ?? "Meeting"), null).catch(() => {});
  return { ok: true, id: input.id, start: input.start, calendarName: cal?.cal.name ?? "" };
}

/** Cancel an appointment: marked cancelled in GoHighLevel, which tells the
 *  client by the calendar's settings. Kept there, never deleted. */
export async function cancelAppointment(_actor: CalendarActor, id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const found = await appointmentOf(id);
  if (!found) return { ok: false, status: 404, error: "That appointment isn't in GoHighLevel any more." };
  const res = await fetch(`${API}/calendars/events/appointments/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { ...headers(found.token), "Content-Type": "application/json" },
    body: JSON.stringify({ calendarId: found.appt.calendarId, appointmentStatus: "cancelled", toNotify: true }),
  });
  if (!res.ok) return { ok: false, status: 502, error: `GoHighLevel didn't cancel it (${res.status}).` };
  slotCache.clear(); eventCache = null;
  if (found.appt.contactId) await resetMeetingTask(String(found.appt.contactId), String(found.appt.startTime)).catch(() => {});
  return { ok: true };
}

/** Mark how a meeting went (Derek, 2026-10-05): confirmed, showed or no show,
 *  as GoHighLevel's own status menu does. Nobody is notified. Cancelling goes
 *  through cancelAppointment, which also resets the meeting task. */
export const APPOINTMENT_STATUSES = ["confirmed", "showed", "noshow", "invalid"] as const;
export async function setAppointmentStatus(_actor: CalendarActor, id: string, status: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(status)) return { ok: false, status: 400, error: "That isn't a status GoHighLevel knows." };
  const found = await appointmentOf(id);
  if (!found) return { ok: false, status: 404, error: "That appointment isn't in GoHighLevel any more." };
  const res = await fetch(`${API}/calendars/events/appointments/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { ...headers(found.token), "Content-Type": "application/json" },
    body: JSON.stringify({ calendarId: found.appt.calendarId, appointmentStatus: status, toNotify: false }),
  });
  if (!res.ok) return { ok: false, status: 502, error: `GoHighLevel didn't take the change (${res.status}).` };
  eventCache = null;
  return { ok: true };
}

/** What a cancelled meeting does to the client's Conversation task (Derek,
 *  2026-10-05: "reset the task on cancel"): "Meeting with X" on that date
 *  becomes "Rebook X (meeting cancelled)", due today, without the join link,
 *  with a line in its history. A task that has moved on since is left alone. */
export function meetingTaskReset(task: { title: string; due: string | null; attachments?: { name?: string }[] | null; comments?: unknown[] | null }, meetingStart: string, today: string, now: string, authorId = "u_derek") {
  if (!/^meeting with /i.test(task.title.trim()) || task.due !== toPacificDate(meetingStart)) return null;
  const who = task.title.trim().replace(/^meeting with /i, "");
  const when = new Date(meetingStart).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    title: `Rebook ${who} (meeting cancelled)`,
    due: today,
    last_activity_at: now,
    attachments: (task.attachments ?? []).filter((a) => a?.name !== "Meeting location"),
    comments: [...(Array.isArray(task.comments) ? task.comments : []), { id: "cm_" + crypto.randomUUID(), authorId, body: `Meeting on ${when} cancelled`, at: now, kind: "event" }],
  };
}

async function resetMeetingTask(ghlContactId: string, meetingStart: string) {
  const { contact } = await contactFor(ghlContactId);
  if (!contact) return;
  const { data: task } = await supabaseAdmin.from("tasks").select("id, title, due, attachments, comments")
    .eq("contact_id", contact.id).eq("priority", "conversation").neq("status", "done").is("deleted_at", null).limit(1).maybeSingle();
  if (!task) return;
  const patch = meetingTaskReset(task as any, meetingStart, todayPacific(), new Date().toISOString());
  if (patch) await supabaseAdmin.from("tasks").update({ ...patch, updated_by: null }).eq("id", (task as any).id);
}

/** A date and a time typed in Los Angeles ("2026-10-13", "07:30"), as an instant. */
export function pacificToIso(date: string, time: string, timeZone = "America/Los_Angeles"): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const guess = Date.parse(`${date}T${time}:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  return new Date(guess - (wall - guess)).toISOString();
}

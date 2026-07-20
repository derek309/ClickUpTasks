import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { titleCase } from "@/lib/data";
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";
import { resolveTrackedClientId, upsertConversationTask, toPacificDate } from "@/lib/ghlConversationTask";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Polls GoHighLevel's Calendar API for upcoming appointments and folds them
// into the same "one open top-tier task per contact" pipeline the inbound
// webhook uses for messages/calls (see ghlConversationTask.ts) — a booked
// appointment sorts to the top exactly like a new reply, due-dated to the
// actual appointment time instead of "today" so it surfaces when it matters.
//
// Deliberately polling, not a GHL webhook: this app already has read access
// to every configured sub-account's calendars via the same Private
// Integration tokens contact-sync uses (ghlTokens.ts) — no new GHL workflow
// to build or merge fields to guess at, at the cost of lag between "booked"
// and "shows up here" bounded by how often this runs (fine per Derek — see
// vercel.json's cron entry; can also be triggered on demand, same pattern
// as ../\.\./google/poll-replies).
//
// Explicitly NOT done here (kept simple for v1): no notification/bell ring
// on a booked appointment (messages/calls already ring it; distinguishing
// "freshly created" from "just bumped" would need upsertConversationTask to
// report that back) and no pagination handling for calendars/events beyond
// what a single page returns (not observed to paginate in practice against
// real accounts during development, but a large enough account could hit a
// cap GHL doesn't currently enforce that we've seen).

export const maxDuration = 60;

const GHL_VERSION = "2021-04-15";
const WINDOW_PAST_MS = 60 * 60 * 1000; // still catch a meeting that just started
const WINDOW_FUTURE_DAYS = 30;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });

  // Same three-way auth as ../\.\./google/poll-replies: Vercel cron header,
  // a shared secret for a manual curl, or an admin session (the app's own
  // "Sync appointments" action).
  const authHeader = req.headers.get("authorization") ?? "";
  const cronOk = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const secretOk = !!process.env.GHL_WEBHOOK_SECRET && req.nextUrl.searchParams.get("secret") === process.env.GHL_WEBHOOK_SECRET;
  if (!cronOk && !secretOk) {
    const caller = await requireUser(req);
    if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now() - WINDOW_PAST_MS;
  const endTime = Date.now() + WINDOW_FUTURE_DAYS * 86400000;

  const locations = await configuredLocations();
  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const locationId of locations) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    const headers = { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" };

    let calendars: any[] = [];
    try {
      const res = await fetch(`https://services.leadconnectorhq.com/calendars/?locationId=${encodeURIComponent(locationId)}`, { headers });
      if (!res.ok) { errors.push(`${locationId}: calendars ${res.status}`); continue; }
      calendars = (await res.json())?.calendars ?? [];
    } catch (e: any) {
      errors.push(`${locationId}: calendars fetch failed (${String(e?.message ?? e)})`);
      continue;
    }

    // Soonest upcoming, non-cancelled appointment per contact, across every
    // calendar for this sub-account — one Conversation-task bump per
    // contact, not per appointment (a contact with two upcoming meetings
    // just shows the sooner one, same "one open task" spirit as messages).
    const soonestByContact = new Map<string, { startTime: string; title: string }>();
    for (const cal of calendars) {
      let events: any[] = [];
      try {
        const url = `https://services.leadconnectorhq.com/calendars/events?locationId=${encodeURIComponent(locationId)}&calendarId=${encodeURIComponent(cal.id)}&startTime=${startTime}&endTime=${endTime}`;
        const res = await fetch(url, { headers });
        if (!res.ok) { errors.push(`${locationId}/${cal.id}: events ${res.status}`); continue; }
        events = (await res.json())?.events ?? [];
      } catch (e: any) {
        errors.push(`${locationId}/${cal.id}: events fetch failed (${String(e?.message ?? e)})`);
        continue;
      }

      for (const ev of events) {
        if (ev.deleted) continue;
        const status = String(ev.appointmentStatus ?? "").toLowerCase();
        if (status === "cancelled" || status === "invalid") continue;
        if (!ev.contactId || !ev.startTime) continue;
        const existing = soonestByContact.get(ev.contactId);
        if (!existing || ev.startTime < existing.startTime) {
          soonestByContact.set(ev.contactId, { startTime: ev.startTime, title: typeof ev.title === "string" ? ev.title : "" });
        }
      }
    }

    for (const [ghlContactId, appt] of soonestByContact) {
      const { data: contact } = await supabaseAdmin.from("contacts").select("id, name, client_id").eq("ghl_contact_id", ghlContactId).maybeSingle();
      if (!contact) { skipped++; continue; }
      contact.client_id = await resolveTrackedClientId(contact.id, contact.client_id);
      const taskId = await upsertConversationTask(contact, ghlContactId, {
        due: toPacificDate(appt.startTime),
        title: `Meeting with ${titleCase(contact.name)}`,
      });
      if (taskId) synced++; else skipped++;
    }
  }

  return NextResponse.json({ ok: true, synced, skipped, errors: errors.length ? errors : undefined });
}

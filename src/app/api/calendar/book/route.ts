import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { bookAppointment } from "@/lib/calendarService";

// Book a contact at an open time (Phase 2, Derek, 2026-10-05). Written to
// GoHighLevel, which sends its own confirmations; the client's Conversation
// task moves to the meeting date.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { calendarId?: string; ghlContactId?: string; start?: string; custom?: boolean };
  if (!b.calendarId || !b.ghlContactId || !b.start) return NextResponse.json({ error: "Pick a calendar, a person and a time." }, { status: 400 });
  const r = await bookAppointment({ id: caller.id, memberId: caller.memberId }, { calendarId: b.calendarId, ghlContactId: b.ghlContactId, start: b.start, custom: b.custom === true });
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
}

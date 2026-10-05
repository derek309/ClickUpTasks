import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rescheduleAppointment, cancelAppointment, setAppointmentStatus } from "@/lib/calendarService";

// One appointment (Phase 2, Derek, 2026-10-05): PATCH { id, start } moves it,
// PATCH { id, status } marks how it went (showed, noshow, confirmed, invalid),
// DELETE ?id= cancels it (kept in GoHighLevel as cancelled, never deleted).
export async function PATCH(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; start?: string; custom?: boolean; status?: string };
  if (b.id && b.status) {
    const s = await setAppointmentStatus({ id: caller.id, memberId: caller.memberId }, b.id, b.status);
    return s.ok ? NextResponse.json(s) : NextResponse.json({ error: s.error }, { status: s.status });
  }
  if (!b.id || !b.start) return NextResponse.json({ error: "Pick a new time." }, { status: 400 });
  const r = await rescheduleAppointment({ id: caller.id, memberId: caller.memberId }, { id: b.id, start: b.start, custom: b.custom === true });
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function DELETE(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Which appointment?" }, { status: 400 });
  const r = await cancelAppointment({ id: caller.id, memberId: caller.memberId }, id);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
}

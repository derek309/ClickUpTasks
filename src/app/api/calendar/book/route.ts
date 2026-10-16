import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { bookAppointment } from "@/lib/calendarService";
import { teamTaskAccess } from "@/lib/taskDocumentServer";
import { stepsOnBooked } from "@/lib/stepsServer";

// Book a contact at an open time (Phase 2, Derek, 2026-10-05). Written to
// GoHighLevel, which sends its own confirmations; the client's Conversation
// task moves to the meeting date.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  let caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { calendarId?: string; ghlContactId?: string; start?: string; custom?: boolean; taskId?: string; stepId?: string | null; first?: string };
  if (!b.calendarId || !b.ghlContactId || !b.start) return NextResponse.json({ error: "Pick a calendar, a person and a time." }, { status: 400 });
  // Booked from a step (Derek, 2026-10-16): that step becomes the meeting.
  const taskId = typeof b.taskId === "string" && b.taskId ? b.taskId : null;
  if (taskId) {
    const access = await teamTaskAccess(req, taskId);
    if (!access.ok) return access.res;
    caller = access.user;
  }
  const r = await bookAppointment({ id: caller.id, memberId: caller.memberId }, { calendarId: b.calendarId, ghlContactId: b.ghlContactId, start: b.start, custom: b.custom === true });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const onStep = taskId ? await stepsOnBooked(taskId, {
    start: r.start, first: typeof b.first === "string" ? b.first.slice(0, 60) : null, fromStepId: typeof b.stepId === "string" ? b.stepId : null,
  }).catch((e) => { console.error("[calendar/book] steps on the task failed", e); return false; }) : false;
  return NextResponse.json({ ...r, onStep });
}

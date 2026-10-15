// SERVER-ONLY: a client's booking closes the request it answers, wherever
// the booking came in (lib/bookingClosesRequest holds the rule): the hourly
// appointment sync, the GoHighLevel webhook, a booking made in the app or
// over the MCP. Each wait is finished by stepsServer.stepsOnClientBooked,
// which also cancels that step's reminders; a second run finds the step no
// longer waiting and changes nothing.
import { supabaseAdmin } from "./supabaseAdmin";
import { bookingAnswering, heldMailIds, isLiveBooking, meetingWaitOf, stepBefore, type Booking } from "./bookingClosesRequest";
import { currentStep, type Subtask } from "./data";
import { isClientWait } from "./afterThis";
import { stepsOnClientBooked } from "./stepsServer";
import { resolveOrPromoteTrackedClient } from "./ghlConversationTask";

type Row = { id: string; title: string; subtasks: Subtask[] | null };

/** Finishes the client's open waits about meeting that these bookings
 *  answer. `contact.client_id` is the tracked client (resolveOrPromoteTrackedClient).
 *  How many waits it finished. */
export async function bookingClosesRequests(contact: { id: string; client_id: string }, bookings: Booking[]): Promise<number> {
  const live = bookings.filter(isLiveBooking);
  if (!live.length || !contact.client_id) return 0;
  const { data, error } = await supabaseAdmin.from("tasks").select("id, title, subtasks")
    .or(`client_id.eq.${contact.client_id},contact_id.eq.${contact.id}`)
    .is("deleted_at", null).not("status", "in", "(done,on_hold)").limit(300);
  if (error) return 0;
  // Only tasks whose current step is the client's turn.
  const waiting = ((data ?? []) as Row[]).filter((t) => { const c = currentStep(t.subtasks ?? []); return !!c && isClientWait(c); });
  if (!waiting.length) return 0;
  // The subjects of the emails the waits follow ("Time to meet about…").
  const mailIds = [...new Set(waiting.flatMap((t) => {
    const list = t.subtasks ?? [];
    const c = currentStep(list)!;
    return [...heldMailIds(c), ...heldMailIds(stepBefore(list, c))];
  }))];
  const subjects = new Map<string, string>();
  if (mailIds.length) {
    const { data: msgs } = await supabaseAdmin.from("messages").select("id, subject").in("id", mailIds.slice(0, 200));
    for (const m of (msgs ?? []) as { id: string; subject: string | null }[]) if (m.subject) subjects.set(m.id, m.subject);
  }
  let finished = 0;
  for (const t of waiting) {
    const wait = meetingWaitOf(t, subjects);
    if (!wait) continue;
    const booking = bookingAnswering(t.subtasks ?? [], wait, live);
    if (!booking) continue;
    if (await stepsOnClientBooked(t.id, wait.id, booking.start).catch(() => false)) finished++;
  }
  return finished;
}

/** The same, from a GoHighLevel contact id (the webhook and the app's booking). */
export async function bookingClosesRequestsFor(ghlContactId: string, bookings: Booking[]): Promise<number> {
  const { data: contact } = await supabaseAdmin.from("contacts").select("id, name, client_id").eq("ghl_contact_id", ghlContactId).maybeSingle();
  if (!contact) return 0;
  const c = contact as { id: string; name: string; client_id: string };
  c.client_id = await resolveOrPromoteTrackedClient(c);
  return bookingClosesRequests(c, bookings);
}

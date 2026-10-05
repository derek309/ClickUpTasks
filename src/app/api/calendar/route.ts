import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { listEvents, bookingLinks } from "@/lib/calendarService";
import { contactHome } from "@/lib/ghlPerson";

// The calendar view (Derek, 2026-10-05): the next two weeks for everyone with
// a GoHighLevel calendar, read live, plus each person's booking links. Read
// only: nothing is booked, stored or changed here.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = { id: caller.id, memberId: caller.memberId };
  // ?links=1: only the booking links, for the email boxes' Booking link menu.
  if (req.nextUrl.searchParams.get("links") === "1") {
    let links = await bookingLinks(actor);
    // ?contact=<GoHighLevel id>: only calendars in that contact's sub-account,
    // the ones they can be booked on.
    const contact = req.nextUrl.searchParams.get("contact");
    if (contact) {
      const home = await contactHome(contact);
      links = home ? links.filter((l) => l.locationId === home.locationId) : [];
    }
    return NextResponse.json({ links }, { headers: { "Cache-Control": "no-store" } });
  }
  const days = Number(req.nextUrl.searchParams.get("days")) || 14;
  const [{ people, events, errors }, links] = await Promise.all([listEvents(actor, { days, fresh: req.nextUrl.searchParams.get("fresh") === "1" }), bookingLinks(actor)]);
  return NextResponse.json({ people, events, links, ...(errors.length ? { errors } : {}) }, { headers: { "Cache-Control": "no-store" } });
}

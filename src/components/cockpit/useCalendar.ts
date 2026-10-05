"use client";

// The calendar view's data (Derek, 2026-10-05): the next two weeks for Derek
// and Justin, read live from GoHighLevel through api/calendar, plus everyone's
// booking links. Read only. Refreshes every two minutes while the tab shows.
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";

export type CalendarPerson = { memberId: string; name: string; ghlUserId: string };
export type CalendarEvent = {
  id: string; start: string; end: string; title: string; people: string[];
  calendarId: string | null; calendarName: string | null; ghlContactId: string | null; clientId: string | null; contactName: string | null;
  joinUrl: string | null; busy: boolean;
};
export type BookingLink = { memberId: string; label: string; url: string; shared: boolean; calendarId: string; locationId: string; minutes: number; locationName: string };

export function useCalendar() {
  const [people, setPeople] = useState<CalendarPerson[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // fresh skips the server's one minute cache: after a change, and on ↻.
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await authedFetch(`/api/calendar?days=14${fresh ? "&fresh=1" : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Couldn't read the calendars.");
      setPeople(j.people ?? []); setEvents(j.events ?? []); setLinks(j.links ?? []);
      setError(j.errors?.length ? "Part of GoHighLevel didn't answer. What's here may be missing something." : null);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't read the calendars."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // The first read, then every two minutes while the tab is visible.
    const first = setTimeout(load, 0);
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 120_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [load]);

  return { people, events, links, loading, error, reload: () => load(true) };
}

// Booking links for the composers, read once per session.
let linksOnce: Promise<BookingLink[]> | null = null;
export function loadBookingLinks(): Promise<BookingLink[]> {
  return (linksOnce ??= authedFetch("/api/calendar?links=1").then((r) => (r.ok ? r.json() : null)).then((j) => (j?.links ?? []) as BookingLink[]).catch(() => { linksOnce = null; return []; }));
}

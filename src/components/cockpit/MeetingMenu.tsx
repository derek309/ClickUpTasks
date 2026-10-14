"use client";

// Move or cancel a client's next meeting from their page and from a task
// (Derek, 2026-10-13: "add move and cancel to the client page and task"),
// the same two the Calendar page has in its ⋯ menu.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import type { CalendarEvent } from "./useCalendar";
import { BookAppointment } from "./BookAppointment";

const TZ = "America/Los_Angeles";
export const meetingWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The next month of meetings, read once and shared by every client page and
// task for two minutes (the server caches GoHighLevel for one). A move or a
// cancel reads it again, past the server's cache.
let eventsAt = 0;
let eventsOnce: Promise<CalendarEvent[]> | null = null;
const listeners = new Set<() => void>();
export function loadEvents(fresh = false): Promise<CalendarEvent[]> {
  if (!fresh && eventsOnce && Date.now() - eventsAt < 120_000) return eventsOnce;
  eventsAt = Date.now();
  eventsOnce = authedFetch(`/api/calendar?days=30${fresh ? "&fresh=1" : ""}`).then((r) => (r.ok ? r.json() : null))
    .then((j) => (j?.events ?? []) as CalendarEvent[]).catch(() => { eventsOnce = null; return []; });
  return eventsOnce;
}
function reloadEvents() {
  void loadEvents(true).then(() => listeners.forEach((f) => f()));
}

/** The client's next meeting: undefined while reading, null when none is booked. */
export function useNextMeeting(clientId: string, ghlContactId: string | null): CalendarEvent | null | undefined {
  const [next, setNext] = useState<{ key: string; event: CalendarEvent | null } | null>(null);
  const key = `${clientId}|${ghlContactId ?? ""}`;
  useEffect(() => {
    let live = true;
    const read = () => loadEvents().then((evs) => {
      if (!live) return;
      const now = Date.now();
      const event = evs.filter((e) => !e.busy && e.status !== "cancelled" && (e.clientId === clientId || (!!ghlContactId && e.ghlContactId === ghlContactId)) && Date.parse(e.end) > now)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null;
      setNext({ key, event });
    });
    void read();
    listeners.add(read);
    return () => { live = false; listeners.delete(read); };
  }, [key, clientId, ghlContactId]);
  return next?.key === key ? next.event : undefined;
}

/** Only an upcoming booking on a GoHighLevel calendar can move or be cancelled. */
export const meetingCanChange = (event: CalendarEvent, at: number) => !!event.calendarId && Date.parse(event.start) > at;
export const meetingCantChangeWhy = (event: CalendarEvent) =>
  event.calendarId ? "It has started, so it can't move now." : "Not booked on a GoHighLevel calendar, so move it where it was made.";

/** Cancels it in GoHighLevel, says so, and reads the meetings again. */
export async function cancelMeeting(event: CalendarEvent, first: string, pushToast: (text: string) => void): Promise<boolean> {
  const r = await authedFetch(`/api/calendar/appointment?id=${encodeURIComponent(event.id)}`, { method: "DELETE" }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  pushToast(r?.ok ? `Cancelled: ${event.title}. GoHighLevel tells ${first}.` : j.error ?? "Couldn't cancel it.");
  if (r?.ok) setTimeout(reloadEvents, 1500);
  return !!r?.ok;
}

/** The booking window, moving this meeting to another time. */
export function MoveMeeting({ event, first, meId, pushToast, defaultCalendarId, onSetDefault, onClose }: {
  event: CalendarEvent & { calendarId: string };
  first: string;
  meId: string;
  pushToast: (text: string) => void;
  defaultCalendarId?: string | null;
  onSetDefault?: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <BookAppointment target={{ kind: "move", appointmentId: event.id, calendarId: event.calendarId, name: event.contactName ?? first, title: event.title }}
      meId={meId} defaultCalendarId={defaultCalendarId} onSetDefault={onSetDefault}
      onClose={onClose} onDone={() => setTimeout(reloadEvents, 1500)} pushToast={pushToast} />
  );
}

/** A ⋯ (or the given label) with Move and Cancel for one meeting, and Book when given. */
export function MeetingMenu({ event, first, meId, pushToast, onBook, label, triggerClassName, title, defaultCalendarId, onSetDefault, openNonce = 0 }: {
  event: CalendarEvent;
  first: string;
  meId: string;
  pushToast: (text: string) => void;
  /** Book another meeting, as a third choice (the task page's calendar button). */
  onBook?: () => void;
  label?: React.ReactNode;
  triggerClassName?: string;
  title?: string;
  defaultCalendarId?: string | null;
  onSetDefault?: (id: string | null) => void;
  /** Opens the menu from elsewhere when it changes (the task page's ⋮ menu):
   *  the time it was asked, Date.now() in the click. */
  openNonce?: number;
}) {
  const [open, setOpen] = useState(false);
  // When the menu opened: a meeting that has started by then can't move.
  const [openedAt, setOpenedAt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  // Asked to open from elsewhere: opened as a click on it would.
  const [seenNonce, setSeenNonce] = useState(openNonce);
  if (openNonce !== seenNonce) {
    setSeenNonce(openNonce);
    if (openNonce) { setOpen(true); setOpenedAt(openNonce); }
  }
  const close = () => { setOpen(false); setConfirm(false); };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  const canChange = meetingCanChange(event, openedAt);
  const cancel = async () => {
    setBusy(true);
    await cancelMeeting(event, first, pushToast);
    setBusy(false);
    close();
  };
  const item = "flex w-full items-center rounded-[5px] px-3 py-2 text-left text-[16px] hover:bg-background disabled:opacity-40";
  return (
    <span className="relative shrink-0">
      <button onClick={() => { if (open) close(); else { setOpenedAt(Date.now()); setOpen(true); } }} aria-expanded={open} title={title ?? "Move or cancel"} aria-label={title ?? "Move or cancel the meeting"}
        className={triggerClassName ?? "grid h-9 w-9 place-items-center rounded-[5px] bg-surface text-[18px] text-muted ring-1 ring-[var(--border)] hover:bg-background hover:text-foreground"}>{label ?? "⋯"}</button>
      {open && <>
        <div className="fixed inset-0 z-40" onClick={close} />
        <div className="absolute right-0 top-11 z-50 w-72 rounded-[5px] bg-surface p-1.5 text-foreground shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
          <div className="px-3 pb-1.5 pt-1">
            <b className="block truncate text-[16px]">{event.title}</b>
            <span className="block text-[16px] text-muted">{meetingWhen(event.start)}{event.calendarName ? ` · ${event.calendarName}` : ""}</span>
          </div>
          <div className="my-1 border-t" />
          {confirm ? (
            <div className="flex flex-col gap-2 px-3 py-2 text-[16px]">
              <span className="font-semibold text-danger">Cancel it? GoHighLevel tells {first}.</span>
              <span className="flex gap-2">
                <button onClick={() => void cancel()} disabled={busy} className="h-9 rounded-[5px] bg-danger px-3 font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? "Cancelling…" : "Yes, cancel"}</button>
                <button onClick={() => setConfirm(false)} className="h-9 rounded-[5px] px-3 text-muted ring-1 ring-[var(--border)] hover:bg-background">Keep it</button>
              </span>
            </div>
          ) : <>
            {event.joinUrl && <a href={event.joinUrl} target="_blank" rel="noopener noreferrer" onClick={close} className={item}>Join link</a>}
            <button onClick={() => { close(); setMoving(true); }} disabled={!canChange} className={item}>Move to another time…</button>
            <button onClick={() => setConfirm(true)} disabled={!canChange} className={`${item} text-danger`}>Cancel meeting…</button>
            {!canChange && <span className="block px-3 py-1 text-[16px] text-muted">{meetingCantChangeWhy(event)}</span>}
            {onBook && <>
              <div className="my-1 border-t" />
              <button onClick={() => { close(); onBook(); }} className={item}>Book another meeting</button>
            </>}
          </>}
        </div>
      </>}
      {moving && event.calendarId && (
        <MoveMeeting event={{ ...event, calendarId: event.calendarId }} first={first} meId={meId} pushToast={pushToast}
          defaultCalendarId={defaultCalendarId} onSetDefault={onSetDefault} onClose={() => setMoving(false)} />
      )}
    </span>
  );
}

"use client";

// Book or move an appointment in GoHighLevel (Phase 2, Derek, 2026-10-05):
// pick a calendar, see its open times for the week, tap one, confirm. Booking
// a contact uses only the calendars in their sub-account; moving keeps the
// appointment's own calendar. GoHighLevel sends the confirmations.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { authedFetch } from "@/lib/supabase";
import type { BookingLink } from "./useCalendar";

const TZ = "America/Los_Angeles";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const dayName = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const LAST_KEY = "cul-calendar-last";

export type BookTarget =
  | { kind: "book"; ghlContactId: string; name: string }
  | { kind: "move"; appointmentId: string; calendarId: string; name: string; title: string };

export function BookAppointment({ target, meId, onClose, onDone, pushToast }: {
  target: BookTarget; meId: string; onClose: () => void; onDone: () => void; pushToast: (text: string) => void;
}) {
  const [calendars, setCalendars] = useState<BookingLink[] | null>(null);
  const [calendarId, setCalendarId] = useState<string>(target.kind === "move" ? target.calendarId : "");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The calendars this person can be booked on, yours first, one row each.
  useEffect(() => {
    if (target.kind === "move") return;
    let live = true;
    authedFetch(`/api/calendar?links=1&contact=${encodeURIComponent(target.ghlContactId)}`).then((r) => r.json()).then((j) => {
      if (!live) return;
      const seen = new Set<string>();
      const list = ((j.links ?? []) as BookingLink[])
        .sort((a, b) => Number(b.memberId === meId) - Number(a.memberId === meId) || a.label.localeCompare(b.label))
        .filter((l) => (seen.has(l.calendarId) ? false : (seen.add(l.calendarId), true)));
      setCalendars(list);
      let last = "";
      try { last = localStorage.getItem(LAST_KEY) ?? ""; } catch { /* private window */ }
      setCalendarId((cur) => cur || (list.find((l) => l.calendarId === last) ?? list[0])?.calendarId || "");
    }).catch(() => { if (live) setCalendars([]); });
    return () => { live = false; };
  }, [target, meId]);

  // The open times on the chosen calendar.
  useEffect(() => {
    if (!calendarId) return;
    let live = true;
    authedFetch(`/api/calendar/slots?calendarId=${encodeURIComponent(calendarId)}&days=7`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      if (!r.ok) { setError(j.error ?? "Couldn't read the open times."); setSlots([]); return; }
      setError(null); setSlots(j.slots ?? []); setMinutes(j.minutes ?? 30);
    }).catch(() => { if (live) { setError("Couldn't read the open times."); setSlots([]); } });
    return () => { live = false; };
  }, [calendarId]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots ?? []) m.set(dayKey(s), [...(m.get(dayKey(s)) ?? []), s]);
    return [...m.values()].slice(0, 5);
  }, [slots]);

  const pickCalendar = (id: string) => {
    setCalendarId(id); setSlots(null); setPicked(null);
    try { localStorage.setItem(LAST_KEY, id); } catch { /* private window */ }
  };
  const first = target.name.split(/\s+/)[0] || target.name;
  const confirm = async () => {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const r = target.kind === "book"
        ? await authedFetch("/api/calendar/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calendarId, ghlContactId: target.ghlContactId, start: picked }) })
        : await authedFetch("/api/calendar/appointment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: target.appointmentId, start: picked }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "That didn't work.");
      pushToast(target.kind === "book" ? `Booked ${first} for ${dayName(picked)}, ${timeOf(picked)}` : `Moved to ${dayName(picked)}, ${timeOf(picked)}`);
      onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "That didn't work."); setPicked(null); }
    finally { setBusy(false); }
  };

  const calName = calendars?.find((c) => c.calendarId === calendarId)?.label;
  // At the page's top level, so a panel it opens from can't clip or trap it.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div role="dialog" aria-label={target.kind === "book" ? `Book ${target.name}` : "Move appointment"}
        className="fixed left-1/2 top-20 z-[61] grid max-h-[80vh] w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl bg-surface text-[16px] shadow-2xl ring-1 ring-[var(--border)]">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-bold leading-tight">{target.kind === "book" ? `Book ${target.name}` : `Move: ${target.title}`}</h2>
            <p className="text-muted">{target.kind === "book" ? "Open times from GoHighLevel. They get its usual confirmation." : "Pick a new time on the same calendar. They're told by GoHighLevel."}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-muted hover:bg-background">✕</button>
        </div>
        <div className="grid content-start gap-3 overflow-y-auto px-5 py-4">
          {target.kind === "book" && (
            calendars === null ? <div className="text-muted">Reading the calendars…</div>
              : !calendars.length ? <div className="text-muted">No calendar in their sub-account to book on.</div>
              : (
                <label className="grid gap-1">
                  <span className="font-semibold">Calendar</span>
                  <select value={calendarId} onChange={(e) => pickCalendar(e.target.value)} className="h-10 rounded-md bg-surface px-2 ring-1 ring-[var(--border)]">
                    {calendars.map((c) => <option key={c.calendarId} value={c.calendarId}>{c.label}{c.minutes ? ` (${c.minutes} min)` : ""}</option>)}
                  </select>
                </label>
              )
          )}
          {calendarId && (slots === null ? <div className="text-muted">Finding open times…</div>
            : !byDay.length ? <div className="text-muted">No open times in the next week on this calendar.</div>
            : byDay.map((day) => (
              <div key={day[0]} className="grid gap-1.5">
                <b className="text-[14px] font-extrabold uppercase tracking-wider text-muted">{dayName(day[0])}</b>
                <div className="flex flex-wrap gap-1.5">
                  {day.map((s) => (
                    <button key={s} onClick={() => setPicked(s)}
                      className={`h-9 rounded-md px-3 font-semibold tabular-nums ring-1 ${picked === s ? "bg-accent text-white ring-accent" : "ring-[var(--border)] hover:bg-background"}`}>{timeOf(s)}</button>
                  ))}
                </div>
              </div>
            )))}
          {error && <div className="rounded-md bg-danger-soft px-3 py-2 font-semibold text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-3 border-t px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-muted">{picked ? `${dayName(picked)}, ${timeOf(picked)}, ${minutes} min${calName ? ` · ${calName}` : ""}` : "Pick a time"}</span>
          <button onClick={onClose} className="h-10 rounded-md px-3 font-semibold text-muted hover:bg-background">Cancel</button>
          <button disabled={!picked || busy} onClick={confirm} className="h-10 rounded-md bg-accent px-5 font-bold text-white disabled:opacity-50">{busy ? "Saving…" : target.kind === "book" ? "Book" : "Move"}</button>
        </div>
      </div>
    </>,
    document.body,
  );
}

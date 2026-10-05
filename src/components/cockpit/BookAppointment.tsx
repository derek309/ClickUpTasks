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

/** A date and time typed in Los Angeles, as an instant (same as calendarService's). */
export function pacificToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const guess = Date.parse(`${date}T${time}:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  return new Date(guess - (wall - guess)).toISOString();
}

export type BookTarget =
  | { kind: "book"; ghlContactId: string; name: string }
  | { kind: "move"; appointmentId: string; calendarId: string; name: string; title: string };

export function BookAppointment({ target, meId, onClose, onDone, pushToast, defaultCalendarId, onSetDefault }: {
  target: BookTarget; meId: string; onClose: () => void; onDone: () => void; pushToast: (text: string) => void;
  /** The starred calendar it opens on, and how to star another (saved with Inbox settings). */
  defaultCalendarId?: string | null; onSetDefault?: (id: string | null) => void;
}) {
  const [calendars, setCalendars] = useState<BookingLink[] | null>(null);
  const [calendarId, setCalendarId] = useState<string>(target.kind === "move" ? target.calendarId : "");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Other time (Derek, 2026-10-05): a typed date and time, booked even when it isn't open.
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherDate, setOtherDate] = useState("");
  const [otherTime, setOtherTime] = useState("");
  const custom = otherOpen && !!picked;
  // Share times (Derek, 2026-10-05: "pick the days and times so we can share
  // in an SMS"): tap several open times, copy them as a text with the booking link.
  const [share, setShare] = useState(false);
  // When the window opened: "today" for the labels, read once.
  const [openedAt] = useState(() => Date.now());
  const [picks, setPicks] = useState<string[]>([]);

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
      // The starred calendar, else the last one used, else the first.
      setCalendarId((cur) => cur || (list.find((l) => l.calendarId === defaultCalendarId) ?? list.find((l) => l.calendarId === last) ?? list[0])?.calendarId || "");
    }).catch(() => { if (live) setCalendars([]); });
    return () => { live = false; };
  }, [target, meId]); // eslint-disable-line react-hooks/exhaustive-deps -- the star is read once, on open

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
        ? await authedFetch("/api/calendar/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calendarId, ghlContactId: target.ghlContactId, start: picked, custom }) })
        : await authedFetch("/api/calendar/appointment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: target.appointmentId, start: picked, custom }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "That didn't work.");
      pushToast(target.kind === "book" ? `Booked ${first} for ${dayName(picked)}, ${timeOf(picked)}` : `Moved to ${dayName(picked)}, ${timeOf(picked)}`);
      onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "That didn't work."); setPicked(null); }
    finally { setBusy(false); }
  };

  const calName = calendars?.find((c) => c.calendarId === calendarId)?.label;
  // Quick copy (Derek, 2026-10-05): every open time, or one day's, as a message
  // for a chat or a text, with Today and Tomorrow said that way.
  const dayWord = (iso: string) => {
    const today = new Date(openedAt).toLocaleDateString("en-CA", { timeZone: TZ });
    const tomorrow = new Date(openedAt + 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
    const k = dayKey(iso);
    return k === today ? `Today (${dayName(iso)})` : k === tomorrow ? `Tomorrow (${dayName(iso)})` : dayName(iso);
  };
  const copyDays = async (days: string[][]) => {
    const url = calendars?.find((c) => c.calendarId === calendarId)?.url;
    const text = [`Hi ${first}, here are my open times (Pacific):`, ...days.map((d) => `${dayWord(d[0])}: ${d.map(timeOf).join(", ")}`), url ? `Book one here: ${url}` : "Which works best for you?"].join("\n");
    try { await navigator.clipboard.writeText(text); pushToast("Copied. Paste it in a chat or a text."); }
    catch { window.prompt("Copy this:", text); }
  };
  // The text: their first name, the times on their own lines, and the booking link.
  const copyTimes = async () => {
    const url = calendars?.find((c) => c.calendarId === calendarId)?.url;
    const text = [`Hi ${first}, here are a few times that work for me (Pacific):`, ...picks.map((s) => `${dayName(s)}, ${timeOf(s)}`), url ? `Pick one, or book any open time here: ${url}` : "Which works best for you?"].join("\n");
    try { await navigator.clipboard.writeText(text); pushToast("Copied. Paste it in a text."); onClose(); }
    catch { window.prompt("Copy this:", text); }
  };
  // At the page's top level, so a panel it opens from can't clip or trap it.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div role="dialog" aria-label={target.kind === "book" ? `Book ${target.name}` : "Move appointment"}
        className="fixed left-1/2 top-20 z-[61] grid max-h-[80vh] w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl bg-surface text-[16px] shadow-2xl ring-1 ring-[var(--border)]">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-bold leading-tight">{target.kind === "book" ? `Book ${target.name}` : `Move: ${target.title}`}</h2>
            <p className="text-muted">{target.kind === "book" ? "Open times from GoHighLevel. They get its usual confirmation." : "Pick a new time on the same calendar. They're told by GoHighLevel."}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-muted hover:bg-background">✕</button>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto px-5 py-4">
          {target.kind === "book" && (
            calendars === null ? <div className="text-muted">Reading the calendars…</div>
              : !calendars.length ? <div className="text-muted">No calendar in their sub-account to book on.</div>
              : (
                <label className="grid min-w-0 gap-1">
                  <span className="font-semibold">Calendar</span>
                  <span className="flex min-w-0 gap-2">
                    <select value={calendarId} onChange={(e) => pickCalendar(e.target.value)} className="h-10 min-w-0 flex-1 rounded-md bg-surface px-2 ring-1 ring-[var(--border)]">
                      {calendars.map((c) => <option key={c.calendarId} value={c.calendarId}>{c.calendarId === defaultCalendarId ? "★ " : ""}{c.label}{c.minutes ? ` (${c.minutes} min)` : ""}</option>)}
                    </select>
                    {onSetDefault && calendarId && (
                      <button type="button" onClick={() => { const on = calendarId !== defaultCalendarId; onSetDefault(on ? calendarId : null); pushToast(on ? `${calName} is your default calendar` : "No default calendar"); }}
                        title={calendarId === defaultCalendarId ? "Your default calendar. Click to unstar." : "Make this your default calendar"} aria-pressed={calendarId === defaultCalendarId}
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-md text-[20px] ring-1 ring-[var(--border)] hover:bg-background ${calendarId === defaultCalendarId ? "text-amber-500" : "text-muted"}`}>{calendarId === defaultCalendarId ? "★" : "☆"}</button>
                    )}
                  </span>
                </label>
              )
          )}
          {calendarId && (slots === null ? <div className="text-muted">Finding open times…</div>
            : !byDay.length ? <div className="text-muted">No open times in the next week on this calendar.</div>
            : byDay.map((day) => (
              <div key={day[0]} className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <b className="text-[14px] font-extrabold uppercase tracking-wider text-muted">{dayWord(day[0])}</b>
                  {target.kind === "book" && <button type="button" onClick={() => copyDays([day])} title="Copy this day's times for a message" className="text-[14px] font-semibold text-accent hover:underline">📋 Copy</button>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {day.map((s) => (
                    <button key={s} onClick={() => { if (share) { setPicks((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s].sort())); return; } setOtherOpen(false); setPicked(s); }}
                      className={`h-9 rounded-md px-3 font-semibold tabular-nums ring-1 ${(share ? picks.includes(s) : picked === s) ? (share ? "bg-success text-white ring-success" : "bg-accent text-white ring-accent") : "ring-[var(--border)] hover:bg-background"}`}>{share && picks.includes(s) ? "✓ " : ""}{timeOf(s)}</button>
                  ))}
                </div>
              </div>
            )))}
          {target.kind === "book" && calendarId && byDay.length > 0 && (
            <button type="button" onClick={() => copyDays(byDay)} className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left ring-1 ring-[var(--border)] hover:bg-background">
              <span>📋</span><span className="flex-1"><b className="block font-semibold">Copy all times</b><span className="text-[14px] text-muted">Every open time by day, with your booking link</span></span>
            </button>
          )}
          {target.kind === "book" && calendarId && (
            <button type="button" onClick={() => { setShare(!share); setPicks([]); setPicked(null); setOtherOpen(false); }}
              className={`flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left ring-1 ${share ? "bg-success-soft ring-success" : "ring-[var(--border)] hover:bg-background"}`}>
              <span>{share ? "✓" : "💬"}</span><span className="flex-1"><b className={`block font-semibold ${share ? "text-success" : ""}`}>{share ? "Picking times to text them" : "Pick times to text them"}</b><span className="text-[14px] text-muted">{share ? "Tap the times you can do. Click here to stop." : "Choose a few times, then copy them for a text"}</span></span>
            </button>
          )}
          {!share && calendarId && (otherOpen ? (
            <div className="grid gap-2 rounded-md bg-background p-3">
              <b className="text-[14px] font-extrabold uppercase tracking-wider text-muted">Other time</b>
              <div className="flex flex-wrap gap-2">
                <input type="date" value={otherDate} min={new Date().toLocaleDateString("en-CA", { timeZone: TZ })} onChange={(e) => { setOtherDate(e.target.value); setPicked(pacificToIso(e.target.value, otherTime)); }} aria-label="Date" className="h-10 rounded-md bg-surface px-2 ring-1 ring-[var(--border)]" />
                <input type="time" step={900} value={otherTime} onChange={(e) => { setOtherTime(e.target.value); setPicked(pacificToIso(otherDate, e.target.value)); }} aria-label="Time" className="h-10 rounded-md bg-surface px-2 ring-1 ring-[var(--border)]" />
                <button type="button" onClick={() => { setOtherOpen(false); setPicked(null); }} className="h-10 px-2 font-semibold text-muted hover:text-foreground">Back to open times</button>
              </div>
              <span className="text-muted">Pacific time. Not one of the open times, so it&apos;s booked even if you&apos;re busy then.</span>
            </div>
          ) : (
            <button type="button" onClick={() => { setOtherOpen(true); setPicked(pacificToIso(otherDate, otherTime)); }} className="justify-self-start font-semibold text-accent hover:underline">＋ Other time…</button>
          ))}
          {error && <div className="rounded-md bg-danger-soft px-3 py-2 font-semibold text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-3 border-t px-5 py-3">
          {share ? <>
            <span className="min-w-0 flex-1 truncate text-muted">{picks.length ? `${picks.length} ${picks.length === 1 ? "time" : "times"} picked` : "Tap the times you can do"}</span>
            <button onClick={onClose} className="h-10 rounded-md px-3 font-semibold text-muted hover:bg-background">Cancel</button>
            <button disabled={!picks.length} onClick={copyTimes} className="h-10 rounded-md bg-success px-5 font-bold text-white disabled:opacity-50">Copy for a text</button>
          </> : <>
          <span className="min-w-0 flex-1 truncate text-muted">{picked ? `${dayName(picked)}, ${timeOf(picked)}, ${minutes} min${custom ? " (not an open time)" : ""}${calName ? ` · ${calName}` : ""}` : "Pick a time"}</span>
          <button onClick={onClose} className="h-10 rounded-md px-3 font-semibold text-muted hover:bg-background">Cancel</button>
          <button disabled={!picked || busy} onClick={confirm} className="h-10 rounded-md bg-accent px-5 font-bold text-white disabled:opacity-50">{busy ? "Saving…" : target.kind === "book" ? "Book" : "Move"}</button>
          </>}
        </div>
      </div>
    </>,
    document.body,
  );
}

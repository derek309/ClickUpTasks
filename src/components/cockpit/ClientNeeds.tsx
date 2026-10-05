"use client";

// What needs doing for this client, as the top of their page (Derek,
// 2026-10-05, header mockup C https://claude.ai/artifact/Uti7wovPQfhAeB3jPLHbCh):
// their latest message, what's waiting on them, and their next meeting
// (mockup D: overdue moved beside the name). Each box
// carries the one button that deals with it.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import type { CalendarEvent } from "./useCalendar";
import { timeAgo } from "@/lib/data";

const TZ = "America/Los_Angeles";

// The next two weeks of meetings, read once and shared by every client page
// for two minutes (the server caches GoHighLevel for one).
let eventsAt = 0;
let eventsOnce: Promise<CalendarEvent[]> | null = null;
function loadEvents(): Promise<CalendarEvent[]> {
  if (eventsOnce && Date.now() - eventsAt < 120_000) return eventsOnce;
  eventsAt = Date.now();
  eventsOnce = authedFetch("/api/calendar?days=30").then((r) => (r.ok ? r.json() : null))
    .then((j) => (j?.events ?? []) as CalendarEvent[]).catch(() => { eventsOnce = null; return []; });
  return eventsOnce;
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ClientNeeds({ clientId, ghlContactId, first, lastIn, lastOut, onReply, onEmail, onText, waiting, oldestWaiting, onRemind, canBook, onBook, onRequest }: {
  clientId: string;
  /** Meetings carry the GoHighLevel contact; their clientId is the sub-account. */
  ghlContactId: string | null;
  first: string;
  /** Their latest email or text, and ours (Derek, 2026-10-05, mockup D). */
  lastIn: { at: string; channel: "email" | "sms"; preview: string; unread: boolean } | null;
  lastOut: { at: string; channel: "email" | "sms" } | null;
  onReply: (() => void) | null;
  onEmail: (() => void) | null;
  onText: (() => void) | null;
  waiting: number;
  oldestWaiting: string | null;
  onRemind: (() => void) | null;
  canBook: boolean;
  onBook: () => void;
  /** Ask them to pick a time, by email or text (Derek, 2026-10-05). */
  onRequest: ((channel: "email" | "sms") => void) | null;
}) {
  const [askOpen, setAskOpen] = useState(false);
  // undefined while reading; null when nothing is booked.
  const [next, setNext] = useState<{ clientId: string; event: CalendarEvent | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadEvents().then((evs) => {
      if (!live) return;
      const now = new Date().toISOString();
      const event = evs.filter((e) => !e.busy && (e.clientId === clientId || (!!ghlContactId && e.ghlContactId === ghlContactId)) && e.end > now).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
      setNext({ clientId, event });
    });
    return () => { live = false; };
  }, [clientId, ghlContactId]);
  const meeting = next?.clientId === clientId ? next.event : undefined;

  // Our turn when their latest came after ours.
  const theirTurn = !!lastIn && (!lastOut || lastIn.at > lastOut.at);
  const last = !lastIn ? lastOut : !lastOut ? lastIn : lastIn.at > lastOut.at ? lastIn : lastOut;
  const box = "flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5";
  const btn = "h-9 shrink-0 rounded-md bg-surface px-3 text-[15px] font-semibold ring-1 hover:bg-background";
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {/* Messages: their reply waiting on us, else when we last talked. */}
      <div className={`${box} ${theirTurn ? "bg-accent-soft" : "bg-background"}`}>
        <div className="min-w-0 flex-1">
          <b className={`block ${theirTurn ? "text-accent" : ""}`}>{theirTurn ? `${lastIn!.unread ? "New: " : ""}${first} ${lastIn!.channel === "sms" ? "texted" : "replied"} ${timeAgo(lastIn!.at)}` : last ? `Last ${last.channel === "sms" ? "text" : "email"} ${shortDay(last.at)}` : "No messages yet"}</b>
          <span className="block truncate text-[14px] text-muted">{theirTurn ? lastIn!.preview : last ? (last === lastOut ? "You wrote last" : `${first} wrote last`) : `Say hello to ${first}`}</span>
        </div>
        {theirTurn && onReply ? <button onClick={onReply} title="Answer them" className="h-9 shrink-0 rounded-md bg-accent px-3 text-[15px] font-semibold text-white hover:opacity-90">Reply</button> : <>
          {onEmail && <button onClick={onEmail} className={`${btn} ring-[var(--border)]`}>Email</button>}
          {onText && <button onClick={onText} className={`${btn} ring-[var(--border)]`}>Text</button>}
        </>}
      </div>
      <div className={`${box} ${waiting ? "bg-highlight-soft" : "bg-background"}`}>
        <div className="min-w-0 flex-1">
          <b className={`block ${waiting ? "text-highlight" : ""}`}>{waiting ? `${waiting} waiting on ${first}` : `Nothing waiting on ${first}`}</b>
          <span className="block truncate text-[14px] text-muted">{oldestWaiting ?? "Ball's in our court"}</span>
        </div>
        {waiting > 0 && onRemind && <button onClick={onRemind} title="Email them what we're waiting on, with their page" className={`${btn} ring-highlight/40`}>Remind</button>}
      </div>
      <div className={`${box} bg-background`}>
        <div className="min-w-0 flex-1">
          <b className="block">{meeting === undefined ? "Meetings" : meeting ? "Next meeting" : "No meeting booked"}</b>
          <span className="block truncate text-[14px] text-muted">{meeting === undefined ? "Reading the calendar…" : meeting ? `${when(meeting.start)}${meeting.calendarName ? ` · ${meeting.calendarName}` : ""}` : canBook ? "Book one or ask them to pick" : "Not in GoHighLevel yet"}</span>
        </div>
        {onRequest && (
          <span className="relative shrink-0">
            <button onClick={() => setAskOpen(!askOpen)} aria-expanded={askOpen} title="Ask them to pick a time" className={`${btn} ring-[var(--border)]`}>Request ▾</button>
            {askOpen && <>
              <div className="fixed inset-0 z-40" onClick={() => setAskOpen(false)} />
              <div className="absolute right-0 top-11 z-50 w-56 rounded-lg bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                <button onClick={() => { setAskOpen(false); onRequest("email"); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background"><b className="block font-semibold">Email them</b><span className="text-[14px] text-muted">Three open times and your link</span></button>
                <button onClick={() => { setAskOpen(false); onRequest("sms"); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background"><b className="block font-semibold">Text them</b><span className="text-[14px] text-muted">The same, short enough for a text</span></button>
              </div>
            </>}
          </span>
        )}
        {canBook && <button onClick={onBook} title="Book a time, or pick times to text them" className={`${btn} ring-[var(--border)]`}>Book</button>}
      </div>
    </div>
  );
}

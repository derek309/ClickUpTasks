"use client";

// What needs doing for this client, as the top of their page (Derek,
// 2026-10-05, header mockup C https://claude.ai/artifact/Uti7wovPQfhAeB3jPLHbCh):
// their latest message, what's waiting on them, and their next meeting
// (mockup D: overdue moved beside the name). Each box
// carries the one button that deals with it.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import type { CalendarEvent } from "./useCalendar";
import { htmlToText, timeAgo } from "@/lib/data";
import { fetchClientEmailDraft } from "@/lib/db";

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

/** An unsent email or text for this client, picked from the Drafts button. */
export type ClientDraftItem = { id: string; title: string; where: string; at: string; open: () => void };

export function ClientNeeds({ clientId, ghlContactId, first, lastIn, lastOut, onReply, onEmail, onText, drafts, onOpenClientDraft, composerOpen, waiting, oldestWaiting, onRemind, canBook, onBook, onRequest }: {
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
  /** Drafts on their tasks and Claude's, already in memory. */
  drafts: ClientDraftItem[];
  /** Opens the client's own saved email; null when they can't be emailed. */
  onOpenClientDraft: (() => void) | null;
  /** The client's email window is open: its saved draft is read again when it closes. */
  composerOpen: boolean;
  waiting: number;
  oldestWaiting: string | null;
  onRemind: (() => void) | null;
  canBook: boolean;
  onBook: () => void;
  /** Ask them to pick a time, by email or text (Derek, 2026-10-05). */
  onRequest: ((channel: "email" | "sms") => void) | null;
}) {
  const [askOpen, setAskOpen] = useState(false);
  // Their drafts, here on their page (Derek, 2026-10-07: "bring in the drafted
  // emails and then open, review and send so we don't have to leave"). The
  // client's own saved email is read here; the rest come in as drafts.
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [own, setOwn] = useState<{ clientId: string; item: ClientDraftItem | null } | null>(null);
  useEffect(() => {
    if (composerOpen || !onOpenClientDraft) return;
    let live = true;
    void fetchClientEmailDraft(clientId).then((d) => {
      if (!live) return;
      const has = !!d && (!!d.subject.trim() || !!htmlToText(d.body).trim());
      setOwn({ clientId, item: has ? { id: `client:${clientId}`, title: d!.subject.trim() || "No subject", where: "Email to them", at: d!.updatedAt || d!.createdAt, open: onOpenClientDraft } : null });
    }).catch(() => {});
    return () => { live = false; };
    // onOpenClientDraft is a new function each render; only the client and the window closing matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, composerOpen, !!onOpenClientDraft]);
  const ownItem = own?.clientId === clientId && onOpenClientDraft ? own.item : null;
  const allDrafts = [...(ownItem ? [{ ...ownItem, open: onOpenClientDraft! }] : []), ...drafts].sort((a, b) => b.at.localeCompare(a.at));
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
  // One line each, the button inline: half the height (Derek, 2026-10-08).
  const box = "flex min-w-0 items-center gap-3 rounded-lg px-3 py-1.5";
  const btn = "h-9 shrink-0 rounded-md bg-surface px-3 text-[15px] font-semibold ring-1 hover:bg-background";
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {/* Messages: their reply waiting on us, else when we last talked. */}
      <div className={`${box} ${theirTurn ? "bg-accent-soft" : "bg-background"}`}>
        <div className="min-w-0 flex-1 truncate">
          <b className={`${theirTurn ? "text-accent" : ""}`}>{theirTurn ? `${lastIn!.unread ? "New: " : ""}${first} ${lastIn!.channel === "sms" ? "texted" : "replied"} ${timeAgo(lastIn!.at)}` : last ? `Last ${last.channel === "sms" ? "text" : "email"} ${shortDay(last.at)}` : "No messages yet"}</b>
          <span className="text-[16px] text-muted"> · {theirTurn ? lastIn!.preview : last ? (last === lastOut ? "You wrote last" : `${first} wrote last`) : `Say hello to ${first}`}</span>
        </div>
        {allDrafts.length > 0 && (
          <span className="relative shrink-0">
            <button onClick={() => setDraftsOpen(!draftsOpen)} aria-expanded={draftsOpen} title={`Emails and texts to ${first} not sent yet`}
              className={`${btn} ring-highlight/40`}>Drafts <span className="ml-1 rounded-full bg-highlight px-1.5 text-[14px] text-white">{allDrafts.length}</span></button>
            {draftsOpen && <>
              <div className="fixed inset-0 z-40" onClick={() => setDraftsOpen(false)} />
              <div className="absolute left-0 top-11 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                {allDrafts.map((d) => (
                  <button key={d.id} onClick={() => { setDraftsOpen(false); d.open(); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">
                    <b className="block truncate font-semibold">{d.title}</b>
                    <span className="block truncate text-[16px] text-muted">{d.where} · {shortDay(d.at)}</span>
                  </button>
                ))}
              </div>
            </>}
          </span>
        )}
        {theirTurn && onReply ? <button onClick={onReply} title="Answer them" className="h-9 shrink-0 rounded-md bg-accent px-3 text-[15px] font-semibold text-white hover:opacity-90">Reply</button> : <>
          {onEmail && <button onClick={onEmail} className={`${btn} ring-[var(--border)]`}>Email</button>}
          {onText && <button onClick={onText} className={`${btn} ring-[var(--border)]`}>Text</button>}
        </>}
      </div>
      <div className={`${box} ${waiting ? "bg-highlight-soft" : "bg-background"}`}>
        <div className="min-w-0 flex-1 truncate">
          <b className={`${waiting ? "text-highlight" : ""}`}>{waiting ? `${waiting} waiting on ${first}` : `Nothing waiting on ${first}`}</b>
          <span className="text-[16px] text-muted"> · {oldestWaiting ?? "Ball's in our court"}</span>
        </div>
        {waiting > 0 && onRemind && <button onClick={onRemind} title="Email them what we're waiting on, with their page" className={`${btn} ring-highlight/40`}>Remind</button>}
      </div>
      <div className={`${box} bg-background`}>
        <div className="min-w-0 flex-1 truncate">
          <b>{meeting === undefined ? "Meetings" : meeting ? "Next meeting" : "No meeting booked"}</b>
          <span className="text-[16px] text-muted"> · {meeting === undefined ? "Reading the calendar…" : meeting ? `${when(meeting.start)}${meeting.calendarName ? ` · ${meeting.calendarName}` : ""}` : canBook ? "Book one or ask them to pick" : "Not in GoHighLevel yet"}</span>
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

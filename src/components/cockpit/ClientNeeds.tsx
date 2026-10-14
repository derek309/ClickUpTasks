"use client";

// What needs doing for this client, as the top of their page (Derek,
// 2026-10-05, header mockup C https://claude.ai/artifact/Uti7wovPQfhAeB3jPLHbCh):
// their latest message, what's waiting on them, and their next meeting
// (mockup D: overdue moved beside the name). Each box
// carries the one button that deals with it.
import { useEffect, useState } from "react";
import { MeetingMenu, MoveMeeting, cancelMeeting, meetingCanChange, meetingCantChangeWhy, useNextMeeting } from "./MeetingMenu";
import { htmlToText, timeAgo } from "@/lib/data";
import { fetchClientEmailDraft } from "@/lib/db";

const TZ = "America/Los_Angeles";

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** An unsent email or text for this client, picked from the Drafts button. */
export type ClientDraftItem = { id: string; title: string; where: string; at: string; open: () => void };

export function ClientNeeds({ clientId, ghlContactId, first, lastIn, lastOut, onReply, onEmail, onText, drafts, onOpenClientDraft, composerOpen, waiting, oldestWaiting, onRemind, canBook, onBook, onRequest, onMeetNow, meetingNow, meId, pushToast, defaultCalendarId, onSetDefault }: {
  clientId: string;
  /** Meetings carry the GoHighLevel contact; their clientId is the sub-account. */
  ghlContactId: string | null;
  first: string;
  /** Their latest email or text, and ours (Derek, 2026-10-05, mockup D). */
  lastIn: { at: string; channel: "email" | "sms" | "chat"; preview: string; unread: boolean } | null;
  lastOut: { at: string; channel: "email" | "sms" | "chat" } | null;
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
  /** Start a meeting now and send them the link (Derek, 2026-10-14). */
  onMeetNow?: (() => void) | null;
  /** A meeting started now and still on: Join now opens it. */
  meetingNow?: { url: string; start: string } | null;
  /** For Move and Cancel on their next meeting (Derek, 2026-10-13). */
  meId: string;
  pushToast: (text: string) => void;
  defaultCalendarId?: string | null;
  onSetDefault?: (id: string | null) => void;
}) {
  const [askOpen, setAskOpen] = useState(false);
  // On a phone, the three boxes are one line and one Contact menu (Derek,
  // 2026-10-13); its meeting choices keep their own state so Move's window
  // outlives the menu.
  const [contactOpen, setContactOpen] = useState(false);
  const [contactAt, setContactAt] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [moving, setMoving] = useState(false);
  const closeContact = () => { setContactOpen(false); setConfirmCancel(false); };
  useEffect(() => {
    if (!contactOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setContactOpen(false); setConfirmCancel(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [contactOpen]);
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
  const meeting = useNextMeeting(clientId, ghlContactId);

  // Our turn when their latest came after ours.
  const theirTurn = !!lastIn && (!lastOut || lastIn.at > lastOut.at);
  const last = !lastIn ? lastOut : !lastOut ? lastIn : lastIn.at > lastOut.at ? lastIn : lastOut;
  // One line each, the button inline: half the height (Derek, 2026-10-08).
  const box = "flex min-w-0 items-center gap-3 rounded-lg px-3 py-1.5";
  const btn = "h-9 shrink-0 rounded-md bg-surface px-3 text-[15px] font-semibold ring-1 hover:bg-background";
  // The phone's one line: messages, what's waiting, the meeting.
  const phoneLine: { text: string; tone?: string }[] = [
    theirTurn
      ? { text: `${lastIn!.unread ? "New: " : ""}${first} ${lastIn!.channel === "sms" ? "texted" : lastIn!.channel === "chat" ? "wrote in the portal" : "replied"} ${timeAgo(lastIn!.at)}`, tone: "font-semibold text-accent" }
      : { text: last ? `Last ${last.channel === "sms" ? "text" : last.channel === "chat" ? "chat" : "email"} ${shortDay(last.at)}` : "No messages yet" },
    waiting ? { text: `${waiting} waiting on ${first}`, tone: "font-semibold text-highlight" } : { text: "Ball's in our court" },
    ...(meetingNow ? [{ text: `Meeting now, started ${timeOnly(meetingNow.start)}`, tone: "font-semibold text-accent" }]
      : meeting === undefined ? [] : [{ text: meeting ? `Next meeting ${when(meeting.start)}` : "No meeting booked" }]),
  ];
  const canChange = !!meeting && meetingCanChange(meeting, contactAt);
  const hasContact = !!(onReply || onEmail || onText || onRemind || allDrafts.length || onRequest || onMeetNow || canBook || meeting || meetingNow);
  const item = "block w-full rounded-[5px] px-3 py-2.5 text-left text-[16px] hover:bg-background disabled:opacity-40";
  const pick = (f: () => void) => () => { closeContact(); f(); };
  const section = "px-3 pb-1 pt-2 text-[16px] font-bold";
  return (<>
    <div className="flex items-start gap-3 sm:hidden">
      <p className="min-w-0 flex-1 text-[16px] leading-snug text-muted">
        {phoneLine.map((p, i) => <span key={i}>{i > 0 && " · "}<span className={p.tone}>{p.text}</span></span>)}
      </p>
      {hasContact && (
        <span className="relative shrink-0">
          <button onClick={() => { if (contactOpen) closeContact(); else { setContactAt(Date.now()); setContactOpen(true); } }} aria-expanded={contactOpen}
            className="h-9 shrink-0 rounded-[5px] bg-surface px-3 text-[16px] font-semibold ring-1 ring-[var(--border)] hover:bg-background">Contact{allDrafts.length > 0 && <span className="ml-1.5 rounded-[5px] bg-highlight px-1.5 text-[16px] text-white" title="Drafts not sent yet">{allDrafts.length}</span>}</button>
          {contactOpen && <>
            <div className="fixed inset-0 z-40" onClick={closeContact} />
            {/* A sheet along the bottom of the screen, like Drafts. */}
            <div className="fixed inset-x-3 bottom-3 z-50 max-h-[75vh] overflow-y-auto rounded-[5px] bg-surface p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] text-foreground shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              <div className={section}>Contact {first}</div>
              {theirTurn && onReply && <button onClick={pick(onReply)} className={`${item} font-semibold text-accent`}>Reply</button>}
              {onText && <button onClick={pick(onText)} className={item}>Text</button>}
              {onEmail && <button onClick={pick(onEmail)} className={item}>Email</button>}
              {waiting > 0 && onRemind && <button onClick={pick(onRemind)} className={item}>Remind them what we&apos;re waiting on</button>}
              {allDrafts.length > 0 && <>
                <div className="my-1 border-t" />
                <div className={section}>Drafts not sent</div>
                {allDrafts.map((d) => (
                  <button key={d.id} onClick={pick(d.open)} className={item}>
                    <b className="block truncate font-semibold">{d.title}</b>
                    <span className="block truncate text-muted">{d.where} · {shortDay(d.at)}</span>
                  </button>
                ))}
              </>}
              {(onRequest || onMeetNow || canBook || meeting || meetingNow) && <>
                <div className="my-1 border-t" />
                <div className={section}>{meetingNow ? `Meeting now, started ${timeOnly(meetingNow.start)}` : meeting ? `Next meeting ${when(meeting.start)}` : "Meeting"}</div>
                {meetingNow && <a href={meetingNow.url} target="_blank" rel="noopener noreferrer" onClick={closeContact} className={`${item} font-semibold text-accent`}>Join now</a>}
                {meeting && (confirmCancel ? (
                  <div className="flex flex-col gap-2 px-3 py-2 text-[16px]">
                    <span className="font-semibold text-danger">Cancel it? GoHighLevel tells {first}.</span>
                    <span className="flex gap-2">
                      <button disabled={cancelling} onClick={async () => { setCancelling(true); await cancelMeeting(meeting, first, pushToast); setCancelling(false); closeContact(); }}
                        className="h-9 rounded-[5px] bg-danger px-3 font-semibold text-white hover:opacity-90 disabled:opacity-50">{cancelling ? "Cancelling…" : "Yes, cancel"}</button>
                      <button onClick={() => setConfirmCancel(false)} className="h-9 rounded-[5px] px-3 text-muted ring-1 ring-[var(--border)] hover:bg-background">Keep it</button>
                    </span>
                  </div>
                ) : <>
                  {meeting.joinUrl && <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer" onClick={closeContact} className={item}>Join link</a>}
                  <button onClick={pick(() => setMoving(true))} disabled={!canChange} className={item}>Move to another time…</button>
                  <button onClick={() => setConfirmCancel(true)} disabled={!canChange} className={`${item} text-danger`}>Cancel meeting…</button>
                  {!canChange && <span className="block px-3 py-1 text-[16px] text-muted">{meetingCantChangeWhy(meeting)}</span>}
                </>)}
                {!meetingNow && onMeetNow && <button onClick={pick(onMeetNow)} className={item}><b className="block font-semibold">Start a meeting now</b><span className="text-muted">A link to join, sent now</span></button>}
                {!meetingNow && onRequest && <>
                  <button onClick={pick(() => onRequest("email"))} className={item}><b className="block font-semibold">Request a meeting by email</b><span className="text-muted">Three open times and your link</span></button>
                  <button onClick={pick(() => onRequest("sms"))} className={item}><b className="block font-semibold">Request a meeting by text</b><span className="text-muted">The same, short enough for a text</span></button>
                </>}
                {canBook && <button onClick={pick(onBook)} className={item}>{meeting ? "Book another meeting" : "Book a meeting"}</button>}
              </>}
            </div>
          </>}
        </span>
      )}
      {moving && meeting?.calendarId && (
        <MoveMeeting event={{ ...meeting, calendarId: meeting.calendarId }} first={first} meId={meId} pushToast={pushToast}
          defaultCalendarId={defaultCalendarId} onSetDefault={onSetDefault} onClose={() => setMoving(false)} />
      )}
    </div>
    <div className="hidden gap-2.5 sm:grid sm:grid-cols-3">
      {/* Messages: their reply waiting on us, else when we last talked. */}
      <div className={`${box} ${theirTurn ? "bg-accent-soft" : "bg-background"}`}>
        <div className="min-w-0 flex-1 truncate">
          <b className={`${theirTurn ? "text-accent" : ""}`}>{theirTurn ? `${lastIn!.unread ? "New: " : ""}${first} ${lastIn!.channel === "sms" ? "texted" : lastIn!.channel === "chat" ? "wrote in the portal" : "replied"} ${timeAgo(lastIn!.at)}` : last ? `Last ${last.channel === "sms" ? "text" : last.channel === "chat" ? "chat" : "email"} ${shortDay(last.at)}` : "No messages yet"}</b>
          <span className="text-[16px] text-muted"> · {theirTurn ? lastIn!.preview : last ? (last === lastOut ? "You wrote last" : `${first} wrote last`) : `Say hello to ${first}`}</span>
        </div>
        {allDrafts.length > 0 && (
          <span className="relative shrink-0">
            <button onClick={() => setDraftsOpen(!draftsOpen)} aria-expanded={draftsOpen} title={`Emails and texts to ${first} not sent yet`}
              className={`${btn} ring-highlight/40`}>Drafts <span className="ml-1 rounded-[5px] bg-highlight px-1.5 text-[16px] text-white">{allDrafts.length}</span></button>
            {draftsOpen && <>
              <div className="fixed inset-0 z-40" onClick={() => setDraftsOpen(false)} />
              {/* On a phone, a sheet along the bottom of the screen: opened from
                  the button it ran off the right edge (Derek, 2026-10-13). */}
              <div className="fixed inset-x-3 bottom-3 z-50 max-h-[60vh] overflow-y-auto rounded-[5px] bg-surface p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] shadow-[var(--shadow-md)] ring-1 ring-[var(--border)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-11 sm:w-80 sm:pb-1.5">
                <div className="px-3 pb-1 pt-1 text-[16px] font-bold sm:hidden">Drafts to {first}</div>
                {allDrafts.map((d) => (
                  <button key={d.id} onClick={() => { setDraftsOpen(false); d.open(); }} className="block w-full rounded-[5px] px-3 py-2.5 text-left hover:bg-background">
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
          {meetingNow ? <>
            <b className="text-accent">Meeting now</b>
            <span className="text-[16px] text-muted"> · started {timeOnly(meetingNow.start)}</span>
          </> : <>
          <b>{meeting === undefined ? "Meetings" : meeting ? "Next meeting" : "No meeting booked"}</b>
          <span className="text-[16px] text-muted"> · {meeting === undefined ? "Reading the calendar…" : meeting ? `${when(meeting.start)}${meeting.calendarName ? ` · ${meeting.calendarName}` : ""}` : canBook ? "Book one or ask them to pick" : "Not in GoHighLevel yet"}</span>
          </>}
        </div>
        {meetingNow && <a href={meetingNow.url} target="_blank" rel="noopener noreferrer" title="Open the meeting" className={`${btn} inline-flex items-center text-accent ring-accent/40`}>Join now</a>}
        {/* Meeting now: Join now in its place, nothing more to ask for. */}
        {!meetingNow && (onRequest || onMeetNow) && (
          <span className="relative shrink-0">
            <button onClick={() => setAskOpen(!askOpen)} aria-expanded={askOpen} title="Ask them to pick a time" className={`${btn} ring-[var(--border)]`}>Request ▾</button>
            {askOpen && <>
              <div className="fixed inset-0 z-40" onClick={() => setAskOpen(false)} />
              <div className="absolute right-0 top-11 z-50 w-64 rounded-[5px] bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                {onRequest && <>
                  <button onClick={() => { setAskOpen(false); onRequest("email"); }} className="block w-full rounded-[5px] px-3 py-2 text-left hover:bg-background"><b className="block font-semibold">Email them</b><span className="text-[16px] text-muted">Three open times and your link</span></button>
                  <button onClick={() => { setAskOpen(false); onRequest("sms"); }} className="block w-full rounded-[5px] px-3 py-2 text-left hover:bg-background"><b className="block font-semibold">Text them</b><span className="text-[16px] text-muted">The same, short enough for a text</span></button>
                </>}
                {onMeetNow && <button onClick={() => { setAskOpen(false); onMeetNow(); }} className="block w-full rounded-[5px] px-3 py-2 text-left hover:bg-background"><b className="block font-semibold">Start a meeting now</b><span className="text-[16px] text-muted">A link to join, sent now</span></button>}
              </div>
            </>}
          </span>
        )}
        {meeting && <MeetingMenu event={meeting} first={first} meId={meId} pushToast={pushToast} defaultCalendarId={defaultCalendarId} onSetDefault={onSetDefault} />}
        {canBook && <button onClick={onBook} title="Book a time, or pick times to text them" className={`${btn} ring-[var(--border)]`}>Book</button>}
      </div>
    </div>
  </>);
}

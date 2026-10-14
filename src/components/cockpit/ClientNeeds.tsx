"use client";

// The top of a client's page: three answers, each with the one button that
// deals with it (Derek, 2026-10-14, client header mockup
// "client-header-mockup.html"). What was said (the Conversation, which opens
// the feed beside the list), what's waiting on them (Remind), and meetings
// (one Meet ▾). Three cards side by side on a desktop, three slim one line
// rows on a tablet (and beside an open Conversation), three two line rows on
// a phone. Replaces the Last text /
// Email / Text / Drafts box and the phone's Contact sheet: every action they
// had is in the Conversation feed or under Meet ▾.
import { useEffect, useState } from "react";
import { MoveMeeting, cancelMeeting, meetingCanChange, meetingCantChangeWhy, useNextMeeting } from "./MeetingMenu";
import { loadBookingLinks } from "./useCalendar";

const TZ = "America/Los_Angeles";
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Title and one line under it: two lines as a card and on a phone, one line
 *  (title · line) in a slim row. By the strip's own width, not the window's,
 *  so the cards turn into rows when the Conversation opens beside the list. */
function Answer({ title, line, tone }: { title: string; line: string; tone?: string }) {
  return (
    <span className="block min-w-0 flex-1 text-left @md:truncate @4xl:whitespace-normal">
      <b className={`block truncate text-[16px] @md:inline @4xl:block ${tone ?? ""}`}>{title}</b>
      {line && <span className="hidden text-[16px] text-muted @md:inline @4xl:hidden"> · </span>}
      <span className="block truncate text-[16px] text-muted @md:inline @4xl:block">{line || " "}</span>
    </span>
  );
}

export function ClientNeeds({ clientId, ghlContactId, first, newest, draftCount, feedOpen, onToggleFeed, waiting, oldestWaiting, onRemind, canBook, onBook, requestChannels, onRequest, onMeetNow, meetingNow, meId, pushToast, defaultCalendarId, onSetDefault }: {
  clientId: string;
  /** Meetings carry the GoHighLevel contact; their clientId is the sub-account. */
  ghlContactId: string | null;
  first: string;
  /** The newest email, text or chat, as one line (lib/clientConversation newestLine). */
  newest: { text: string; theirs: boolean; unread: boolean } | null;
  /** Drafts not sent yet, in the feed. */
  draftCount: number;
  feedOpen: boolean;
  onToggleFeed: () => void;
  waiting: number;
  oldestWaiting: string | null;
  /** Writes the reminder as a draft in the feed. */
  onRemind: (() => void) | null;
  canBook: boolean;
  onBook: () => void;
  /** The ways they can be asked to pick a time: email, text, or both. */
  requestChannels: ("email" | "sms")[];
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
  // undefined while reading (the line stays empty until it is ready); null when nothing is booked.
  const meeting = useNextMeeting(clientId, ghlContactId);
  const [meetOpen, setMeetOpen] = useState(false);
  // When the menu opened: a meeting that has started by then can't move.
  const [openedAt, setOpenedAt] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Move's booking window outlives the menu.
  const [moving, setMoving] = useState(false);
  const closeMeet = () => { setMeetOpen(false); setConfirmCancel(false); };
  useEffect(() => {
    if (!meetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMeetOpen(false); setConfirmCancel(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [meetOpen]);
  const canChange = !!meeting && meetingCanChange(meeting, openedAt);
  const pick = (f: () => void) => () => { closeMeet(); f(); };
  // Your own booking page, the one Request a time offers: your default
  // calendar, else yours, else the first.
  const copyBookingLink = async () => {
    const links = await loadBookingLinks();
    const l = links.find((x) => x.calendarId === defaultCalendarId) ?? links.find((x) => x.memberId === meId) ?? links[0];
    if (!l) { pushToast("No booking page found in GoHighLevel."); return; }
    try { await navigator.clipboard.writeText(l.url); pushToast(`Copied your booking link (${l.label})`); }
    catch { pushToast(`Your booking link: ${l.url}`); }
  };

  const cell = "flex min-w-0 items-center gap-3 rounded-[5px] px-3 py-2";
  const btn = "h-9 shrink-0 rounded-[5px] bg-surface px-3 text-[16px] font-semibold ring-1 ring-[var(--border)] hover:bg-background";
  const item = "block w-full rounded-[5px] px-3 py-2.5 text-left text-[16px] hover:bg-background disabled:opacity-40";
  const hasMeet = !!(meetingNow || meeting || onMeetNow || onRequest || canBook);
  const meetLine = meetingNow ? `Started ${timeOnly(meetingNow.start)}` : meeting === undefined ? "" : meeting ? `Next: ${when(meeting.start)}` : "None booked";
  return (
    <div className="@container">
    <div className="grid gap-2 @4xl:grid-cols-[1.6fr_1fr_1fr] @4xl:gap-2.5">
      {/* What was said: the newest message, and the feed beside the list. */}
      <button onClick={onToggleFeed} aria-expanded={feedOpen} title={feedOpen ? "Close the conversation" : `Emails, texts and chats with ${first}`}
        className={`${cell} text-left ${newest?.unread ? "bg-accent-soft" : "bg-background"} ${feedOpen ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-[var(--border)]"}`}>
        <Answer title={`Conversation${draftCount ? ` · ${draftCount} draft${draftCount === 1 ? "" : "s"}` : ""}`}
          line={newest ? `${newest.unread ? "New: " : ""}${newest.text}` : `Nothing yet. Say hello to ${first}`}
          tone={newest?.unread ? "text-accent" : undefined} />
        <span className="shrink-0 text-[16px] font-semibold text-accent">{feedOpen ? "Close ›" : "Open ›"}</span>
      </button>

      <div className={`${cell} ${waiting ? "bg-highlight-soft" : "bg-background"}`}>
        <Answer title={waiting ? `${waiting} waiting on ${first}` : `Nothing waiting on ${first}`} line={oldestWaiting ?? "Ball's in our court"} tone={waiting ? "text-highlight" : undefined} />
        {waiting > 0 && onRemind && <button onClick={onRemind} title="Writes the reminder as a draft in the conversation, to read and send" className={btn}>Remind</button>}
      </div>

      <div className={`${cell} bg-background`}>
        <Answer title={meetingNow ? "Meeting now" : "Meetings"} line={meetLine} tone={meetingNow ? "text-accent" : undefined} />
        {hasMeet && (
          <span className="relative shrink-0">
            <button onClick={() => { if (meetOpen) closeMeet(); else { setOpenedAt(Date.now()); setMeetOpen(true); } }} aria-expanded={meetOpen} className={btn}>Meet ▾</button>
            {meetOpen && <>
              <div className="fixed inset-0 z-40" onClick={closeMeet} />
              {/* A sheet along the bottom on a phone, a menu under the button elsewhere. */}
              <div className="fixed inset-x-3 bottom-3 z-50 max-h-[75vh] overflow-y-auto rounded-[5px] bg-surface p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] text-foreground shadow-[var(--shadow-md)] ring-1 ring-[var(--border)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-11 sm:w-80 sm:pb-1.5">
                <div className="px-3 pb-1 pt-2 text-[16px] font-bold sm:hidden">Meet with {first}</div>
                {meetingNow && <a href={meetingNow.url} target="_blank" rel="noopener noreferrer" onClick={closeMeet} className={`${item} font-semibold text-accent`}>Join now<span className="block font-normal text-muted">Started {timeOnly(meetingNow.start)}</span></a>}
                {!meetingNow && onMeetNow && <button onClick={pick(onMeetNow)} className={item}><b className="block font-semibold">Start a meeting now</b><span className="text-muted">A link to join, sent now</span></button>}
                {!meetingNow && onRequest && requestChannels.length > 0 && (
                  <div className="rounded-[5px] px-3 py-2.5 text-[16px]">
                    <b className="block font-semibold">Request a time</b>
                    <span className="block text-muted">Three open times and your link, to check before it goes</span>
                    <span className="mt-1.5 flex gap-2">
                      {requestChannels.map((ch) => (
                        <button key={ch} onClick={pick(() => onRequest(ch))} className={btn}>{ch === "email" ? "By email" : "By text"}</button>
                      ))}
                    </span>
                  </div>
                )}
                {canBook && <button onClick={pick(onBook)} className={item}><b className="block font-semibold">{meeting ? "Book another" : "Book it"}</b><span className="text-muted">Pick the time yourself</span></button>}
                {meeting && <>
                  <div className="my-1 border-t" />
                  <div className="px-3 pt-1.5 text-[16px]">
                    <b className="block font-semibold">{when(meeting.start)}</b>
                    <span className="block truncate text-muted">{meeting.title}{meeting.calendarName ? ` · ${meeting.calendarName}` : ""}</span>
                  </div>
                  {confirmCancel ? (
                    <div className="flex flex-col gap-2 px-3 py-2 text-[16px]">
                      <span className="font-semibold text-danger">Cancel it? GoHighLevel tells {first}.</span>
                      <span className="flex gap-2">
                        <button disabled={cancelling} onClick={async () => { setCancelling(true); await cancelMeeting(meeting, first, pushToast); setCancelling(false); closeMeet(); }}
                          className="h-9 rounded-[5px] bg-danger px-3 font-semibold text-white hover:opacity-90 disabled:opacity-50">{cancelling ? "Cancelling…" : "Yes, cancel"}</button>
                        <button onClick={() => setConfirmCancel(false)} className="h-9 rounded-[5px] px-3 text-muted ring-1 ring-[var(--border)] hover:bg-background">Keep it</button>
                      </span>
                    </div>
                  ) : <>
                    <span className="flex flex-wrap gap-2 px-3 py-2">
                      {meeting.joinUrl && <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer" onClick={closeMeet} className={`${btn} inline-flex items-center text-accent`}>Join</a>}
                      <button onClick={pick(() => setMoving(true))} disabled={!canChange} className={`${btn} disabled:opacity-40`}>Move</button>
                      <button onClick={() => setConfirmCancel(true)} disabled={!canChange} className={`${btn} text-danger disabled:opacity-40`}>Cancel</button>
                    </span>
                    {!canChange && <span className="block px-3 pb-1 text-[16px] text-muted">{meetingCantChangeWhy(meeting)}</span>}
                  </>}
                </>}
                <div className="my-1 border-t" />
                <button onClick={pick(() => void copyBookingLink())} className={item}><b className="block font-semibold">Copy my booking link</b></button>
              </div>
            </>}
          </span>
        )}
        {moving && meeting?.calendarId && (
          <MoveMeeting event={{ ...meeting, calendarId: meeting.calendarId }} first={first} meId={meId} pushToast={pushToast}
            defaultCalendarId={defaultCalendarId} onSetDefault={onSetDefault} onClose={() => setMoving(false)} />
        )}
      </div>
    </div>
    </div>
  );
}

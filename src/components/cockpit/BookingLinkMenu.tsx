"use client";

import { useState } from "react";
import { loadBookingLinks, type BookingLink } from "./useCalendar";

// 📅 Booking link (Derek, 2026-10-05): a GoHighLevel booking page, put in the
// email as clickable words. Yours first, then the shared ones, then the rest.
export function BookingLinkMenu({ me, onPick, label = "Booking link", up = true, icon = "📅", title = "Put a booking link in the email", hidden = [], starred = [], inline = false }: { me: string; onPick: (l: BookingLink) => void; label?: string; up?: boolean; icon?: string; title?: string; hidden?: string[]; starred?: string[]; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  // The ones hidden on the Calendar wait behind More (Derek, 2026-10-05).
  const [more, setMore] = useState(false);
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const toggle = () => { setOpen(!open); if (!open && links === null) loadBookingLinks().then(setLinks); };
  const sorted = [...(links ?? [])].sort((a, b) => Number(starred.includes(b.calendarId)) - Number(starred.includes(a.calendarId)) || Number(b.memberId === me) - Number(a.memberId === me) || Number(a.shared) - Number(b.shared));
  const seen = new Set<string>();
  const all = sorted.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
  const shownList = all.filter((l) => !hidden.includes(l.calendarId));
  const moreCount = all.length - shownList.length;
  const list = more || !shownList.length ? all : shownList;
  return (
    <div className="relative">
      <button onClick={toggle} title={title} aria-expanded={open} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">{icon}<span className="hidden sm:inline"> {label}</span>{inline && <span className="text-muted"> {open ? "▴" : "▾"}</span>}</button>
      {open && <>
        {/* inline (Derek, 2026-10-05): opens down the side column, full
            height, instead of a small scrolling popup. */}
        {!inline && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
        <div className={inline ? "mt-2 rounded-lg bg-surface p-1.5 ring-1 ring-[var(--border)]" : `absolute ${up ? "bottom-12" : "top-12"} left-0 z-50 max-h-80 w-[min(20rem,80vw)] overflow-y-auto rounded-lg bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]`}>
          {links === null ? <div className="px-3 py-2 text-muted">Reading GoHighLevel…</div>
            : list.length ? list.map((l) => (
              <button key={l.url} onClick={() => { setOpen(false); onPick(l); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">
                <b className="block truncate font-semibold">{l.label}</b>
                <span className="text-[14px] text-muted">{l.shared ? "Shared booking page" : l.memberId === me ? "Your booking page" : "Booking page"}</span>
              </button>
            )) : <div className="px-3 py-2 text-muted">No booking pages found.</div>}
          {links !== null && moreCount > 0 && shownList.length > 0 && (
            <button onClick={() => setMore(!more)} className="w-full rounded-md px-3 py-1.5 text-left font-semibold text-muted hover:bg-background">{more ? "▴ Fewer" : `▸ More (${moreCount})`}</button>
          )}
        </div>
      </>}
    </div>
  );
}


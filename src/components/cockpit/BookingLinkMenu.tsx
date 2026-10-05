"use client";

import { useState } from "react";
import { loadBookingLinks, type BookingLink } from "./useCalendar";

// 📅 Booking link (Derek, 2026-10-05): a GoHighLevel booking page, put in the
// email as clickable words. Yours first, then the shared ones, then the rest.
export function BookingLinkMenu({ me, onPick, label = "Booking link", up = true }: { me: string; onPick: (l: BookingLink) => void; label?: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const toggle = () => { setOpen(!open); if (!open && links === null) loadBookingLinks().then(setLinks); };
  const sorted = [...(links ?? [])].sort((a, b) => Number(b.memberId === me) - Number(a.memberId === me) || Number(a.shared) - Number(b.shared));
  const seen = new Set<string>();
  const list = sorted.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
  return (
    <div className="relative">
      <button onClick={toggle} title="Put a booking link in the email" className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">📅<span className="hidden sm:inline"> {label}</span></button>
      {open && <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className={`absolute ${up ? "bottom-12" : "top-12"} left-0 z-50 max-h-80 w-[min(20rem,80vw)] overflow-y-auto rounded-lg bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]`}>
          {links === null ? <div className="px-3 py-2 text-muted">Reading GoHighLevel…</div>
            : list.length ? list.map((l) => (
              <button key={l.url} onClick={() => { setOpen(false); onPick(l); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">
                <b className="block truncate font-semibold">{l.label}</b>
                <span className="text-[14px] text-muted">{l.shared ? "Shared booking page" : l.memberId === me ? "Your booking page" : "Booking page"}</span>
              </button>
            )) : <div className="px-3 py-2 text-muted">No booking pages found.</div>}
        </div>
      </>}
    </div>
  );
}


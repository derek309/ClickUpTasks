"use client";

// One control for "I reached out to this business," shared by every surface
// that shows a directory listing (the Territory Dashboard's prospect rows
// today, the Businesses page next). Writes through /api/directory/activity to
// WordPress /sales, which is the pipeline's source of truth — so a touch
// logged here lands in the field tool's activity log too, instead of this app
// keeping a second private history that quietly disagrees with it.
//
// Every outreach touch REQUIRES a follow-up interval, and that's the whole
// point of the control rather than an incidental field on it: an untimed
// touch is exactly how a business goes quiet for a month with nobody
// noticing, and the follow-up date is the single thing the dashboard reads to
// decide when to put them back in front of a rep. "Not interested" is the one
// outcome that clears the follow-up instead of setting one, so a hard no
// stops resurfacing forever.
//
// Called/Emailed/SMS'd double as real tel:/mailto:/sms: links — picking one
// both fires the actual dial/compose AND selects that outcome for logging,
// one click instead of "do the thing, then separately go log that you did
// it." Visited and Appointment have no digital action to trigger, so they're
// plain selects. A separate "just change the date" path exists alongside the
// outcome flow for rescheduling without claiming a new touch happened — the
// WordPress endpoint already accepts followup_days with no outcome, this
// just exposes that from the UI instead of forcing an outcome pick first.
import { useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { I } from "./ui";

// WP's own outcome keys AND labels (cul_sales_outcomes in sales-tool.php),
// reused verbatim rather than reworded. A touch logged here renders in the
// /sales activity log using WP's label, so choosing nicer words for the same
// key is precisely how one event ends up described two different ways in the
// two front ends. "presented" is WP's own key for what it labels
// "Appointment" — kept as presented here so a touch logged from this app
// lands in the same bucket WP's own field tool already uses for a booked
// meeting, not a lookalike fifth outcome that never rolls up together.
const OUTCOMES = [
  { key: "called", label: "Called" },
  { key: "emailed", label: "Emailed" },
  { key: "sms", label: "SMS'd" },
  { key: "visited", label: "Visited" },
  { key: "presented", label: "Appointment" },
] as const;
export type OutcomeKey = (typeof OUTCOMES)[number]["key"];
const LINKABLE: Partial<Record<OutcomeKey, "tel" | "mailto" | "sms" | "booking">> = { called: "tel", emailed: "mailto", sms: "sms", presented: "booking" };

const FOLLOW_UPS = [
  { days: 2, label: "In 2 days" },
  { days: 5, label: "In 5 days" },
  { days: 14, label: "In 2 weeks" },
] as const;

const LOST_KEY = "lost";

/** The subset of the updated listing /api/directory/activity echoes back, so
 * a caller can patch its own row in place instead of refetching the city. */
export type TouchResult = {
  outcome: string;
  outcomeLabel: string;
  nextAction: string;
  nextActionLabel: string;
  followupDue: number;
  lastTouched: number;
};

/** Shared button styling for the pick-one rows, so outcome/timing/reschedule
 * chips all read as the same kind of control at the same size instead of
 * drifting apart. Fixed min-width keeps them on a tidy grid when they wrap. */
const chip = (selected: boolean) =>
  `min-w-[104px] rounded-lg border px-3 py-2 text-[16px] font-medium transition-colors disabled:opacity-40 ${
    selected
      ? "border-accent bg-accent text-white"
      : "border-[color:var(--border)] text-foreground hover:border-accent hover:bg-accent-soft hover:text-accent"
  }`;

// today + n days as an <input type="date"> value (local time, not UTC — a
// rep picking "tomorrow" at 11pm shouldn't land on the day after because the
// UTC date had already rolled over).
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TouchPanel({ listingId, phone, email, bookingUrl, initialOutcome, onLogged, onCancel }: {
  listingId: number | string;
  // Only what's needed to make Called/Emailed/Appointment real links —
  // absent for a listing WordPress never got that contact detail for (or,
  // for bookingUrl, a city with no interview calendar set up yet), in which
  // case that outcome falls back to a plain (non-linking) select, same as
  // Visited.
  phone?: string | null;
  email?: string | null;
  bookingUrl?: string | null;
  // Lets a caller open the panel pre-selected on a specific outcome — the
  // row-level Call Now/Send Email/Send SMS/Book Meeting buttons are
  // themselves the real tel:/mailto:/sms:/booking links, and pass this so
  // the panel opens straight to "add a note, pick a follow-up" instead of
  // making the rep pick the same outcome a second time inside the panel.
  // Still fully editable from there — this only sets the starting point.
  initialOutcome?: OutcomeKey;
  onLogged: (result: TouchResult) => void;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<OutcomeKey | null>(initialOutcome ?? null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [customDate, setCustomDate] = useState(() => daysFromToday(7));

  // followupDays null means "clear any scheduled follow-up" (the Not
  // interested path); a number schedules one that many days out. The date
  // itself is computed by WordPress from the interval, never sent from here,
  // so the two front ends can't disagree about what "in N days" resolves to.
  // chosenOutcome null means "don't touch the outcome, only the date" — the
  // reschedule-only path; WP's own route already no-ops outcome when it's
  // omitted, so this needed no server change.
  const save = async (chosenOutcome: string | null, followupDays: number | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch("/api/directory/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: String(listingId),
          ...(chosenOutcome ? { outcome: chosenOutcome } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(followupDays === null ? { clearFollowup: true } : { followupDays }),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Couldn't save that (${res.status}).`);
      onLogged(j.listing as TouchResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Try again.");
      setSaving(false);
    }
  };

  const pick = (key: OutcomeKey) => { setOutcome(key); setRescheduleOpen(false); };

  return (
    <div className="mt-2 w-full rounded-xl border bg-background p-3 sm:max-w-xl">
      {error && (
        <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[16px]">
          <span className="flex-1 text-danger">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-medium text-muted hover:text-foreground">Dismiss</button>
        </div>
      )}

      {!rescheduleOpen && (
        <>
          <div className="mb-1.5 text-[16px] font-semibold">What did you do?</div>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => {
              const linkKind = LINKABLE[o.key];
              // called/emailed/sms/presented only get a real link when we
              // actually have that contact detail (or, for presented, a
              // booking calendar for this city) — otherwise falling back to
              // a plain select keeps the button usable instead of a dead link.
              const href = linkKind === "tel" && phone ? `tel:${phone}`
                : linkKind === "mailto" && email ? `mailto:${email}`
                : linkKind === "sms" && phone ? `sms:${phone}`
                : linkKind === "booking" && bookingUrl ? bookingUrl
                : null;
              const cls = chip(outcome === o.key);
              const openText = linkKind === "tel" ? "your phone app" : linkKind === "sms" ? "your messages app" : linkKind === "mailto" ? "your email app" : "the booking page";
              return href ? (
                <a key={o.key} href={href} onClick={() => pick(o.key)}
                  {...(linkKind === "booking" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  title={`${o.label} — opens ${openText} and marks this as ${o.label.toLowerCase()}`}
                  className={`${cls} inline-flex items-center gap-1.5 ${saving ? "pointer-events-none" : ""}`} aria-disabled={saving}>
                  <I.phone className="h-3.5 w-3.5" /> {o.label}
                </a>
              ) : (
                <button key={o.key} onClick={() => pick(o.key)} disabled={saving} className={cls}>{o.label}</button>
              );
            })}
          </div>

          {outcome && (
            <>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={saving}
                placeholder="Add a note (optional)"
                className="mt-2.5 w-full resize-none rounded-lg border bg-surface px-2.5 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent disabled:opacity-40" />
              <div className="mb-1.5 mt-2.5 text-[16px] font-semibold">When should this come back to you?</div>
              <div className="flex flex-wrap gap-1.5">
                {FOLLOW_UPS.map((f) => (
                  <button key={f.days} onClick={() => save(outcome, f.days)} disabled={saving} className={chip(false)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {rescheduleOpen && (
        <>
          <div className="mb-1.5 text-[16px] font-semibold">Push the follow up date</div>
          <p className="mb-2 text-[16px] text-muted">Doesn&apos;t log a new touch, just moves when this comes back to you.</p>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UPS.map((f) => (
              <button key={f.days} onClick={() => save(null, f.days)} disabled={saving} className={chip(false)}>{f.label}</button>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[16px] text-muted">Or a specific date</span>
            <input type="date" value={customDate} min={daysFromToday(1)} disabled={saving}
              onChange={(e) => setCustomDate(e.target.value)}
              className="rounded-lg border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent disabled:opacity-40" />
            <button disabled={saving || !customDate} onClick={() => {
              const days = Math.max(1, Math.ceil((new Date(customDate + "T00:00:00").getTime() - new Date(daysFromToday(0) + "T00:00:00").getTime()) / 86400000));
              save(null, days);
            }} className="rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Set date</button>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
        <div className="flex items-center gap-3">
          <button onClick={() => { setRescheduleOpen((v) => !v); setOutcome(null); }} disabled={saving}
            className="text-[16px] font-medium text-accent hover:underline disabled:opacity-40">
            {rescheduleOpen ? "Log what happened instead" : "Just change the follow up date"}
          </button>
          {!rescheduleOpen && (
            <button onClick={() => save(LOST_KEY, null)} disabled={saving}
              title="Records a hard no and stops this business from coming back to your dashboard"
              className="text-[16px] font-medium text-muted hover:text-danger disabled:opacity-40">
              Not interested
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-[16px] text-muted">Saving…</span>}
          <button onClick={onCancel} disabled={saving} className="text-[16px] font-medium text-muted hover:text-foreground disabled:opacity-40">Cancel</button>
        </div>
      </div>
    </div>
  );
}

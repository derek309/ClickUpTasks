"use client";

// One control for "I reached out to this business," shared by every surface
// that shows a directory listing (Territory Dashboard, Businesses page).
// Writes through /api/directory/activity to WordPress /sales, which is the
// pipeline's source of truth — so a touch logged here lands in the field
// tool's activity log too, instead of this app keeping a second private
// history that quietly disagrees with it.
//
// Every outreach touch REQUIRES a follow-up interval, and that's the whole
// point of the control rather than an incidental field on it: an untimed
// touch is exactly how a business goes quiet for a month with nobody
// noticing, and the follow-up date is the single thing the dashboard reads to
// decide when to put them back in front of a rep. "Not interested" is the one
// outcome that clears the follow-up instead of setting one, so a hard no
// stops resurfacing forever.
//
// Emailed and SMS'd send for real through GHL's Conversations API (the same
// /api/ghl/message route the Task messaging system already uses), not a
// tel:/mailto:/sms: handoff to an external app — a rep composes here, hits
// Send, and only once that's confirmed does the panel move on to logging the
// outcome + follow-up date, so nothing gets logged as "Emailed" that didn't
// actually go out. Falls back to a plain mailto:/sms: link when a listing
// has no matched GHL contact yet (nothing to send an API call to). Called
// stays a tel: link either way — there's no send-a-phone-call API here, only
// a real bridge-call one elsewhere (/api/directory/call) this panel doesn't
// use. A separate "just change the date" path exists alongside the outcome
// flow for rescheduling without claiming a new touch happened — the
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

// Every unclaimed/invited contact lives under this one shared sub-account
// until it actually claims — same id directoryListingsServer.ts resolves
// ghlUrl/bookingUrl against. /api/ghl/message requires SOME clientId (it's
// what a non-admin's send permission is checked against); admins skip that
// check entirely, which covers every real user of this panel today.
const DIRECTORY_CLIENT_ID = "c_directory";

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

const field = "w-full rounded-lg border bg-surface px-2.5 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent disabled:opacity-40";

// today + n days as an <input type="date"> value (local time, not UTC — a
// rep picking "tomorrow" at 11pm shouldn't land on the day after because the
// UTC date had already rolled over).
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TouchPanel({ listingId, phone, email, bookingUrl, ghlContactId, ghlLocationId, initialOutcome, onLogged, onCancel }: {
  listingId: number | string;
  // Only what's needed to make Called/Emailed/Appointment real links —
  // absent for a listing WordPress never got that contact detail for (or,
  // for bookingUrl, a city with no interview calendar set up yet), in which
  // case that outcome falls back to a plain (non-linking) select, same as
  // Visited.
  phone?: string | null;
  email?: string | null;
  bookingUrl?: string | null;
  // Both required for a real send — absent when this listing has no matched
  // GHL contact yet, in which case Emailed/SMS'd fall back to a plain
  // mailto:/sms: link instead of the in-app composer.
  ghlContactId?: string | null;
  ghlLocationId?: string | null;
  // Lets a caller open the panel pre-selected on a specific outcome — the
  // row-level Call Now/Send Email/Send SMS/Book Meeting buttons are
  // themselves the real tel:/booking links (or, for email/SMS, the same
  // in-app compose this panel drives internally), and pass this so the
  // panel opens straight into the right step instead of making the rep
  // pick the same outcome a second time. Still fully editable from there —
  // this only sets the starting point.
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
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sent, setSent] = useState(false);

  const canSendReal = (outcome === "emailed" || outcome === "sms") && !!ghlContactId && !!ghlLocationId;
  const composing = canSendReal && !sent;

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

  // Real send through the same GHL Conversations API the Task messaging
  // system uses — deliberately NOT sendMessage() in Cockpit.tsx, which
  // assumes a real Client/Contact pairing (Gmail-first routing, a local
  // `messages` row, cc/bcc) a prospect doesn't have. Only once this
  // succeeds does the panel move into logging the outcome — a failed send
  // must never get recorded as "Emailed" happened.
  const sendReal = async () => {
    if (!ghlContactId || !ghlLocationId || !outcome) return;
    const body = composeBody.trim();
    if (!body || (outcome === "emailed" && !composeSubject.trim())) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch("/api/ghl/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: DIRECTORY_CLIENT_ID, locationId: ghlLocationId, ghlContactId,
          channel: outcome === "emailed" ? "email" : "sms",
          ...(outcome === "emailed" ? { subject: composeSubject.trim() } : {}),
          body,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Send failed (${res.status}).`);
      setNote(outcome === "emailed" ? `Subject: ${composeSubject.trim()}\n${body}` : body);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const pick = (key: OutcomeKey) => { setOutcome(key); setRescheduleOpen(false); setSent(false); setComposeSubject(""); setComposeBody(""); };

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
              // A real send replaces the mailto:/sms: handoff whenever this
              // listing has a matched GHL contact — only falls back to a
              // plain link/select when it doesn't (nothing to send to).
              const sendable = (o.key === "emailed" || o.key === "sms") && !!ghlContactId && !!ghlLocationId;
              const href = sendable ? null
                : linkKind === "tel" && phone ? `tel:${phone}`
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

          {composing && (
            <div className="mt-2.5 rounded-lg border bg-surface p-2.5">
              <div className="mb-1.5 text-[16px] font-semibold">{outcome === "emailed" ? "Write the email" : "Write the text"}</div>
              {outcome === "emailed" && (
                <input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} disabled={saving}
                  placeholder="Subject" className={`${field} mb-2`} />
              )}
              <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={outcome === "emailed" ? 5 : 3} disabled={saving}
                placeholder={outcome === "emailed" ? "Write your message…" : "Write your text…"} className={`${field} resize-none`} />
              <div className="mt-2 flex items-center gap-3">
                <button onClick={sendReal} disabled={saving || !composeBody.trim() || (outcome === "emailed" && !composeSubject.trim())}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">
                  {saving ? "Sending…" : outcome === "emailed" ? "Send email" : "Send text"}
                </button>
                <span className="text-[16px] text-muted">Sends now through GoHighLevel — not a draft.</span>
              </div>
            </div>
          )}

          {outcome && !composing && (
            <>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={saving}
                placeholder={sent ? undefined : "Add a note (optional)"}
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
          {!composing && (
            <button onClick={() => { setRescheduleOpen((v) => !v); setOutcome(null); }} disabled={saving}
              className="text-[16px] font-medium text-accent hover:underline disabled:opacity-40">
              {rescheduleOpen ? "Log what happened instead" : "Just change the follow up date"}
            </button>
          )}
          {!rescheduleOpen && !composing && (
            <button onClick={() => save(LOST_KEY, null)} disabled={saving}
              title="Records a hard no and stops this business from coming back to your dashboard"
              className="text-[16px] font-medium text-muted hover:text-danger disabled:opacity-40">
              Not interested
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saving && !composing && <span className="text-[16px] text-muted">Saving…</span>}
          <button onClick={onCancel} disabled={saving} className="text-[16px] font-medium text-muted hover:text-foreground disabled:opacity-40">Cancel</button>
        </div>
      </div>
    </div>
  );
}

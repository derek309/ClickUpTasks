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
// Renders as a bounded panel rather than controls loose in the row. The first
// cut inlined them and it read as a form spilling into the list: the four
// channels, a terminal "Not interested", and the row's own Call/View listing
// links all sat on one wrapping line with nothing saying which belonged to
// which. The panel owns the row's full width while it's open, the caller
// hides its other actions, and "Not interested" moved to the footer because
// it answers a different question than the other four.
import { useState } from "react";
import { authedFetch } from "@/lib/supabase";

// WP's own outcome keys AND labels (cul_sales_outcomes in sales-tool.php),
// reused verbatim rather than reworded. A touch logged here renders in the
// /sales activity log using WP's label, so choosing nicer words for the same
// key is precisely how one event ends up described two different ways in the
// two front ends.
const OUTCOMES = [
  { key: "called", label: "Called" },
  { key: "emailed", label: "Emailed" },
  { key: "sms", label: "SMS'd" },
  { key: "visited", label: "Visited" },
] as const;

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

/** Shared button styling for the two pick-one rows, so the outcome and
 * timing choices read as the same kind of control at the same size instead
 * of drifting apart. Fixed min-width keeps them on a tidy grid when they
 * wrap, which is most of what made the first version look thrown together. */
const chip = (selected: boolean) =>
  `min-w-[104px] rounded-lg border px-3 py-2 text-[16px] font-medium transition-colors disabled:opacity-40 ${
    selected
      ? "border-accent bg-accent text-white"
      : "border-[color:var(--border)] text-foreground hover:border-accent hover:bg-accent-soft hover:text-accent"
  }`;

export function TouchPanel({ listingId, onLogged, onCancel }: {
  listingId: number | string;
  onLogged: (result: TouchResult) => void;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // followupDays null means "clear any scheduled follow-up" (the Not
  // interested path); a number schedules one that many days out. The date
  // itself is computed by WordPress from the interval, never sent from here,
  // so the two front ends can't disagree about what "in 2 days" resolves to.
  const save = async (chosenOutcome: string, followupDays: number | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch("/api/directory/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: String(listingId),
          outcome: chosenOutcome,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(followupDays === null ? { clearFollowup: true } : { followupDays }),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Couldn't save that touch (${res.status}).`);
      onLogged(j.listing as TouchResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 w-full rounded-xl border bg-background p-3 sm:max-w-xl">
      {error && (
        <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[16px]">
          <span className="flex-1 text-danger">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-medium text-muted hover:text-foreground">Dismiss</button>
        </div>
      )}

      <div className="mb-1.5 text-[16px] font-semibold">What did you do?</div>
      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.map((o) => (
          <button key={o.key} onClick={() => setOutcome(o.key)} disabled={saving} className={chip(outcome === o.key)}>
            {o.label}
          </button>
        ))}
      </div>

      {outcome && outcome !== LOST_KEY && (
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
        <button onClick={() => save(LOST_KEY, null)} disabled={saving}
          title="Records a hard no and stops this business from coming back to your dashboard"
          className="text-[16px] font-medium text-muted hover:text-danger disabled:opacity-40">
          Not interested
        </button>
        <div className="flex items-center gap-3">
          {saving && <span className="text-[16px] text-muted">Saving…</span>}
          <button onClick={onCancel} disabled={saving} className="text-[16px] font-medium text-muted hover:text-foreground disabled:opacity-40">Cancel</button>
        </div>
      </div>
    </div>
  );
}

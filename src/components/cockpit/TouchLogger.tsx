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

const LOST = { key: "lost", label: "Not interested" } as const;

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

export function TouchLogger({ listingId, onLogged }: {
  listingId: number | string;
  onLogged: (result: TouchResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setOpen(false); setOutcome(null); setNote(""); setError(null); };

  // followupDays null means "clear any scheduled follow-up" (the Not
  // interested path); a number schedules one that many days out. The date
  // itself is computed by WordPress from the interval, never sent from here,
  // so the two front ends can't disagree about what "in 2 days" resolves to.
  const save = async (followupDays: number | null) => {
    if (!outcome) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch("/api/directory/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: String(listingId),
          outcome,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(followupDays === null ? { clearFollowup: true } : { followupDays }),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Couldn't save that touch (${res.status}).`);
      onLogged(j.listing as TouchResult);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Try again.");
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        title="Record that you reached out and set when this should come back to you"
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">
        Log a touch
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:max-w-lg">
      {error && (
        <div className="flex items-center gap-1.5 text-[16px]">
          <span className="text-danger">{error}</span>
          <button onClick={() => setError(null)} className="font-medium text-muted hover:text-foreground">Dismiss</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[16px] text-muted">What did you do?</span>
        {[...OUTCOMES, LOST].map((o) => (
          <button key={o.key} onClick={() => setOutcome(o.key)} disabled={saving}
            className={`rounded-md border px-2.5 py-1 text-[16px] font-medium disabled:opacity-40 ${
              outcome === o.key ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"
            }`}>
            {o.label}
          </button>
        ))}
      </div>

      {outcome && (
        <>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={saving}
            placeholder="What happened? (optional)"
            className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-[16px] outline-none placeholder:text-muted focus:border-accent disabled:opacity-40" />
          {outcome === LOST.key ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[16px] text-muted">Stops showing up on your dashboard.</span>
              <button onClick={() => save(null)} disabled={saving}
                className="rounded-md bg-accent px-2.5 py-1 text-[16px] font-medium text-white disabled:opacity-40">
                {saving ? "Saving…" : "Log it"}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[16px] text-muted">Come back to me</span>
              {FOLLOW_UPS.map((f) => (
                <button key={f.days} onClick={() => save(f.days)} disabled={saving}
                  className="rounded-md border px-2.5 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft disabled:opacity-40">
                  {f.label}
                </button>
              ))}
              {saving && <span className="text-[16px] text-muted">Saving…</span>}
            </div>
          )}
        </>
      )}

      {!saving && (
        <div>
          <button onClick={reset} className="text-[16px] font-medium text-muted hover:text-foreground">Cancel</button>
        </div>
      )}
    </div>
  );
}

// The rules that have to hold when the model is wrong.
//
// Its own module rather than living in route.ts so it can be unit tested: the
// route imports supabaseAdmin, which needs environment the test runner does
// not have, and "the clamps are tested" beats "the clamps are hoped for".

// Exactly what POST /api/extension/tasks accepts. "conversation" and
// "client_request" are assigned by the system when it sees a real client
// interaction; letting a model hand them out would forge that signal.
export const PRIORITIES = ["none", "normal", "urgent"] as const;
type EnrichPriority = (typeof PRIORITIES)[number];

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Enriched = {
  title: string;
  description: string;
  priority: EnrichPriority;
  due: string | null;
  followUpAt: string | null;
};

/** Turn whatever the model returned into something safe to put in a form.
 *
 *  Exported so the rules below can be tested without a network call. They are
 *  the part that has to hold when the model is wrong, and "the clamps are
 *  tested" beats "the clamps are hoped for".
 *
 *  Order matters. `due` is clamped BEFORE `followUpAt` is clamped against it:
 *  pinning the follow-up to a due date that is itself still in the past drags
 *  the follow-up into the past along with it. */
export function normalizeEnriched(parsed: unknown, subject: string, today: string): Enriched {
  const o = (parsed ?? {}) as Record<string, unknown>;

  const asDate = (v: unknown): string | null =>
    typeof v === "string" && ISO_DATE.test(v) ? v : null;

  // A date that has already gone is never the answer to "when is this due".
  let due = asDate(o.due);
  if (due && due < today) due = today;

  let followUpAt = asDate(o.followUpAt);
  if (followUpAt && followUpAt < today) followUpAt = today;
  // Coming back to it after it was already promised is not a follow-up.
  if (followUpAt && due && followUpAt > due) followUpAt = due;

  return {
    // Falls back to the subject, which is at least the sender's own words.
    title: (typeof o.title === "string" && o.title.trim() ? o.title.trim() : subject).slice(0, 200),
    // Falls back to empty, NOT to the raw response: that is JSON now, and a
    // blob of it in the Notes field is worse than nothing to clear out.
    description: typeof o.description === "string" ? o.description.trim().slice(0, 4000) : "",
    priority: PRIORITIES.includes(o.priority as EnrichPriority) ? (o.priority as EnrichPriority) : "normal",
    due,
    followUpAt,
  };
}

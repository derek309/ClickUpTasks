// How long ago something happened, in the words the boards use.
//
// One home for these: both the Reviews board and the Drafts board are built
// around the same question, "how long has this been sitting", and answering it
// in two places is how two lists end up disagreeing about what a day is.
// Every caller passes `now` rather than reading the clock here, so the answer
// is testable and a render never depends on the current time.

const DAY_MS = 86_400_000;

/** Whole days between a moment and now, never negative. Null when there is no
 *  usable date, which is a different answer from zero. */
export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** How long it has been waiting, for a person to read. */
export function waitedFor(days: number | null): string {
  if (days === null) return "not sent yet";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

// The Clipper's date maths, and the two defaults a clipped task starts on.
//
// Deliberately free of every chrome.* and DOM call so it can be unit tested in
// the app's own vitest run, the same reason context.js is shaped this way. The
// business-day walk is the part worth testing: "in 3 days" from a Thursday
// lands on a Sunday if you count naively, and a task due on a Sunday looks
// overdue by Monday morning.
//
// This duplicates addBusinessDaysIso from src/lib/data.ts on purpose. An
// extension is its own bundle and cannot import from src/, so the choice is a
// copy or a build step, and a build step for four small functions is worse.
// The defaults below are the pair from src/components/cockpit/MindDumpModal.tsx
// (DEFAULT_DUE / DEFAULT_FOLLOW_UP) — change one and change the other.

/** Today in the user's LOCAL timezone (yyyy-mm-dd).
 *
 *  Not toISOString(): that is UTC, so any evening after ~4pm Pacific it hands
 *  back tomorrow's date and every default lands a day late. */
export function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** yyyy-mm-dd for `iso` plus `days` days, via UTC date math to dodge DST. */
export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** As addDaysIso, but Saturdays and Sundays do not count. */
export function addBusinessDaysIso(iso, days) {
  let out = iso;
  let left = days;
  while (left > 0) {
    out = addDaysIso(out, 1);
    const dow = new Date(`${out}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return out;
}

// Both computed at CALL time, not at module load. The app can evaluate its
// TODAY once on import because a page reload is never far away, but a side
// panel stays open for days — a constant here would still be quoting Monday's
// date on Thursday.

/** What a clipped task is due, absent anything in the email saying otherwise. */
export function DEFAULT_DUE() {
  return addBusinessDaysIso(todayIso(), 3);
}

/** When it comes back to your attention: today. Whatever you are clipping is
 *  what you are dealing with right now, so it belongs in today's list rather
 *  than waiting a day to resurface. */
export function DEFAULT_FOLLOW_UP() {
  return todayIso();
}

// The sidebar's width, from the names it can show (Derek, 2026-10-07: "adjust
// to the content but always be the smallest possible", names were cut off).
//
// Worked out from the TEXT, never from the laid out sidebar: a w-max sidebar
// that scrolls crashed the tab on Windows, where the scrollbar appearing
// shrank the content, the scrollbar went away, it grew again, round and round
// (see the comment on the <aside> in Cockpit). Measuring strings with a canvas
// cannot loop, because nothing on screen feeds back into it.

/** Narrowest it gets: what it always was (w-52). */
export const SIDEBAR_MIN_PX = 208;
/** Widest it gets, so one very long name can't take the page. It truncates past this. */
export const SIDEBAR_MAX_PX = 320;
/** Around a name: the nav and row padding, the dot or icon, a badge or star,
 *  the gaps, and the scrollbar's reserved gutter. Measured on the live page:
 *  92 to 95px at 208px wide, plus room for a second badge. */
export const SIDEBAR_CHROME_PX = 112;

export function sidebarWidthFor(names: string[], measure: (s: string) => number): number {
  const widest = names.reduce((w, n) => Math.max(w, n ? measure(n) : 0), 0);
  return Math.round(Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, widest + SIDEBAR_CHROME_PX)));
}

/** Text width in the sidebar's own font (15px Inter). Null where there is no
 *  canvas (the server), so the first paint keeps the old fixed width. */
export function canvasMeasure(): ((s: string) => number) | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  const family = getComputedStyle(document.body).fontFamily || "Inter, system-ui, sans-serif";
  ctx.font = `400 15px ${family}`;
  return (s) => ctx.measureText(s).width;
}

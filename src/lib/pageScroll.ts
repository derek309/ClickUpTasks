// On a phone the whole page scrolls as one, top bar and all (Derek,
// 2026-10-16: "Let's not do sticky headers please"). A box that scrolls inside
// itself on a computer just grows to its content there, so "scroll it to the
// newest" has to move the page instead. These say which one is scrolling.

/** True when the box itself scrolls: it can, and it holds more than it shows. */
export function scrollsInside(box: { scrollHeight: number; clientHeight: number; overflowY: string }): boolean {
  return (box.overflowY === "auto" || box.overflowY === "scroll") && box.scrollHeight > box.clientHeight + 1;
}

/** Where to put the scroll so what sat at the bottom stays there after more is
 *  added above it (Show earlier messages). */
export function keepBottomTop(before: { scrollHeight: number; scrollTop: number }, nowScrollHeight: number): number {
  return Math.max(0, nowScrollHeight - (before.scrollHeight - before.scrollTop));
}

function inside(el: HTMLElement): boolean {
  return scrollsInside({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY });
}

/** The element that scrolls for this box: the box, or the page. */
export function scrollerFor(el: HTMLElement): HTMLElement {
  return inside(el) ? el : (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** To the newest at the bottom: inside the box when it scrolls itself (a
 *  computer), else the page to its end (a phone). */
export function scrollToEnd(el: HTMLElement | null, behavior: ScrollBehavior = "auto") {
  if (!el) return;
  const s = scrollerFor(el);
  s.scrollTo({ top: s.scrollHeight, behavior });
}

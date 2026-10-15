"use client";

import { useEffect, useRef } from "react";

// Escape closes the thing on top, and only that thing.
//
// Every overlay in the app registers here — the task drawer, a review window
// over it, a dialog opened from that, a photo preview, a menu — and one
// listener hands the key to whichever registered last. Ordering by "who opened
// last" is the whole point: with each overlay listening for itself, ordering
// falls to React mount order (outermost first) or to listener phase, and both
// put the drawer ahead of the dialog opened from it. The capture-phase trick
// that used to fix that only ever worked for two layers: two overlays open at
// once are siblings on the same node, so one Escape closed both.
//
// The listener sits in the bubble phase, so anything that handles Escape
// itself and calls stopPropagation — a text field cancelling an edit, a
// search box clearing — still wins, exactly as it does today.
//
// A caller that only sometimes wants the key (an action that cancels itself
// when nothing was entered, lib/undoAction) returns PASS_ESCAPE to hand it to
// the one under it, the same press.
export const PASS_ESCAPE = Symbol("pass escape");
type Entry = { fn: () => unknown };
const stack: Entry[] = [];

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !stack.length) return;
  e.stopPropagation();
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].fn() !== PASS_ESCAPE) return;
}

/** Close this overlay on Escape while `active`. The most recently activated
 *  caller is the one that hears the key; returning PASS_ESCAPE passes it down. */
export function useEscapeToClose(onClose: () => unknown, active = true): void {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { fn: () => close.current() };
    if (!stack.length) window.addEventListener("keydown", onKey);
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) window.removeEventListener("keydown", onKey);
    };
  }, [active]);
}

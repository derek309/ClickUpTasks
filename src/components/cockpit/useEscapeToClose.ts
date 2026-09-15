"use client";

import { useEffect, useRef } from "react";

// Escape closes this overlay and nothing under it. The task drawer closes on
// Escape from a document listener; a window listener in the capture phase hears
// the key before it, and stopping the event there keeps it from the drawer. So a
// dialog opened from the drawer (Delete task, Merge, a photo preview) closes on
// its own instead of taking the drawer with it. Inputs that handle Escape
// themselves are untouched: only an open overlay registers.
export function useEscapeToClose(onClose: () => void, active = true): void {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);
}

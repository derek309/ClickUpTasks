"use client";

import { useCallback, useEffect, useRef } from "react";

// Title/description onChange used to call onPatch on every keystroke, which
// writes through Cockpit.tsx's top-level `tasks` state (a full-array clone +
// re-render of the whole unmemoized app tree, on a client with thousands of
// tasks) AND fires a Supabase write, per character typed — the cause of the
// multi-second-per-keystroke lag reported live (screenshot: 5-10s to see
// typed text appear, on task titles specifically). Debouncing the commit
// keeps the field itself instant (it's driven by local/editor-internal state,
// not the patched value) while the expensive save only fires once typing
// pauses. The commit closure is captured fresh at schedule() time (not read
// from a ref later), so it stays bound to whichever task was open when the
// keystroke happened even if the drawer has since switched to a different
// task by the time the timer fires — no cross-task write-to-the-wrong-task
// risk from debouncing.
//
// Shared by the task drawer's title and description and the client review
// document, so every autosaving field in the drawer behaves the same way.
export function useDebouncedCommit(delayMs = 600) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const commit = pendingRef.current;
    pendingRef.current = null;
    if (commit) commit();
  }, []);
  const schedule = useCallback((commit: () => void) => {
    pendingRef.current = commit;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delayMs);
  }, [flush, delayMs]);
  useEffect(() => flush, [flush]); // flush on unmount rather than drop a trailing edit
  return { schedule, flush };
}

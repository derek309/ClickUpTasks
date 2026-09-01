"use client";

import { useEffect, useRef, useState } from "react";

// State that survives a refresh.
//
// For view preferences: which columns are shown, how the list is grouped and
// sorted, which groups are folded up. Those are decisions someone made about
// how they want to work, and resetting them on every reload quietly undoes
// that decision several times a day.
//
// Per browser, deliberately. These are not team settings, and a VA who hides
// the Client column should not be hiding it for everyone.
//
// Loaded after mount rather than in a lazy initializer: localStorage does not
// exist during the server render, and seeding from it there would make the
// server and client markup disagree. Deferred a frame so nothing sets state
// synchronously inside an effect.
export function usePersisted<T>(key: string, initial: T, isValid?: (v: unknown) => boolean): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  // Guards against the load landing after the user has already changed the
  // value: on a slow first paint that would silently undo their click.
  const touched = useRef(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => {
      if (touched.current) return;
      try {
        const raw = localStorage.getItem(`ct.${key}`);
        if (raw === null) return;
        const parsed = JSON.parse(raw) as T;
        if (isValid && !isValid(parsed)) return;
        setValue(parsed);
      } catch { /* corrupt or unavailable: keep the default */ }
    });
    return () => cancelAnimationFrame(r);
    // isValid is intentionally not a dependency: callers pass an inline
    // function, which would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = (v: T) => {
    touched.current = true;
    setValue(v);
    try { localStorage.setItem(`ct.${key}`, JSON.stringify(v)); } catch { /* private mode, quota */ }
  };
  return [value, set];
}

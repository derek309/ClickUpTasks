"use client";

// Meeting on a step (Derek, 2026-10-16): two plain rows, Meet now or Book a
// time, under where Meeting was picked. On a phone it is a sheet along the
// bottom, like Meet now's. Escape and a click away close it and do nothing.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "./ui";
import { useEscapeToClose } from "./useEscapeToClose";
import type { MeetingChoice, MeetingChoiceKey } from "@/lib/meetingChoice";

/** Where it was picked: the row or button pressed, measured as it was pressed. */
export type PickedAt = { top: number; bottom: number; left: number } | null;

/** The row or button under a press, to open the choice beside (TaskDrawer
 *  keeps the last one pressed; a keyboard pick uses the focused one). */
export function pickedAtOf(el: Element | null): PickedAt {
  const hit = el?.closest("button, [role=menuitem], a");
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return r.width || r.height ? { top: r.top, bottom: r.bottom, left: r.left } : null;
}

const WIDTH = 300;

export function MeetingChoiceMenu({ choices, at, first, onPick, onClose }: {
  choices: readonly MeetingChoice[];
  at: PickedAt;
  first: string;
  onPick: (key: MeetingChoiceKey) => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  // Under the row it came from, or above it when there is no room below;
  // kept inside the window. Nothing to go by: the middle of the window.
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 120;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!at) { setPlace({ top: Math.max(16, vh / 3 - h / 2), left: Math.max(16, (vw - WIDTH) / 2) }); return; }
    const below = at.bottom + 4;
    const top = below + h <= vh - 16 ? below : Math.max(16, at.top - 4 - h);
    setPlace({ top, left: Math.min(Math.max(16, at.left), Math.max(16, vw - WIDTH - 16)) });
  }, [at]);
  const pick = (key: MeetingChoiceKey) => () => { onClose(); onPick(key); };
  const row = "flex min-h-12 w-full items-center gap-3 rounded-[5px] px-3 text-left text-[16px] font-semibold text-foreground hover:bg-background focus:bg-background focus:outline-none";
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[115] bg-black/30 sm:bg-transparent" onClick={onClose} />
      <div ref={box} role="menu" aria-label={`Meeting with ${first}`}
        style={place ? { ["--mc-top" as string]: `${place.top}px`, ["--mc-left" as string]: `${place.left}px` } : undefined}
        className={`fixed inset-x-3 bottom-3 z-[116] rounded-[5px] bg-surface p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] text-foreground shadow-[var(--shadow-md)] ring-1 ring-[var(--border)] sm:inset-x-auto sm:bottom-auto sm:left-[var(--mc-left)] sm:top-[var(--mc-top)] sm:w-[300px] sm:pb-1.5 ${place ? "" : "sm:invisible"}`}>
        {choices.map((c) => (
          <button key={c.key} role="menuitem" autoFocus={c.key === choices[0]?.key} onClick={pick(c.key)} className={row}>
            {c.key === "book" ? <I.calendar className="h-5 w-5 shrink-0 text-muted" /> : <I.bolt className="h-5 w-5 shrink-0 text-muted" />}
            {c.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

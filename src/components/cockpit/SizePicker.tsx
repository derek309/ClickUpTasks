"use client";

// How long is this going to take.
//
// Two things this gets right that a plain row of buttons did not. It collapses
// the moment you answer: seven options are a question, and a question that
// stays on screen after it has been answered is just noise beside the stage
// and the assignee. And every bucket names its hours, because "half day" is a
// phrase two people read as four hours and twelve.
//
// The typed estimate is the escape hatch. Buckets make the common case one
// click; they should not force an hour and a half to be rounded to something
// untrue, and a Multi-day has no honest bucket number at all.
import { useState } from "react";
import { SIZE_META, SIZE_ORDER, sizeLabel, type TaskSize } from "@/lib/data";
import { I } from "./ui";

export function SizePicker({ size, sizeHours, onChange, chipClass, compact = false }: {
  size?: TaskSize | null;
  sizeHours?: number | null;
  onChange: (patch: { size: TaskSize | null; sizeHours: number | null }) => void;
  chipClass?: string;
  /** A small clock at the end of the due date: just the icon until set, the
   *  choices in a small menu when clicked (Derek, 2026-09-16: "make this a
   *  small icon at the end of due date"). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const label = sizeLabel({ size, sizeHours });

  const commitCustom = () => {
    const h = Number(custom);
    if (!Number.isFinite(h) || h <= 0) { setCustom(""); return; }
    // Filed against the nearest bucket as well as the number, so anything
    // still reading the bucket (grouping, a filter) gets a sane answer.
    const nearest = SIZE_ORDER.reduce((best, sz) =>
      Math.abs(SIZE_META[sz].hours - h) < Math.abs(SIZE_META[best].hours - h) ? sz : best, SIZE_ORDER[0]);
    onChange({ size: h > SIZE_META.full.hours ? "multi" : nearest, sizeHours: h });
    setCustom("");
    setOpen(false);
  };

  if (compact) {
    const pick = (patch: { size: TaskSize | null; sizeHours: number | null }) => { onChange(patch); setOpen(false); };
    return (
      <span className="relative inline-flex">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          title={label ? `About ${label}. Change how long this will take` : "How long will this take?"} aria-label={label ? `Time estimate ${label}` : "Add a time estimate"}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[16px] hover:bg-surface ${label ? "font-medium text-foreground" : "text-muted"}`}>
          <I.clock className="h-4 w-4" />{label && <span>{label}</span>}
        </button>
        {open && (
          <>
            <span className="fixed inset-0 z-30" onClick={() => { commitCustom(); setOpen(false); }} />
            <span className="absolute left-0 top-full z-40 mt-1 flex w-52 flex-col rounded-lg border bg-surface p-1 shadow-lg" role="menu"
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
              <span className="px-2.5 pb-1 pt-1.5 text-[16px] font-semibold text-muted">How long will it take?</span>
              {SIZE_ORDER.map((sz) => (
                <button key={sz} type="button" role="menuitem" onClick={() => pick({ size: sz, sizeHours: null })} title={SIZE_META[sz].hint}
                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[16px] hover:bg-background ${size === sz && !sizeHours ? "font-semibold text-accent" : ""}`}>
                  {SIZE_META[sz].label}{size === sz && !sizeHours && <I.check className="h-3.5 w-3.5" />}
                </button>
              ))}
              <input value={custom} onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCustom(); } }}
                inputMode="decimal" placeholder="Or type hours" aria-label="Estimate in hours"
                className="mx-1 my-1 rounded-md border bg-background px-2 py-1 text-[16px] outline-none focus:border-accent" />
              {label && (
                <button type="button" role="menuitem" onClick={() => pick({ size: null, sizeHours: null })}
                  className="rounded-md border-t px-2.5 py-1.5 text-left text-[16px] text-muted hover:text-danger">None</button>
              )}
            </span>
          </>
        )}
      </span>
    );
  }

  // Answered and not being changed: one chip, and clicking it reopens.
  if (label && !open) {
    return (
      <button onClick={() => setOpen(true)} title="Change how long this will take"
        className={`${chipClass ?? ""} font-medium`}>
        <I.clock className="h-4 w-4 text-muted" /> {label}
      </button>
    );
  }

  return (
    <span className={`${chipClass ?? ""} flex-wrap gap-1 py-1`} title="Rough size, used to fill a day. Not time tracking.">
      {SIZE_ORDER.map((sz) => (
        <button key={sz} onClick={() => { onChange({ size: sz, sizeHours: null }); setOpen(false); }}
          title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
          className={`rounded-md px-2 py-0.5 text-[16px] ${size === sz && !sizeHours ? "bg-accent font-semibold text-white" : "text-muted hover:bg-background hover:text-foreground"}`}>
          {SIZE_META[sz].label}
        </button>
      ))}
      <input value={custom} onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCustom(); } if (e.key === "Escape") setOpen(false); }}
        onBlur={commitCustom} inputMode="decimal" placeholder="hrs"
        title="Type your own estimate in hours"
        className="w-16 rounded-md border bg-background px-2 py-0.5 text-[16px] outline-none focus:border-accent" />
      {label && (
        <button onClick={() => { onChange({ size: null, sizeHours: null }); setOpen(false); }}
          title="Clear the estimate" className="rounded-md px-2 py-0.5 text-[16px] text-muted hover:text-danger">×</button>
      )}
    </span>
  );
}

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

export function SizePicker({ size, sizeHours, onChange, chipClass }: {
  size?: TaskSize | null;
  sizeHours?: number | null;
  onChange: (patch: { size: TaskSize | null; sizeHours: number | null }) => void;
  chipClass?: string;
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

  // Answered and not being changed: one chip, and clicking it reopens.
  if (label && !open) {
    return (
      <button onClick={() => setOpen(true)} title="Change how long this will take"
        className={`${chipClass ?? ""} gap-1 px-2 py-1 text-[13px] font-medium`}>
        <I.clock className="h-3 w-3 opacity-60" /> {label}
      </button>
    );
  }

  return (
    <span className={`${chipClass ?? ""} flex-wrap gap-0.5 px-1 py-0.5`} title="Rough size, used to fill a day. Not time tracking.">
      {SIZE_ORDER.map((sz) => (
        <button key={sz} onClick={() => { onChange({ size: sz, sizeHours: null }); setOpen(false); }}
          title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
          className={`rounded-[4px] px-1.5 py-0.5 text-[13px] ${size === sz && !sizeHours ? "bg-accent font-semibold text-white" : "text-muted hover:bg-background hover:text-foreground"}`}>
          {SIZE_META[sz].label}
        </button>
      ))}
      <input value={custom} onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCustom(); } if (e.key === "Escape") setOpen(false); }}
        onBlur={commitCustom} inputMode="decimal" placeholder="hrs"
        title="Type your own estimate in hours"
        className="w-12 rounded-[4px] border bg-background px-1.5 py-0.5 text-[13px] outline-none focus:border-accent" />
      {label && (
        <button onClick={() => { onChange({ size: null, sizeHours: null }); setOpen(false); }}
          title="Clear the estimate" className="rounded-[4px] px-1.5 py-0.5 text-[13px] text-muted hover:text-danger">×</button>
      )}
    </span>
  );
}

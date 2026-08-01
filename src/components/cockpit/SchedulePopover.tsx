"use client";

// Small "send later" affordance shared by the two message composers
// (ClientJournal's Chat tab, TaskDrawer's Email/SMS tab) — a clock-icon
// button opens a compact popover with quick-picks plus an exact date/time,
// and confirming calls onSchedule with an ISO timestamp.
import { useEffect, useState } from "react";
import { I } from "./ui";

function quickPick(hoursFromNow: number, atHour?: number): Date {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  if (atHour !== undefined) d.setHours(atHour, 0, 0, 0);
  return d;
}
function nextWeekday(targetDay: number, atHour: number): Date {
  const d = new Date();
  d.setHours(atHour, 0, 0, 0);
  const add = ((targetDay - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + add);
  return d;
}
// Local-time value a <input type="datetime-local"> expects (no timezone suffix).
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SchedulePopover({ disabled, onSchedule }: { disabled?: boolean; onSchedule: (whenIso: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  // Computed in an effect, not render — Date.now() is impure, and the min
  // only needs to reflect "now" at the moment the popover opens.
  const [minValue, setMinValue] = useState("");
  useEffect(() => { if (open) setMinValue(toLocalInputValue(new Date(Date.now() + 5 * 60 * 1000))); }, [open]);

  const pick = (d: Date) => { onSchedule(d.toISOString()); setOpen(false); };
  const quickPicks: { label: string; date: () => Date }[] = [
    { label: "In 1 hour", date: () => quickPick(1) },
    { label: "Tomorrow 9am", date: () => quickPick(24, 9) },
    { label: "Monday 9am", date: () => nextWeekday(1, 9) },
  ];

  return (
    <div className="relative inline-flex">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={disabled} title="Schedule for later"
        className={`shrink-0 rounded-lg border px-2 py-1.5 text-muted hover:bg-background hover:text-foreground disabled:opacity-40 ${open ? "border-accent text-accent" : ""}`}>
        <I.clock className="h-4 w-4" />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
        <div className="absolute bottom-full right-0 z-40 mb-1 w-56 rounded-lg border bg-surface p-2 shadow-soft-md">
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Send later</div>
          {quickPicks.map((q) => (
            <button key={q.label} onClick={() => pick(q.date())} className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-background">{q.label}</button>
          ))}
          <div className="my-1.5 border-t" />
          <div className="flex items-center gap-1.5">
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)}
              min={minValue}
              className="min-w-0 flex-1 rounded-md border bg-background px-1.5 py-1 text-[12px] outline-none focus:border-accent" />
            <button onClick={() => { if (!custom) return; const d = new Date(custom); if (!Number.isNaN(d.getTime())) pick(d); }}
              disabled={!custom} className="shrink-0 rounded-md border border-accent bg-accent px-2 py-1 text-[12px] font-medium text-white disabled:opacity-40">Set</button>
          </div>
        </div>
      </>)}
    </div>
  );
}

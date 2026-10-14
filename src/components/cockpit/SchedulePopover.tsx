"use client";

// Small "send later" affordance shared by the two message composers
// (ClientJournal's Chat tab, TaskDrawer's Email/SMS tab) — a clock-icon
// button opens a compact popover with quick-picks plus an exact date/time,
// and confirming calls onSchedule with an ISO timestamp.
import { useState } from "react";
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

export function SchedulePopover({ disabled, onSchedule, label }: {
  disabled?: boolean;
  onSchedule: (whenIso: string) => void;
  /** A quiet text control ("Send later") in place of the clock button; its
   *  menu opens to the right, and on a phone as a sheet from the bottom. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  // Stamped when the popover is opened, not during a render: reading the clock
  // in render is impure, and reading it in an effect makes the open a second
  // render for a value the click already knew. It only has to mean "now" at
  // the moment it opens.
  const [minValue, setMinValue] = useState("");
  const toggle = () => {
    if (!open) setMinValue(toLocalInputValue(new Date(Date.now() + 5 * 60 * 1000)));
    setOpen(!open);
  };

  const pick = (d: Date) => { onSchedule(d.toISOString()); setOpen(false); };
  const quickPicks: { label: string; date: () => Date }[] = [
    { label: "In 1 hour", date: () => quickPick(1) },
    { label: "Tomorrow 9am", date: () => quickPick(24, 9) },
    { label: "Monday 9am", date: () => nextWeekday(1, 9) },
  ];

  return (
    <div className="relative inline-flex">
      {label ? (
        <button type="button" onClick={toggle} disabled={disabled} title="Schedule for later" aria-expanded={open}
          className={`shrink-0 text-[16px] font-medium underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40 ${open ? "text-accent" : "text-muted"}`}>{label}</button>
      ) : (
        <button type="button" onClick={toggle} disabled={disabled} title="Schedule for later"
          className={`shrink-0 rounded-lg border px-2 py-1.5 text-muted hover:bg-background hover:text-foreground disabled:opacity-40 ${open ? "border-accent text-accent" : ""}`}>
          <I.clock className="h-4 w-4" />
        </button>
      )}
      {open && (<>
        <div className={`fixed inset-0 z-30 ${label ? "bg-black/30 sm:bg-transparent" : ""}`} onClick={() => setOpen(false)} />
        <div className={label
          ? "fixed inset-x-0 bottom-0 z-40 rounded-t-[5px] border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-soft-md sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:mb-1 sm:w-72 sm:rounded-[5px] sm:p-2"
          : "absolute bottom-full right-0 z-40 mb-1 w-56 rounded-lg border bg-surface p-2 shadow-soft-md"}>
          <div className={label ? "mb-1.5 text-[16px] font-semibold" : "mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted"}>Send later</div>
          {quickPicks.map((q) => (
            <button key={q.label} onClick={() => pick(q.date())} className={`block w-full rounded px-2 text-left hover:bg-background ${label ? "py-2 text-[16px]" : "py-1.5 text-[13px]"}`}>{q.label}</button>
          ))}
          <div className="my-1.5 border-t" />
          <div className="flex items-center gap-1.5">
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)}
              min={minValue}
              className={`min-w-0 flex-1 rounded-md border bg-background px-1.5 py-1 outline-none focus:border-accent ${label ? "text-[16px]" : "text-[12px]"}`} />
            <button onClick={() => { if (!custom) return; const d = new Date(custom); if (!Number.isNaN(d.getTime())) pick(d); }}
              disabled={!custom} className={`shrink-0 rounded-md border px-2 py-1 font-medium disabled:opacity-40 ${label ? "bg-surface text-[16px] text-foreground" : "border-accent bg-accent text-[12px] text-white"}`}>Set</button>
          </div>
        </div>
      </>)}
    </div>
  );
}

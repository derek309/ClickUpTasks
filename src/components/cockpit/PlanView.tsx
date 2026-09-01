"use client";

import { Task, Client, Project, PlanDay, PlannedTask, SIZE_META, SIZE_ORDER, TaskSize,
  formatDue, effectivePriority, PRIORITY_META, effectiveDueDate, TODAY, daysUntilDue } from "@/lib/data";
import { I } from "./ui";

// What you are doing today, and where the day runs out.
//
// Not a new list: the same open tasks, in the order their dates demand, cut
// off at the point the working day is full. The cut-off is the product.
// Everything past it is what you are not doing today, said now rather than
// discovered at six o'clock.

function hoursLabel(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
}

function dayLabel(iso: string): string {
  if (iso === TODAY) return "Today";
  const left = daysUntilDue(iso) ?? 0;
  if (left === 1) return "Tomorrow";
  const weekday = new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long" });
  // Past this week a bare weekday is ambiguous: "Thursday" reads as the one
  // coming up, not the one after it.
  return left > 6 ? `Next ${weekday}` : weekday;
}

export function PlanView({ days, unplanned, budgetHours, onBudget, clientById, projectById, onOpen, onSize, unsizedCount, includePersonal, onIncludePersonal }: {
  days: PlanDay<Task>[];
  /** Open work the horizon could not reach. Shown, not dropped. */
  unplanned: Task[];
  budgetHours: number;
  onBudget: (h: number) => void;
  clientById: (id: string) => Client | null;
  projectById: (id: string) => Project | null;
  onOpen: (taskId: string) => void;
  onSize: (taskId: string, size: TaskSize | null) => void;
  unsizedCount: number;
  includePersonal: boolean;
  onIncludePersonal: (v: boolean) => void;
}) {
  const row = (p: PlannedTask<Task>, dimmed: boolean) => {
    const t = p.task;
    const client = clientById(t.clientId);
    const due = effectiveDueDate(t);
    const late = due ? (daysUntilDue(due) ?? 0) < 0 : false;
    const pri = effectivePriority(t);
    return (
      <div key={t.id} className={`group flex items-center gap-2.5 border-t px-3.5 py-2 first:border-t-0 ${dimmed ? "opacity-55" : ""}`}>
        <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: pri === "none" ? "transparent" : PRIORITY_META[pri].color }} />
        <button onClick={() => onOpen(t.id)} className="min-w-0 flex-1 truncate text-left text-[15px] hover:underline">{t.title}</button>
        {/* Sizing lives here as well as in the drawer: the plan is where you
            notice a task has no size, and making you open it to fix that is
            how a plan stops being maintained. */}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          {SIZE_ORDER.map((sz) => (
            <button key={sz} onClick={() => onSize(t.id, t.size === sz ? null : sz)} title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
              className={`rounded px-1 py-0.5 text-[11px] ${t.size === sz ? "bg-accent text-white" : "text-muted hover:bg-background hover:text-foreground"}`}>
              {SIZE_META[sz].label}
            </button>
          ))}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium ${t.size ? "bg-background text-muted" : "border border-dashed text-muted"}`}
          title={t.size ? SIZE_META[t.size].label : "No size set — counted as half a day so the plan isn't quietly wrong"}>
          {hoursLabel(p.hours)}{t.size ? "" : "?"}
        </span>
        <span className="w-24 shrink-0 truncate text-right text-[13px] text-muted">{client?.name ?? projectById(t.projectId)?.name ?? ""}</span>
        <span className={`w-16 shrink-0 text-right text-[13px] ${late ? "font-semibold text-danger" : "text-muted"}`}>{due ? formatDue(due) : "—"}</span>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[22px] font-bold">Plan</h1>
          <p className="text-[13px] text-muted">Your open work, laid across the days it has to happen in.</p>
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-[13px] text-muted" title="Personal tasks have their own view. Fold them in when you want the plan to reflect your whole day.">
          <input type="checkbox" checked={includePersonal} onChange={(e) => onIncludePersonal(e.target.checked)} className="accent-[var(--accent)]" />
          Include personal
        </label>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Working day
          <input type="number" min={1} max={16} step={0.5} value={budgetHours}
            onChange={(e) => onBudget(Math.min(16, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 rounded-md border bg-surface px-2 py-1 text-[14px] text-foreground outline-none focus:border-accent" />
          hours
        </label>
      </div>

      {unsizedCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted">
          <I.bolt className="shrink-0" />
          {unsizedCount} task{unsizedCount === 1 ? " has" : "s have"} no size, counted at half a day each. Hover a row to set one.
        </div>
      )}

      {days.map((d, i) => {
        const over = d.usedHours > d.budgetHours;
        // A quiet rule where the second week starts, so ten day cards read as
        // two weeks rather than one long strip.
        const weekBreak = i > 0 && (daysUntilDue(d.date) ?? 0) > 6 && (daysUntilDue(days[i - 1].date) ?? 0) <= 6;
        const pct = Math.min(100, Math.round((d.usedHours / d.budgetHours) * 100));
        return (
          <div key={d.date} className={`mb-3 overflow-hidden rounded-xl border bg-surface ${weekBreak ? "mt-6 border-t-4" : ""}`}>
            <div className="flex flex-wrap items-center gap-3 border-b bg-background/60 px-3.5 py-2">
              <b className="text-[15px]">{dayLabel(d.date)}</b>
              <span className="text-[13px] text-muted">{formatDue(d.date)}</span>
              <span className="ml-auto flex items-center gap-2 text-[13px] text-muted">
                <span className="h-2 w-32 overflow-hidden rounded-full bg-border">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: over ? "var(--danger)" : pct > 80 ? "#f59e0b" : "var(--success)" }} />
                </span>
                {hoursLabel(d.usedHours)} of {hoursLabel(d.budgetHours)}
              </span>
            </div>
            {d.planned.length === 0 ? (
              <div className="px-3.5 py-3 text-[14px] text-muted">Nothing scheduled. This day is free.</div>
            ) : d.planned.map((p) => row(p, false))}
            {over && (
              <div className="border-t border-dashed border-danger bg-danger/5 px-3.5 py-2 text-[13px] font-medium text-danger">
                This day is over by {hoursLabel(d.usedHours - d.budgetHours)}. Something moves, or a date does.
              </div>
            )}
          </div>
        );
      })}

      {/* Everything past the horizon. With ninety-odd open tasks a five day
          plan holds about ten, and leaving the rest off the page entirely is
          what made a working plan look like it was pulling nothing in. */}
      {unplanned.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-surface">
          <div className="flex flex-wrap items-baseline gap-2 border-b bg-background/60 px-3.5 py-2">
            <b className="text-[15px]">Not this week</b>
            <span className="text-[13px] text-muted">
              {unplanned.length} more task{unplanned.length === 1 ? "" : "s"} · roughly{" "}
              {hoursLabel(unplanned.reduce((sum, t) => sum + (t.size ? SIZE_META[t.size].hours : 3), 0))} of work
            </span>
          </div>
          {unplanned.slice(0, 12).map((t) => row({ task: t, hours: t.size ? SIZE_META[t.size].hours : 3, fits: false }, true))}
          {unplanned.length > 12 && (
            <div className="border-t px-3.5 py-2 text-[13px] text-muted">and {unplanned.length - 12} more.</div>
          )}
        </div>
      )}
    </div>
  );
}

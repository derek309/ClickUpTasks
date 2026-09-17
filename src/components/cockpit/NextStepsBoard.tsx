"use client";

// My Work's Next steps tab: every next step that is yours and due today or
// late, across every task (Derek, 2026-09-16, next step card part 3). Tick one
// off, move it to another day, or open its task, without going task by task.
// The rows come from lib/nextStepsToday.ts; this only draws them.
import { useState } from "react";
import { formatStepTime, parseStepWatch, stepDateLabel } from "@/lib/data";
import type { NextStepRow } from "@/lib/nextStepsToday";
import { I } from "./ui";
import { InlineDate } from "./GroupedList";

export type NextStepsBoardProps = {
  rows: NextStepRow[];
  loading: boolean;
  /** Task and client names for a row, or null if the task isn't loaded. */
  context: (row: NextStepRow) => { taskTitle: string; clientName: string } | null;
  onDone: (row: NextStepRow) => void;
  onMove: (row: NextStepRow, date: string) => void;
  onOpenTask: (taskId: string) => void;
  onRefresh: () => void;
};

const WATCH_HINT: Record<string, string> = { approved: "Ticks itself when the client approves", reply: "Ticks itself when the client replies", handoff: "Ticks itself when the handoff is done" };

export function NextStepsBoard({ rows, loading, context, onDone, onMove, onOpenTask, onRefresh }: NextStepsBoardProps) {
  // Ticked here this visit: they stay on screen, crossed out, with a way into
  // the task to say what happens next.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const late = rows.filter((r) => r.late).length;
  const tick = (r: NextStepRow) => {
    setTicked((s) => new Set(s).add(r.key));
    onDone(r);
  };

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[16px] text-muted">
          {loading ? "Gathering your next steps…" : rows.length === 0 ? "Nothing due today." : `${rows.length} next step${rows.length === 1 ? "" : "s"} due today or late${late ? `, ${late} late` : ""}.`}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={onRefresh} disabled={loading} title="Check again"
          className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] font-medium text-muted hover:text-foreground disabled:opacity-50">
          <I.repeat className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
          {rows.map((r) => {
            const ctx = context(r);
            const done = ticked.has(r.key);
            const date = stepDateLabel(r.due);
            const time = formatStepTime(r.time);
            const watch = parseStepWatch(r.watch);
            return (
              <div key={r.key} className={`flex flex-col gap-2 border-b px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-3 ${done ? "bg-success-soft/40" : ""}`}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <button onClick={() => !done && tick(r)} disabled={done} title={done ? "Done" : "Mark done"} aria-label={done ? "Done" : "Mark done"}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition ${done ? "border-success bg-success text-white" : "border-accent bg-surface text-transparent hover:bg-accent-soft hover:text-accent"}`}>
                    <I.check className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onOpenTask(r.taskId)} className="min-w-0 flex-1 text-left">
                    <span className={`block text-[16px] font-semibold [overflow-wrap:anywhere] ${done ? "text-muted line-through" : ""}`}>{r.text}</span>
                    <span className="block truncate text-[16px] text-muted">
                      {ctx ? `${ctx.clientName} · ${ctx.taskTitle}` : "On a task you cannot see"}
                      {!done && watch && ` · ${WATCH_HINT[watch.kind]}`}
                      {!done && r.moves >= 3 && ` · ⚠ moved ${r.moves} times`}
                    </span>
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-2 pl-10 sm:pl-0">
                  {done ? (
                    <button onClick={() => onOpenTask(r.taskId)} className="rounded-[5px] bg-surface px-3 py-1.5 text-[16px] font-semibold ring-1 ring-border hover:ring-accent">What happens next? ›</button>
                  ) : (
                    <>
                      {time && <span className="rounded-[5px] bg-background px-2.5 py-1.5 text-[16px] font-semibold">🕔 by {time}</span>}
                      <InlineDate value={r.due} onChange={(d) => d && onMove(r, d)} formatValue={() => `📅 ${date.label}`}
                        className={`rounded-[5px] !px-2.5 !py-1.5 text-[16px] font-semibold ${r.late ? "bg-danger-soft text-danger" : "bg-highlight-soft text-highlight"}`} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl border bg-surface py-16 text-center text-[16px] text-muted shadow-soft">
          Nothing due today. Next steps you own show up here on their day, and late ones stay until they're done or moved.
        </div>
      )}
    </div>
  );
}

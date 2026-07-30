"use client";

// The Owner Growth Plan checklist for one business — the ambassador-facing
// tracker for the 18-step journey defined in PLAYBOOK_STEPS (src/lib/data.ts).
// Rendered in two places, both via this one component (no duplicated
// markup): the client detail "Playbook" tab (full mode — what an ambassador
// opens live on a call with the business owner) and, in compact mode, inside
// a territory row's expand panel (TerritoryDirectory.tsx) so ambassadors can
// toggle a step without leaving the city list.
import { PLAYBOOK_PHASES, PLAYBOOK_STEPS, playbookCompletion, type PlaybookProgress } from "@/lib/data";
import { I } from "./ui";

export function ClientPlaybook({ clientId, progress, onToggle, compact }: {
  clientId: string;
  progress: PlaybookProgress[]; // already scoped to this client by the caller
  onToggle: (clientId: string, stepKey: string, done: boolean) => void;
  compact?: boolean;
}) {
  const { done, doneCount, total, pct, next } = playbookCompletion(clientId, progress);

  return (
    <div className={compact ? "space-y-2" : "mx-auto max-w-2xl space-y-4 p-4 sm:p-5"}>
      {!compact && (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <div className="text-[15px] font-medium">Owner Growth Plan</div>
            <div className="text-[13px] text-muted">{doneCount}/{total} · {pct}%</div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          {next && <div className="mt-1.5 text-[13px] text-muted">Next: {next.label}</div>}
        </div>
      )}
      {PLAYBOOK_PHASES.map((phase) => {
        const steps = PLAYBOOK_STEPS.filter((s) => s.phase === phase.key);
        return (
          <div key={phase.key}>
            <div className={compact ? "px-0.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted" : "pb-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted"}>{phase.label}</div>
            <div className={compact ? "space-y-0.5" : "space-y-0.5 rounded-lg border bg-surface p-1"}>
              {steps.map((step) => {
                const isDone = done.has(step.key);
                return (
                  <button key={step.key} onClick={() => onToggle(clientId, step.key, !isDone)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-background ${isDone ? "text-muted line-through" : ""}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isDone ? "border-accent bg-accent text-white" : "border-border"}`}>{isDone && <I.check />}</span>
                    <span className="min-w-0 flex-1 truncate">{step.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

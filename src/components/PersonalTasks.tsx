"use client";

// A short, separate personal to-do list on My Work — private tasks that
// aren't tied to any client and are never visible to anyone but their
// assignee (enforced by RLS, not just hidden in the UI). Deliberately not
// the full GroupedList grid: this is meant to read as a lightweight
// checklist, not another dense client work table.
import { useState } from "react";
import { formatDue, isOverdue, PRIORITY_META, type Task } from "@/lib/data";
import { I } from "./cockpit/ui";

export function PersonalTasks({ tasks, onOpen, onToggleDone, onQuickAdd }: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onQuickAdd: (title: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  const submit = () => {
    if (!draft.trim()) return;
    onQuickAdd(draft);
    setDraft("");
  };

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="flex items-center gap-2 border-b bg-background/40 px-4 py-2">
          <I.user className="text-muted" />
          <span className="text-[15px] font-bold">Personal</span>
          <span className="rounded-full bg-background px-1.5 text-[13px] font-normal text-muted">{open.length}</span>
          <span className="ml-auto text-[13px] text-muted">Only visible to you</span>
        </div>
        <div>
          {open.map((t) => (
            <div key={t.id} className="flex items-center gap-2 border-b px-4 py-2 last:border-0 hover:bg-accent-soft/50">
              <button onClick={() => onToggleDone(t.id, true)} title="Mark done" className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border hover:border-accent" />
              <button onClick={() => onOpen(t.id)} className="min-w-0 flex-1 truncate py-0.5 text-left text-[15px] font-medium">{t.title}</button>
              {t.priority !== "none" && <span className="shrink-0 text-[13px] font-medium" style={{ color: PRIORITY_META[t.priority].color }}>{PRIORITY_META[t.priority].label}</span>}
              {t.due && <span className={`shrink-0 text-[13px] ${isOverdue(t.due) && t.status !== "done" ? "font-medium text-danger" : "text-muted"}`}>{formatDue(t.due)}</span>}
            </div>
          ))}
          <div className="flex items-center gap-2 border-b px-4 py-1.5 last:border-0">
            <I.plus className="text-muted" />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Add a personal task…" className="flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted" />
          </div>
          {done.length > 0 && (
            <div>
              <button onClick={() => setShowDone((s) => !s)} className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-[13px] font-medium text-muted hover:text-foreground">
                <I.chevron className={`transition ${showDone ? "-rotate-90" : "rotate-180"}`} /> Done ({done.length})
              </button>
              {showDone && done.map((t) => (
                <div key={t.id} className="flex items-center gap-2 border-t px-4 py-2 last:border-0">
                  <button onClick={() => onToggleDone(t.id, false)} title="Reopen" className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-accent bg-accent text-white"><I.check /></button>
                  <button onClick={() => onOpen(t.id)} className="min-w-0 flex-1 truncate py-0.5 text-left text-[15px] text-muted line-through">{t.title}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

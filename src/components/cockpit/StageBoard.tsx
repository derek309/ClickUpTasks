"use client";

// A project's custom Kanban board — side-by-side stage columns you drag
// tasks between, e.g. "Backlog / Designing / In Review / Shipped" instead
// of the fixed Todo/In Progress/Review/Done board. Only rendered when a
// project has stages defined (see Cockpit.tsx); otherwise the normal
// GroupedList status board is used, unchanged.
//
// GroupedList is a single vertical list with collapsible group headers, not
// true side-by-side columns, so this is new UI rather than a re-skin — but
// the drag mechanics (draggable + onDragStart/onDragOver/onDrop, tracked via
// local dragged-id state) mirror GroupedList's exact existing pattern.
import { useState } from "react";
import { TODAY, PRIORITY_META, type Task, type Stage } from "@/lib/data";
import { I, Avatar } from "./ui";

export default function StageBoard({ stages, tasks, canAdmin, onOpenTask, onSetTaskStage, onQuickAdd, onCreateStage, onRenameStage, onToggleStageIsDone, onDeleteStage, onReorderStages }: {
  stages: Stage[]; // already sorted by position, scoped to this project
  tasks: Task[];   // already scoped to this project
  canAdmin: boolean;
  onOpenTask: (id: string) => void;
  onSetTaskStage: (taskId: string, stageId: string | null) => void;
  onQuickAdd: (stageId: string, title: string) => void;
  onCreateStage: () => void;
  onRenameStage: (id: string) => void;
  onToggleStageIsDone: (id: string) => void;
  onDeleteStage: (id: string) => void;
  onReorderStages: (orderedIds: string[]) => void;
}) {
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null); // "none" or a stage id
  const [addingIn, setAddingIn] = useState<string | null>(null); // stage id currently showing the quick-add input
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const stageIds = new Set(stages.map((s) => s.id));
  // A task whose stageId doesn't match any current stage (deleted stage, or
  // never assigned one) lands in "No stage" rather than vanishing.
  const unassigned = tasks.filter((t) => !t.stageId || !stageIds.has(t.stageId));
  const columns = [
    { id: null as string | null, name: "No stage", isDone: false, items: unassigned },
    ...stages.map((s) => ({ id: s.id as string | null, name: s.name, isDone: s.isDone, items: tasks.filter((t) => t.stageId === s.id) })),
  ];

  const dropColHere = (targetId: string) => {
    if (!dragColId || dragColId === targetId) return;
    const ids = stages.map((s) => s.id);
    const from = ids.indexOf(dragColId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragColId);
    onReorderStages(next);
  };

  const submitAdd = (stageId: string) => {
    if (draft.trim()) onQuickAdd(stageId, draft.trim());
    setDraft("");
    setAddingIn(null);
  };

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const key = col.id ?? "none";
        return (
          <div key={key}
            draggable={!!col.id && canAdmin}
            onDragStart={() => col.id && setDragColId(col.id)}
            onDragEnd={() => { setDragColId(null); setDragOverCol(null); }}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(key); }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragColId && col.id) dropColHere(col.id);
              else if (dragTaskId) onSetTaskStage(dragTaskId, col.id);
              setDragTaskId(null); setDragColId(null); setDragOverCol(null);
            }}
            className={`flex w-72 shrink-0 flex-col rounded-xl border bg-surface transition ${dragOverCol === key ? "ring-2 ring-accent" : ""}`}>
            <div className="flex items-center gap-1.5 border-b px-3 py-2">
              {col.isDone && <span title="Landing here marks a task done" className="shrink-0 text-emerald-500"><I.check /></span>}
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{col.name}</span>
              <span className="shrink-0 rounded-full bg-background px-1.5 text-[11px] font-medium text-muted">{col.items.length}</span>
              {col.id && canAdmin && (
                <span className="relative shrink-0">
                  <button onClick={() => setMenuOpen((m) => (m === col.id ? null : col.id))} className="rounded p-0.5 text-muted hover:bg-background"><I.dots /></button>
                  {menuOpen === col.id && (
                    <span className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border bg-surface p-1 shadow-lg">
                      <button onClick={() => { setMenuOpen(null); onRenameStage(col.id!); }} className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-background">Rename</button>
                      <button onClick={() => { setMenuOpen(null); onToggleStageIsDone(col.id!); }} className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-background">{col.isDone ? "Unmark as done" : "Mark as done"}</button>
                      <button onClick={() => { setMenuOpen(null); onDeleteStage(col.id!); }} className="block w-full rounded px-2 py-1.5 text-left text-[13px] text-danger hover:bg-background">Delete stage</button>
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="flex-1 space-y-1.5 p-2">
              {col.items.map((t) => {
                const pmeta = PRIORITY_META[t.priority];
                const overdue = !!t.due && t.due < TODAY && t.status !== "done";
                return (
                  <div key={t.id} draggable onDragStart={() => setDragTaskId(t.id)} onDragEnd={() => { setDragTaskId(null); setDragOverCol(null); }}
                    onClick={() => onOpenTask(t.id)}
                    className="cursor-grab rounded-lg border bg-background px-2.5 py-2 text-[13px] shadow-sm transition hover:border-accent active:cursor-grabbing">
                    <div className="flex items-start gap-1.5">
                      <span title={pmeta.label} className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: pmeta.color }} />
                      <span className="min-w-0 flex-1">{t.title}</span>
                    </div>
                    {(t.due || t.assigneeId) && (
                      <div className="mt-1 flex items-center justify-between pl-3.5">
                        {t.due ? <span className={overdue ? "text-[11px] font-medium text-danger" : "text-[11px] text-muted"}>{t.due}</span> : <span />}
                        {t.assigneeId && <Avatar id={t.assigneeId} size={18} />}
                      </div>
                    )}
                  </div>
                );
              })}
              {col.id && (addingIn === col.id ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitAdd(col.id!); if (e.key === "Escape") { setDraft(""); setAddingIn(null); } }}
                  onBlur={() => { setDraft(""); setAddingIn(null); }}
                  placeholder="Task title" className="w-full rounded-md border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent" />
              ) : (
                <button onClick={() => setAddingIn(col.id)} className="w-full rounded-md border border-dashed px-2 py-1 text-left text-[12px] text-muted hover:bg-background hover:text-foreground">+ Add task</button>
              ))}
            </div>
          </div>
        );
      })}
      {canAdmin && (
        <button onClick={onCreateStage} className="flex h-10 w-40 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
          <I.plus /> Add stage
        </button>
      )}
    </div>
  );
}

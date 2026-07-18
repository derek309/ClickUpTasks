"use client";

// The ClickUp-style grouped list view: group headers, task rows, quick-add,
// expandable subtasks, and the inline cell editors (priority/assignee/due).
import { useRef, useState } from "react";
import {
  users, formatDue, isOverdue, TODAY, timeAgo, userById,
  PRIORITY_META, manualPriorityOptions,
  STATUS_META, STATUS_ORDER, RECURRENCE_LABEL, RECURRENCE_ORDER, describeRecurrence,
  type Task, type Priority, type Recurrence, type Client, type Project, type TaskStatus,
} from "@/lib/data";
import { I, Avatar, LabelChips, COL_WIDTHS, LIST_COLUMNS } from "./ui";

// --- grouped list view (ClickUp-style: group, quick-add, expandable subtasks) --

export function GroupedList({ groups, showClient, clientById, projectById, contactById, visibleCols, sortKey, sortDir, onSort, onOpen, onPatch, canQuickAdd, quickAddHint, onQuickAdd, onToggleSub, onAddSub, onDeleteSub, onAddComment, hideEmpty, highlightDelegateFor, queuedIds, onDropInGroup, colOrder, onReorderCols, selectedIds, onToggleSelect }: {
  groups: { key: string; label: string; color: string; tasks: Task[] }[];
  showClient: boolean; clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null;
  visibleCols: string[]; sortKey: string; sortDir: "asc" | "desc"; onSort: (key: string) => void;
  onOpen: (id: string) => void; onPatch: (taskId: string, patch: Partial<Task>) => void; canQuickAdd: boolean; quickAddHint: string; onQuickAdd: (groupKey: string, title: string) => void;
  onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void; onDeleteSub: (taskId: string, subId: string) => void; onAddComment: (taskId: string, body: string) => void; hideEmpty?: boolean; highlightDelegateFor?: string;
  queuedIds?: Set<string>;
  // When set, task rows can be dragged onto a group header to move them into
  // that group (e.g. drag a row onto "Urgent" to reprioritize it) — only
  // meaningful for groupBy dimensions the caller knows how to translate back
  // into a task patch (priority/status), so this is opt-in per render.
  onDropInGroup?: (taskId: string, groupKey: string) => void;
  // Manual column order (all LIST_COLUMNS keys, any order) + its setter —
  // when both are given, column headers become draggable to reorder.
  colOrder?: string[]; onReorderCols?: (keys: string[]) => void;
  // When set, each row gets a selection checkbox for bulk edit; the caller
  // owns the selected-id set and renders its own bulk-action bar.
  selectedIds?: Set<string>; onToggleSelect?: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [subDraft, setSubDraft] = useState<Record<string, string>>({});
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [collapsedG, setCollapsedG] = useState<Set<string>>(new Set());
  const toggleG = (k: string) => setCollapsedG((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragColKey, setDragColKey] = useState<string | null>(null);

  const filteredGroups = hideEmpty ? groups.filter((g) => g.tasks.length > 0) : groups;
  // hideEmpty must never hide the only way to add a first task — if filtering
  // would leave nothing on screen at all, fall back to the first defined
  // group (empty, but its quick-add row is still reachable) instead of a
  // dead-end "No tasks yet." with no input anywhere.
  const visibleGroups = filteredGroups.length === 0 && canQuickAdd && groups.length > 0 ? [groups[0]] : filteredGroups;
  // Any column missing from a saved colOrder (e.g. added after the order was
  // last persisted) falls back to LIST_COLUMNS' own position for it.
  const orderedColumns = colOrder
    ? LIST_COLUMNS.slice().sort((a, b) => {
        const ia = colOrder.indexOf(a.key), ib = colOrder.indexOf(b.key);
        return (ia < 0 ? LIST_COLUMNS.length : ia) - (ib < 0 ? LIST_COLUMNS.length : ib);
      })
    : LIST_COLUMNS;
  const cols = orderedColumns.filter((c) => visibleCols.includes(c.key));
  const dropColHere = (targetKey: string) => {
    if (!onReorderCols || !dragColKey || dragColKey === targetKey) return;
    const keys = orderedColumns.map((c) => c.key).filter((k) => k !== dragColKey);
    keys.splice(keys.indexOf(targetKey), 0, dragColKey);
    onReorderCols(keys);
  };
  // minmax(200px,1fr) — not minmax(0,1fr) — so the name column can never be
  // crushed to near-zero width on a narrow viewport (that crush is what made
  // task titles render as one letter per line on mobile). The card scrolls
  // horizontally instead once the fixed-width columns + this minimum exceed
  // the viewport. The subtask-expand chevron and assignee avatar live inside
  // this same column (not a separate unlabeled one to its left) so the row
  // reads as a single Name column under the header.
  const template = ["minmax(200px,1fr)", ...(showClient ? ["180px"] : []), ...cols.map((c) => COL_WIDTHS[c.key])].join(" ");
  const sortColKey: Record<string, string> = { title: "task", priority: "priority", due: "due", assignee: "assignee", status: "status", comments: "comments" };
  const activeCol = sortColKey[sortKey];
  const Arrow = ({ col }: { col: string }) => (activeCol === col ? <span className="text-accent">{sortDir === "asc" ? "↑" : "↓"}</span> : null);

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-x-auto rounded-xl border bg-surface shadow-soft">
        <div className="hidden items-center gap-2 border-b bg-background/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted sm:grid" style={{ gridTemplateColumns: template }}>
          <button onClick={() => onSort("task")} className="flex items-center gap-1 text-left hover:text-foreground">Name <Arrow col="task" /></button>
          {showClient && <span>Client</span>}
          {cols.map((c) => (
            <div key={c.key} draggable={!!onReorderCols} onDragStart={() => setDragColKey(c.key)} onDragEnd={() => setDragColKey(null)}
              onDragOver={(e) => onReorderCols && e.preventDefault()} onDrop={(e) => { if (onReorderCols) { e.preventDefault(); dropColHere(c.key); } }}
              className={onReorderCols ? "cursor-grab active:cursor-grabbing" : undefined}>
              {c.sortable
                ? <button onClick={() => onSort(c.key)} className={`flex items-center gap-1 hover:text-foreground ${c.key === "comments" ? "justify-center" : "text-left"}`}>{c.label} <Arrow col={c.key} /></button>
                : <span className={c.key === "comments" ? "block text-center" : ""}>{c.label}</span>}
            </div>
          ))}
        </div>
        <div className="divide-y-8 divide-background">
          {visibleGroups.map((g) => (
            <div key={g.key}>
              <button onClick={() => toggleG(g.key)}
                onDragOver={(e) => { if (onDropInGroup) { e.preventDefault(); setDragOverKey(g.key); } }}
                onDragLeave={() => setDragOverKey((k) => (k === g.key ? null : k))}
                onDrop={(e) => { if (!onDropInGroup) return; e.preventDefault(); if (dragTaskId) onDropInGroup(dragTaskId, g.key); setDragTaskId(null); setDragOverKey(null); }}
                className={`flex w-full items-center gap-2 border-y px-4 py-2 text-left transition ${dragOverKey === g.key ? "ring-2 ring-inset ring-accent" : ""}`} style={{ background: g.color + "22", borderColor: g.color + "40" }}>
                <I.chevron className={`text-muted transition ${collapsedG.has(g.key) ? "rotate-180" : "-rotate-90"}`} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[15px] font-bold">{g.label}</span>
                <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.tasks.length}</span>
              </button>
              {!collapsedG.has(g.key) && (
                <div>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} template={template} cols={cols} showClient={showClient} clientById={clientById} projectById={projectById} contactById={contactById} onOpen={() => onOpen(t.id)} onPatch={onPatch} onAddComment={onAddComment} delegated={!!highlightDelegateFor && t.assigneeId !== highlightDelegateFor && t.subtasks.some((s) => s.assigneeId === highlightDelegateFor)} queued={!!queuedIds?.has(t.id)}
                      selected={!!selectedIds?.has(t.id)} onToggleSelect={onToggleSelect ? () => onToggleSelect(t.id) : undefined}
                      draggable={!!onDropInGroup} onDragStart={() => setDragTaskId(t.id)} onDragEnd={() => { setDragTaskId(null); setDragOverKey(null); }}
                      expanded={expanded.has(t.id)} onToggleExpand={() => toggle(t.id)} onToggleSub={onToggleSub} onAddSub={onAddSub} onDeleteSub={onDeleteSub}
                      subDraft={subDraft[t.id] ?? ""} setSubDraft={(v) => setSubDraft((s) => ({ ...s, [t.id]: v }))} />
                  ))}
                  {canQuickAdd && (
                    <div className="flex items-center gap-2 border-t px-4 py-1.5">
                      <I.plus className="text-muted" />
                      <input value={draft[g.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [g.key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") { onQuickAdd(g.key, draft[g.key] ?? ""); setDraft((d) => ({ ...d, [g.key]: "" })); } }}
                        placeholder="Add task…" className="flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted" />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {visibleGroups.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No tasks yet.</div>}
      </div>
      {!canQuickAdd && quickAddHint && <div className="mt-3 text-center text-[13px] text-muted">{quickAddHint}</div>}
    </div>
  );
}

function TaskRow({ task, template, cols, showClient, clientById, projectById, contactById, onOpen, onPatch, onAddComment, delegated, queued, selected, onToggleSelect, draggable, onDragStart, onDragEnd, expanded, onToggleExpand, onToggleSub, onAddSub, onDeleteSub, subDraft, setSubDraft }: {
  task: Task; template: string; cols: { key: string; label: string; sortable: boolean }[]; showClient: boolean;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null; onOpen: () => void; onPatch: (taskId: string, patch: Partial<Task>) => void; onAddComment: (taskId: string, body: string) => void; delegated?: boolean; queued?: boolean;
  selected?: boolean; onToggleSelect?: () => void;
  draggable?: boolean; onDragStart?: () => void; onDragEnd?: () => void;
  expanded: boolean; onToggleExpand: () => void; onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void; onDeleteSub: (taskId: string, subId: string) => void;
  subDraft: string; setSubDraft: (v: string) => void;
}) {
  const client = clientById(task.clientId);
  const project = projectById(task.projectId);
  const overdue = isOverdue(task.due) && task.status !== "done";
  const doneSubs = task.subtasks.filter((x) => x.done).length;
  const crumb = project && project.name !== "Tasks" ? project.name : "";
  const cell = (key: string) => {
    if (key === "status") return <InlineStatus value={task.status} onChange={(s) => onPatch(task.id, { status: s })} />;
    if (key === "priority") return <InlinePriority value={task.priority} onChange={(p) => onPatch(task.id, { priority: p })} />;
    if (key === "assignee") return <InlineAssignee value={task.assigneeId} onChange={(a) => onPatch(task.id, { assigneeId: a })} />;
    if (key === "due") return <InlineDue value={task.due} overdue={overdue} recurrence={task.recurrence} onChange={(d) => onPatch(task.id, { due: d })} onRecurrenceChange={(r) => onPatch(task.id, { recurrence: r })} />;
    if (key === "comments") return <InlineComments task={task} onAddComment={onAddComment} />;
    if (key === "contact") { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return <span className="truncate text-[13px] text-muted">{ct?.name ?? "—"}</span>; }
    if (key === "labels") return <LabelChips ids={task.labelIds} />;
    return null;
  };
  return (
    <>
      <div draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
        className={`group/tr flex flex-col gap-1.5 border-b px-4 py-3 transition-colors last:border-0 hover:bg-accent-soft/50 sm:grid sm:min-h-[46px] sm:items-center sm:gap-2 sm:py-2 ${delegated ? "border-l-[3px] border-l-accent bg-accent-soft/30" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`} style={{ gridTemplateColumns: template }}>
        <div className="flex min-w-0 items-center gap-0.5">
          {onToggleSelect && (
            <button onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} title="Select"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${selected ? "border-accent bg-accent text-white opacity-100" : "border-border opacity-0 group-hover/tr:opacity-100"}`}>
              {selected && <I.check />}
            </button>
          )}
          <button onClick={onToggleExpand} className={`shrink-0 rounded p-0.5 text-muted hover:text-foreground ${task.subtasks.length ? "" : "opacity-0 group-hover/tr:opacity-40"}`} title="Subtasks"><I.chevron className={`transition ${expanded ? "-rotate-90" : "rotate-180"}`} /></button>
          <InlineAssignee value={task.assigneeId} onChange={(a) => onPatch(task.id, { assigneeId: a })} size={36} />
          <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col justify-center py-0.5 pl-1 text-left">
            {/* Project crumb is redundant once the Client column is already
                shown (My Work, All tasks) — keep it only in single-client
                views where there's no other column carrying that context. */}
            {!showClient && crumb && <span className="truncate text-[13px] leading-tight text-muted">{crumb}</span>}
            <span className="flex min-w-0 items-center gap-1.5">
              {delegated && <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Delegated</span>}
              {queued && <span title="Queued for Claude Code" className="shrink-0 text-amber-500">★</span>}
              <span className="line-clamp-none min-w-0 flex-1 break-words text-[17px] font-medium leading-snug sm:line-clamp-2" title={task.title}>{task.title}</span>
              {task.recurrence !== "none" && <span title={describeRecurrence(task.recurrence, task.recurrenceInterval, task.recurrenceUnit, task.recurrenceDaysOfMonth)}><I.repeat className="shrink-0 text-muted" /></span>}
              {task.attachments.length > 0 && <I.clip className="shrink-0 text-muted" />}
              {task.subtasks.length > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] text-muted"><I.check />{doneSubs}/{task.subtasks.length}</span>}
            </span>
          </button>
        </div>
        {/* On mobile these wrap into a chip row under the title (indented past
            the avatar); on sm+ `contents` dissolves the wrapper so each cell
            drops back into its own grid column. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-11 sm:contents sm:pl-0">
          {showClient && <span className="flex min-w-0 items-center gap-1.5 text-[15px]"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: client?.color }} /><span className="truncate">{client?.name}</span></span>}
          {cols.map((c) => <div key={c.key} className="min-w-0">{cell(c.key)}</div>)}
        </div>
      </div>
      {expanded && (
        <div className="border-b bg-background/40 py-1.5 pl-10 pr-3">
          {task.subtasks.map((st) => (
            <div key={st.id} className="group/sub flex items-center gap-2 py-0.5">
              <button onClick={() => onToggleSub(task.id, st.id)} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${st.done ? "border-accent bg-accent text-white" : "border-border"}`}>{st.done && <I.check />}</button>
              <span className={`flex-1 text-[15px] ${st.done ? "text-muted line-through" : ""}`}>{st.title}</span>
              <button onClick={() => onDeleteSub(task.id, st.id)} title="Delete subtask" className="shrink-0 text-muted opacity-0 hover:text-red-500 group-hover/sub:opacity-100"><I.trash /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 py-0.5">
            <span className="h-4 w-4 shrink-0" />
            <input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAddSub(task.id, subDraft); setSubDraft(""); } }} placeholder="Add checklist item…" className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          </div>
        </div>
      )}
    </>
  );
}

// --- inline cell editors ----------------------------------------------------

// Shared by every inline dropdown below: they're nested inside overflow-auto
// scroll containers (the list card, the page), so plain `absolute` popups get
// silently clipped whenever a row is near the bottom or right edge. Fixed
// positioning off the trigger's own screen rect (clamped to the viewport)
// sidesteps that — the same approach InlineDue/DatePopover already used.
function menuPos(ref: React.RefObject<HTMLElement | null>, width: number, height = 240) {
  const r = ref.current?.getBoundingClientRect();
  if (!r) return { top: 0, left: 0 };
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  const top = r.bottom + height > window.innerHeight ? Math.max(8, r.top - height) : r.bottom + 4;
  return { top, left };
}

function InlineStatus({ value, onChange }: { value: TaskStatus; onChange: (s: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  return (
    <div className="relative">
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 144, STATUS_ORDER.length * 32 + 8)); setOpen((o) => !o); }} className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[15px] font-medium hover:bg-background">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_META[value].dot }} /> {STATUS_META[value].label}
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div style={{ position: "fixed", top: pos.top, left: pos.left, width: 144 }} className="z-40 rounded-lg border bg-surface p-1 shadow-lg">
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={(e) => { e.stopPropagation(); onChange(s); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[15px] hover:bg-background">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_META[s].dot }} /> {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}

// Conversation is auto-created-only (see PRIORITY_META doc comment in
// data.ts) — it's hidden from this manual picker unless it's already the
// task's current value, so an existing conversation task can still be
// displayed/reselected but a person can't manually assign it to a new task.
function InlinePriority({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const options = manualPriorityOptions(value);
  return (
    <div className="relative">
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 128, options.length * 32 + 8)); setOpen((o) => !o); }} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[15px] font-medium hover:bg-background" style={{ color: value === "none" ? "var(--muted)" : PRIORITY_META[value].color }}>
        {value === "none" ? "—" : (<><I.flag />{PRIORITY_META[value].label}</>)}
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div style={{ position: "fixed", top: pos.top, left: pos.left, width: 128 }} className="z-40 rounded-lg border bg-surface p-1 shadow-lg">
          {options.map((p) => (
            <button key={p} onClick={(e) => { e.stopPropagation(); onChange(p); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[15px] hover:bg-background" style={{ color: p === "none" ? "var(--muted)" : PRIORITY_META[p].color }}>
              {p !== "none" && <I.flag />} {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}

export function InlineAssignee({ value, onChange, size = 22 }: { value: string | null; onChange: (a: string | null) => void; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  return (
    <div className="relative">
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 176, (users.length + 1) * 32 + 8)); setOpen((o) => !o); }} className="rounded-full hover:opacity-80"><Avatar id={value} size={size} /></button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div style={{ position: "fixed", top: pos.top, left: pos.left, width: 176 }} className="z-40 rounded-lg border bg-surface p-1 shadow-xl">
          <button onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] text-muted hover:bg-background">Unassigned</button>
          {users.map((u) => (
            <button key={u.id} onClick={(e) => { e.stopPropagation(); onChange(u.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[15px] hover:bg-background"><Avatar id={u.id} size={20} /> <span className="min-w-0 flex-1 truncate">{u.name}</span></button>
          ))}
        </div>
      </>)}
    </div>
  );
}

function InlineComments({ task, onAddComment }: { task: Task; onAddComment: (taskId: string, body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const visible = task.comments.filter((c) => c.kind !== "event");
  const send = () => { if (!body.trim()) return; onAddComment(task.id, body); setBody(""); };
  return (
    <div className="relative flex justify-center">
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 320, 360)); setOpen((o) => !o); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[13px] text-muted hover:bg-background">
        <I.comment className={`h-[18px] w-[18px] ${visible.length ? "" : "opacity-30"}`} /> {visible.length > 0 && visible.length}
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: pos.top, left: pos.left, width: 320 }} className="z-40 flex max-h-96 flex-col overflow-hidden rounded-xl border bg-surface shadow-xl">
          <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Comments · {visible.length}</div>
          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {visible.map((c) => {
              const u = userById(c.authorId);
              return (
                <div key={c.id} className="flex gap-2">
                  <Avatar id={c.authorId} size={22} />
                  <div className="min-w-0">
                    <div className="text-[13px]"><span className="font-medium">{u?.name}</span> <span className="text-muted">· {timeAgo(c.at)}</span></div>
                    <div className="text-[14px]">{c.body}</div>
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && <div className="py-4 text-center text-[13px] text-muted">No comments yet.</div>}
          </div>
          <div className="flex items-end gap-1.5 border-t p-2">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Write a comment…" rows={1} className="max-h-32 min-h-[32px] flex-1 resize-y rounded-lg border bg-background px-2 py-1.5 text-[14px] outline-none placeholder:text-muted" />
            <button onClick={send} disabled={!body.trim()} className="rounded-lg bg-accent px-2.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">Send</button>
          </div>
        </div>
      </>)}
    </div>
  );
}

const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDaysIso = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
const dowIso = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function friendlyDue(iso: string): string {
  if (iso === TODAY) return "Today";
  if (iso === addDaysIso(TODAY, 1)) return "Tomorrow";
  if (iso === addDaysIso(TODAY, -1)) return "Yesterday";
  for (let i = 2; i <= 6; i++) if (iso === addDaysIso(TODAY, i)) return WD_SHORT[dowIso(iso)];
  return formatDue(iso);
}

// `emptyLabel` overrides the "—" shown when no date is set (e.g. "Follow-up"
// for the prominent header control). `strong` styles a set value in accent
// (and gives the empty state a visible affordance) instead of muted grey —
// for surfaces where the date is a primary action, not a table cell.
export function InlineDue({ value, overdue, recurrence = "none", onChange, onRecurrenceChange, emptyLabel = "—", strong = false }: { value: string | null; overdue: boolean; recurrence?: Recurrence; onChange: (d: string | null) => void; onRecurrenceChange?: (r: Recurrence) => void; emptyLabel?: string; strong?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 440 });
  const openIt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      // Never wider than the viewport (with an 8px gutter each side) so the
      // picker can't run off the right edge of a phone.
      const width = Math.min(440, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      const top = r.bottom + 300 > window.innerHeight ? r.top - 304 : r.bottom + 4;
      setPos({ top, left, width });
    }
    setOpen(true);
  };
  const tone = overdue ? "font-medium text-danger" : strong ? (value ? "font-semibold text-accent" : "font-medium text-accent/70") : "text-muted";
  return (
    <>
      <button ref={ref} onClick={openIt} className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[13px] hover:bg-background ${tone}`}>
        {value ? friendlyDue(value) : emptyLabel}{recurrence !== "none" && <I.repeat className="text-accent" />}
      </button>
      {open && <DatePopover pos={pos} value={value} recurrence={recurrence} onSelect={(d) => { onChange(d); setOpen(false); }} onRecurrenceChange={onRecurrenceChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function DatePopover({ pos, value, recurrence, onSelect, onRecurrenceChange, onClose }: { pos: { top: number; left: number; width: number }; value: string | null; recurrence: Recurrence; onSelect: (d: string | null) => void; onRecurrenceChange?: (r: Recurrence) => void; onClose: () => void }) {
  const [ym, setYm] = useState(() => { const [y, m] = (value ?? TODAY).split("-").map(Number); return { y, m: m - 1 }; });
  const dow = dowIso(TODAY);
  const quicks: [string, string][] = [
    ["Today", TODAY],
    ["Tomorrow", addDaysIso(TODAY, 1)],
    ["This weekend", addDaysIso(TODAY, (6 - dow + 7) % 7 || 6)],
    ["Next week", addDaysIso(TODAY, (1 - dow + 7) % 7 || 7)],
    ["In 2 weeks", addDaysIso(TODAY, 14)],
  ];
  const firstDow = new Date(Date.UTC(ym.y, ym.m, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const shift = (n: number) => setYm((s) => { const dt = new Date(Date.UTC(s.y, s.m + n, 1)); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() }; });
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }} className="z-50 flex flex-col rounded-xl border bg-surface shadow-xl sm:flex-row">
        <div className="w-full shrink-0 border-b p-1.5 sm:w-52 sm:border-b-0 sm:border-r">
          {quicks.map(([label, iso]) => (
            <button key={label} onClick={() => onSelect(iso)} className="flex w-full items-center justify-between gap-3 whitespace-nowrap rounded px-2 py-1.5 text-left text-[15px] hover:bg-background"><span>{label}</span><span className="text-[13px] text-muted">{formatDue(iso)}</span></button>
          ))}
          <button onClick={() => onSelect(null)} className="mt-0.5 w-full rounded px-2 py-1.5 text-left text-[15px] text-danger hover:bg-background">No date</button>
          {onRecurrenceChange && (
            <div className="mt-1 border-t pt-1.5">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Repeat</div>
              <select value={recurrence} onClick={(e) => e.stopPropagation()} onChange={(e) => onRecurrenceChange(e.target.value as Recurrence)} className="w-full rounded border bg-background px-1.5 py-1 text-[15px] outline-none">
                {RECURRENCE_ORDER.map((r) => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex-1 p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[15px] font-semibold">{MO[ym.m]} {ym.y}</span>
            <span className="flex gap-0.5"><button onClick={() => shift(-1)} className="rounded px-1 text-muted hover:bg-background">‹</button><button onClick={() => shift(1)} className="rounded px-1 text-muted hover:bg-background">›</button></span>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[13px] text-muted">{WD.map((w) => <span key={w} className="py-0.5">{w}</span>)}</div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d === null) return <span key={i} />;
              const iso = isoOf(ym.y, ym.m, d); const sel = iso === value; const today = iso === TODAY;
              return <button key={i} onClick={() => onSelect(iso)} className={`rounded py-1 text-[15px] ${sel ? "bg-accent text-white" : today ? "font-semibold text-accent hover:bg-background" : "hover:bg-background"}`}>{d}</button>;
            })}
          </div>
        </div>
      </div>
    </>
  );
}

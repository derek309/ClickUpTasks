"use client";

// The ClickUp-style grouped list view: group headers, task rows, quick-add,
// expandable subtasks, and the inline cell editors (priority/assignee/due).
import { useMemo, useRef, useState } from "react";
import { usePersisted } from "@/lib/usePersisted";
import {
  users, formatDue, isOverdue, TODAY, COLLAPSED_DUE_BUCKETS, effectivePriority, effectiveStatus, clientInitials, dueOneLine, isSnoozed,
  PRIORITY_META, manualPriorityOptions,
  STATUS_META, STATUS_ORDER, RECURRENCE_LABEL, RECURRENCE_ORDER, describeRecurrence,
  PLAYBOOK_STEP_BY_KEY,
  addDaysIso, addBusinessDaysIso, SIZE_META, SIZE_ORDER,
  type Task, type Priority, type Recurrence, type Client, type Project, type TaskStatus, type TaskSize,
} from "@/lib/data";
import { I, Avatar, LabelChips, LIST_COLUMNS, DateChip } from "./ui";

// --- grouped list view (ClickUp-style: group, quick-add, expandable subtasks) --

export function GroupedList({ groups, groupKind, collapseFarBuckets, showClient, onOpenClient, clientById, projectById, contactById, visibleCols, sortKey, sortDir, onSort, onOpen, onPatch, canQuickAdd, quickAddHint, onQuickAdd, onToggleSub, onAddSub, onDeleteSub, hideEmpty, highlightDelegateFor, onDropInGroup, onMergeTasks, colOrder, onReorderCols, selectedIds, onToggleSelect, meId }: {
  groups: { key: string; label: string; color: string; tasks: Task[] }[];
  // The signed-in user — the row's assignee avatar only renders when the
  // task is assigned to someone else; seeing your own face on every one of
  // your own rows added nothing.
  meId?: string;
  showClient: boolean; clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null;
  visibleCols: string[]; sortKey: string; sortDir: "asc" | "desc"; onSort: (key: string) => void;
  groupKind?: string;
  /** Start Next week / This month / Later / No date closed. All Tasks only. */
  collapseFarBuckets?: boolean;
  onOpen: (id: string) => void; onOpenClient?: (clientId: string) => void; onPatch: (taskId: string, patch: Partial<Task>) => void; canQuickAdd: boolean; quickAddHint: string; onQuickAdd: (groupKey: string, title: string, extras: { due: string | null; followUpAt: string | null; size: TaskSize | null }) => void;
  onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void; onDeleteSub: (taskId: string, subId: string) => void; hideEmpty?: boolean; highlightDelegateFor?: string;
  // When set, task rows can be dragged onto a group header to move them into
  // that group (e.g. drag a row onto "Urgent" to reprioritize it) — only
  // meaningful for groupBy dimensions the caller knows how to translate back
  // into a task patch (priority/status), so this is opt-in per render.
  onDropInGroup?: (taskId: string, groupKey: string) => void;
  // When set, dropping one task row directly onto another merges the
  // dragged task into the one it was dropped on (see Cockpit.tsx's
  // requestMerge) — independent of onDropInGroup/groupBy, so it works in
  // every grouping, not just status/priority.
  onMergeTasks?: (sourceTaskId: string, targetTaskId: string) => void;
  // Manual column order (all LIST_COLUMNS keys, any order) + its setter —
  // when both are given, column headers become draggable to reorder.
  colOrder?: string[]; onReorderCols?: (keys: string[]) => void;
  // When set, each row gets a selection checkbox for bulk edit; the caller
  // owns the selected-id set and renders its own bulk-action bar.
  selectedIds?: Set<string>; onToggleSelect?: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subDraft, setSubDraft] = useState<Record<string, string>>({});
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Two conditions, both needed. The list has to be grouped by due date, and
  // the caller has to ask for it — All Tasks does, a single client's list does
  // not (Derek: "only on the All Tasks tab"). Inside one client you are
  // looking at a short list you want to see all of; All Tasks is where a
  // hundred undated rows bury the horizon.
  //
  // The due-date check is not redundant: matching on the key alone collapsed
  // "No priority" too, because the priority grouping has a "none" bucket of
  // its own and the two sets of keys share that word.
  //
  // Folded groups survive a refresh, keyed by grouping so folding a priority
  // bucket does not also fold a due-date one.
  //
  // The far-bucket defaults apply only until someone folds or unfolds
  // something themselves; from then on their choice is what is remembered,
  // which is why null and "nothing collapsed" have to be different values.
  const [savedCollapsed, setSavedCollapsed] = usePersisted<string[] | null>(
    `collapsed.${groupKind ?? "none"}`, null,
    (v) => v === null || (Array.isArray(v) && v.every((x) => typeof x === "string")),
  );
  const seeded = useMemo(
    () => (collapseFarBuckets && groupKind === "due" ? groups.filter((g) => COLLAPSED_DUE_BUCKETS.has(g.key)).map((g) => g.key) : []),
    // Only the group keys matter here, and they are stable for a grouping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collapseFarBuckets, groupKind, groups.length],
  );
  const collapsedG = useMemo(() => new Set(savedCollapsed ?? seeded), [savedCollapsed, seeded]);
  const toggleG = (k: string) => {
    const n = new Set(collapsedG);
    if (n.has(k)) n.delete(k); else n.add(k);
    setSavedCollapsed([...n]);
  };
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragColKey, setDragColKey] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  // Shift-click range select: click a checkbox, hold shift, click one 7 rows
  // down — everything in between gets selected too, like Finder/Gmail. Anchor
  // is the last row you plain-clicked (or shift-extended from), tracked as a
  // ref since it doesn't need to trigger a re-render on its own.
  const lastSelectedIdRef = useRef<string | null>(null);

  const filteredGroups = hideEmpty ? groups.filter((g) => g.tasks.length > 0) : groups;
  // hideEmpty must never hide the only way to add a first task — if filtering
  // would leave nothing on screen at all, fall back to the first defined
  // group (empty, but its quick-add row is still reachable) instead of a
  // dead-end "No tasks yet." with no input anywhere.
  const visibleGroups = filteredGroups.length === 0 && canQuickAdd && groups.length > 0 ? [groups[0]] : filteredGroups;
  // Flat visible order (collapsed groups excluded, they're not on screen) —
  // what a shift-click range actually spans.
  const flatVisibleTaskIds = visibleGroups.filter((g) => !collapsedG.has(g.key)).flatMap((g) => g.tasks.map((t) => t.id));
  const handleSelectClick = (taskId: string, e: React.MouseEvent) => {
    if (!onToggleSelect) return;
    if (e.shiftKey && lastSelectedIdRef.current) {
      const from = flatVisibleTaskIds.indexOf(lastSelectedIdRef.current);
      const to = flatVisibleTaskIds.indexOf(taskId);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i++) {
          const id = flatVisibleTaskIds[i];
          if (!selectedIds?.has(id)) onToggleSelect(id);
        }
        lastSelectedIdRef.current = taskId;
        return;
      }
    }
    onToggleSelect(taskId);
    lastSelectedIdRef.current = taskId;
  };
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
  // A project crumb under every row is noise when the whole list is one
  // project: inside the CUL Website tab, every task said "CUL Website". It
  // only earns its line when the list actually spans more than one.
  const projectIds = new Set(groups.flatMap((g) => g.tasks.map((t) => t.projectId)));
  const showCrumb = projectIds.size > 1;
  // A real table, so every column is exactly as wide as its own widest value
  // and every row matches by construction. The old fixed pixel widths meant
  // the widest value in the list had no say: tighten one number and "Get
  // started" wrapped to two lines while "17 days left" clipped. `table-auto`
  // is the browser doing that arithmetic across all the rows at once, which
  // is not something a per-row grid can do however the numbers are chosen.
  //
  // Only the Name column is told anything: w-full, so it absorbs whatever the
  // sized columns give back rather than the gaps swallowing it.
  const colCount = 1 + (showClient ? 1 : 0) + cols.length;
  const sortColKey: Record<string, string> = { title: "task", priority: "priority", due: "due", followUp: "followUp", assignee: "assignee", status: "status", comments: "comments" };
  const activeCol = sortColKey[sortKey];
  const Arrow = ({ col }: { col: string }) => (activeCol === col ? <span className="text-accent">{sortDir === "asc" ? "↑" : "↓"}</span> : null);

  return (
    <div className="bg-background p-4 sm:p-5">
      <div className="overflow-x-auto rounded-xl border bg-surface shadow-soft">
        {/* No `uppercase` here (Derek, 2026-08-26: "make CLIENT spell
            Client"). Buttons don't inherit text-transform, so it only ever
            hit the labels that aren't sort buttons — Client and any
            non-sortable column — leaving one shouted header in a row of
            normal ones rather than styling the row as a whole. */}
        <table className="block w-full border-collapse text-left sm:table sm:table-auto">
        <thead className="hidden sm:table-header-group">
          <tr className="border-b bg-background/40 text-[12px] font-semibold tracking-wide text-muted">
            <th className="w-full max-w-0 px-4 py-1.5 font-semibold">
              <button onClick={() => onSort("task")} className="flex items-center gap-1 text-left hover:text-foreground">Name <Arrow col="task" /></button>
            </th>
            {showClient && <th className="whitespace-nowrap py-1.5 pr-4 font-semibold">Client</th>}
            {cols.map((c) => (
              <th key={c.key} draggable={!!onReorderCols} onDragStart={() => setDragColKey(c.key)} onDragEnd={() => setDragColKey(null)}
                onDragOver={(e) => onReorderCols && e.preventDefault()} onDrop={(e) => { if (onReorderCols) { e.preventDefault(); dropColHere(c.key); } }}
                className={`whitespace-nowrap py-1.5 pr-4 font-semibold ${onReorderCols ? "cursor-grab active:cursor-grabbing" : ""}`}>
                {c.sortable
                  ? <button onClick={() => onSort(c.key)} className={`flex items-center gap-1 hover:text-foreground ${c.key === "comments" ? "justify-center" : "text-left"}`}>{c.label} <Arrow col={c.key} /></button>
                  : <span className={c.key === "comments" ? "block text-center" : ""}>{c.label}</span>}
              </th>
            ))}
          </tr>
        </thead>
          {visibleGroups.map((g) => (
            <tbody key={g.key} className="block border-b-8 border-background sm:table-row-group">
              <tr className="block sm:table-row"><td colSpan={colCount} className="block p-0 sm:table-cell">
              <button onClick={() => toggleG(g.key)}
                onDragOver={(e) => { if (onDropInGroup) { e.preventDefault(); setDragOverKey(g.key); } }}
                onDragLeave={() => setDragOverKey((k) => (k === g.key ? null : k))}
                onDrop={(e) => { if (!onDropInGroup) return; e.preventDefault(); if (dragTaskId) onDropInGroup(dragTaskId, g.key); setDragTaskId(null); setDragOverKey(null); }}
                className={`flex w-full items-center gap-2 border-y px-4 py-2 text-left transition ${dragOverKey === g.key ? "ring-2 ring-inset ring-accent" : ""}`} style={{ background: g.color + "22", borderColor: g.color + "40" }}>
                <I.chevron className={`text-muted transition ${collapsedG.has(g.key) ? "rotate-180" : "-rotate-90"}`} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[15px] font-bold">{g.label}</span>
                <span className="rounded-[5px] px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.tasks.length}</span>
              </button>
              </td></tr>
              {!collapsedG.has(g.key) && (
                <>
                  {/* Quick-add sits at the TOP of the group, not the bottom
                      (Derek: "move the add task to the top of the list") — on
                      a long group the bottom row was off screen, so adding a
                      task meant scrolling past everything first. border-b
                      rather than border-t since it now divides downward. */}
                  {canQuickAdd && (
                    <tr className="block sm:table-row"><td colSpan={colCount} className="block border-b p-0 sm:table-cell">
                      <InlineTaskComposer
                        // A due bucket already says when the task is due, so
                        // adding into "Today" starts on today rather than
                        // making you say it twice.
                        suggestedDue={groupKind === "due" && (g.key === "today" || g.key === "tomorrow") ? (g.key === "today" ? TODAY : addDaysIso(TODAY, 1)) : null}
                        onAdd={(title, extras) => onQuickAdd(g.key, title, extras)} />
                    </td></tr>
                  )}
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} colCount={colCount} cols={cols} showClient={showClient} showCrumb={showCrumb} onOpenClient={onOpenClient} clientById={clientById} projectById={projectById} contactById={contactById} onOpen={() => onOpen(t.id)} onPatch={onPatch} meId={meId} delegated={!!highlightDelegateFor && t.assigneeId !== highlightDelegateFor && t.subtasks.some((s) => s.assigneeId === highlightDelegateFor)}
                      selected={!!selectedIds?.has(t.id)} onToggleSelect={onToggleSelect ? (e) => handleSelectClick(t.id, e) : undefined}
                      draggable={!!onDropInGroup || !!onMergeTasks} onDragStart={() => setDragTaskId(t.id)} onDragEnd={() => { setDragTaskId(null); setDragOverKey(null); setDragOverTaskId(null); }}
                      isMergeDropTarget={dragOverTaskId === t.id}
                      onRowDragOver={onMergeTasks && dragTaskId && dragTaskId !== t.id ? () => setDragOverTaskId(t.id) : undefined}
                      onRowDragLeave={onMergeTasks ? () => setDragOverTaskId((k) => (k === t.id ? null : k)) : undefined}
                      onRowDrop={onMergeTasks ? () => { if (dragTaskId && dragTaskId !== t.id) onMergeTasks(dragTaskId, t.id); setDragTaskId(null); setDragOverTaskId(null); } : undefined}
                      expanded={expanded.has(t.id)} onToggleExpand={() => toggle(t.id)} onToggleSub={onToggleSub} onAddSub={onAddSub} onDeleteSub={onDeleteSub}
                      subDraft={subDraft[t.id] ?? ""} setSubDraft={(v) => setSubDraft((s) => ({ ...s, [t.id]: v }))} />
                  ))}
                </>
              )}
            </tbody>
          ))}
        </table>
        {visibleGroups.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No tasks yet.</div>}
      </div>
      {!canQuickAdd && quickAddHint && <div className="mt-3 text-center text-[13px] text-muted">{quickAddHint}</div>}
    </div>
  );
}

// Adding a task from the list asks the same questions the full form does.
//
// It used to take a title and create on Enter, which meant the one path
// people actually use produced tasks with no due date, no follow-up and no
// size — exactly what the create form was just made to refuse. Two answers to
// "what does it take to make a task" is one too many.
//
// It still starts as one line. Typing opens the rest rather than creating
// something half made, everything is chips so the whole thing is a few
// clicks, and it never leaves the list.
function InlineTaskComposer({ suggestedDue, onAdd }: {
  suggestedDue: string | null;
  onAdd: (title: string, extras: { due: string | null; followUpAt: string | null; size: TaskSize | null }) => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | null>(suggestedDue);
  const [followUpAt, setFollowUpAt] = useState<string | null>(null);
  const [size, setSize] = useState<TaskSize | null>(null);

  const missing = [!due && "a due date", !followUpAt && "a follow-up date", !size && "how long it takes"].filter(Boolean) as string[];
  const ready = !!title.trim() && missing.length === 0;
  const reset = () => { setTitle(""); setDue(suggestedDue); setFollowUpAt(null); setSize(null); };
  const submit = () => { if (!ready) return; onAdd(title.trim(), { due, followUpAt, size }); reset(); };

  const dayChips = (value: string | null, set: (d: string | null) => void) => (
    <>
      {[["Today", TODAY], ["Tomorrow", addDaysIso(TODAY, 1)], ["In 3 days", addBusinessDaysIso(TODAY, 3)]].map(([label, date]) => (
        <button key={label} onClick={() => set(value === date ? null : date)} title={formatDue(date)}
          className={`rounded-md border px-2 py-0.5 text-[13px] ${value === date ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{label}</button>
      ))}
      <DateChip value={value} onChange={set}
        label={value && ![TODAY, addDaysIso(TODAY, 1), addBusinessDaysIso(TODAY, 3)].includes(value) ? formatDue(value) : "Pick"}
        className={`rounded-md border px-2 py-0.5 text-[13px] ${value && ![TODAY, addDaysIso(TODAY, 1), addBusinessDaysIso(TODAY, 3)].includes(value) ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`} />
    </>
  );

  const label = (t: string) => <span className="w-[62px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">{t}</span>;

  return (
    <div className={title.trim() ? "border-b bg-background/40 px-4 py-2.5" : "px-4 py-1.5"}>
      <div className="flex items-start gap-2">
        <I.plus className="mt-1 shrink-0 text-muted" />
        {/* A textarea, not an input: pasting a whole paragraph into a
            single-line field scrolled the start of it off to the left, so you
            could not see what you were writing (Derek). It grows with the
            text via field-sizing and stops at about five lines, after which
            it scrolls. Enter still submits — newlines are not the point of
            wrapping here — and shift+Enter is left alone for the day someone
            wants one. */}
        <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={1}
          onKeyDown={(e) => {
            if (e.key === "Escape") { reset(); return; }
            // Enter adds once the answers are in, so the keyboard path stays
            // as fast as it was. Before that it does nothing rather than
            // creating something the list cannot plan.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          placeholder="Add task…" className="max-h-[7.5rem] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-[15px] leading-snug outline-none [field-sizing:content] placeholder:text-muted" />
      </div>
      {!!title.trim() && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">{label("Due")}{dayChips(due, setDue)}</div>
          <div className="flex flex-wrap items-center gap-1.5">{label("Follow up")}{dayChips(followUpAt, setFollowUpAt)}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {label("Takes")}
            {SIZE_ORDER.map((sz) => (
              <button key={sz} onClick={() => setSize(size === sz ? null : sz)} title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
                className={`rounded-md border px-2 py-0.5 text-[13px] ${size === sz ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{SIZE_META[sz].label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button onClick={submit} disabled={!ready}
              className="rounded-md bg-accent px-3 py-1 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Add task</button>
            <button onClick={reset} className="text-[13px] text-muted underline underline-offset-[3px] hover:text-foreground">Cancel</button>
            {/* Named, not just greyed out. A disabled button with no reason is
                a dead end you have to hunt for. */}
            {missing.length > 0 && (
              <span className="text-[13px] text-muted">
                Still needs {missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0]}.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, colCount, cols, showClient, showCrumb, onOpenClient, clientById, projectById, contactById, onOpen, onPatch, meId, delegated, selected, onToggleSelect, draggable, onDragStart, onDragEnd, isMergeDropTarget, onRowDragOver, onRowDragLeave, onRowDrop, expanded, onToggleExpand, onToggleSub, onAddSub, onDeleteSub, subDraft, setSubDraft }: {
  task: Task; colCount: number; cols: { key: string; label: string; sortable: boolean }[]; showClient: boolean; showCrumb: boolean; onOpenClient?: (clientId: string) => void;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null; onOpen: () => void; onPatch: (taskId: string, patch: Partial<Task>) => void; meId?: string; delegated?: boolean;
  selected?: boolean; onToggleSelect?: (e: React.MouseEvent) => void;
  draggable?: boolean; onDragStart?: () => void; onDragEnd?: () => void;
  // Drop-onto-this-row-to-merge — independent of the drag-to-reorder-groups
  // above, so a row can be both a drag source and a merge target at once.
  isMergeDropTarget?: boolean; onRowDragOver?: () => void; onRowDragLeave?: () => void; onRowDrop?: () => void;
  expanded: boolean; onToggleExpand: () => void; onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void; onDeleteSub: (taskId: string, subId: string) => void;
  subDraft: string; setSubDraft: (v: string) => void;
}) {
  const client = clientById(task.clientId);
  const project = projectById(task.projectId);
  const overdue = isOverdue(task.due) && task.status !== "done";
  const crumb = project && project.name !== "Tasks" ? project.name : "";
  const isDone = task.status === "done";
  // Priority used to be its own column; it's now a 3px bar on the row's
  // leading edge so it reads at a glance without repeating the group
  // heading when a view is already grouped by priority.
  // Read through effectivePriority everywhere it shows, so a task on
  // automatic reads as its due date implies rather than as the value sitting
  // in the column.
  const shownPriority = effectivePriority(task);
  const priorityBarColor = shownPriority !== "none" ? PRIORITY_META[shownPriority].color : "transparent";
  // The payoff for this Playbook step, surfaced right on the row — so an
  // ambassador scanning the list before walking into a business sees "if
  // they do this, they get that" without opening every task individually.
  const playbookStep = task.playbookStepKey ? PLAYBOOK_STEP_BY_KEY.get(task.playbookStepKey) : undefined;
  // No done circle beside the Stage label any more (Derek, 2026-09-01:
  // "remove the done check mark circle"). It said the same thing the Stage
  // column already says, and an empty ring on every row read as an unticked
  // box waiting to be dealt with. Done is a stage: pick it from Stage, or
  // from the drawer.
  const cell = (key: string) => {
    if (key === "status") return (
      <InlineStatus value={effectiveStatus(task)} onChange={(s) => onPatch(task.id, { status: s })} />
    );
    if (key === "assignee") return <InlineAssignee value={task.assigneeId} waiting={task.waitingOnClient} client={client} onChange={(a) => onPatch(task.id, { assigneeId: a, waitingOnClient: false })} onSetWaiting={() => onPatch(task.id, { waitingOnClient: true, assigneeId: null })} />;
    if (key === "priority") return <InlinePriority value={shownPriority} auto={task.priorityAuto !== false} onChange={(p) => onPatch(task.id, { priority: p })} />;
    if (key === "followUp") return (
      <InlineDate value={task.followUpAt ?? null} onChange={(d) => onPatch(task.id, { followUpAt: d })}
        onClear={() => onPatch(task.id, { followUpAt: null })}
        className={`text-[13px] ${isSnoozed(task) ? "font-medium text-amber-700" : "text-muted"}`} emptyLabel="—" />
    );
    // The Due date column shows the date itself, month and day (Derek:
    // "just make due date the month and day it's due"). The countdown reads
    // as a second copy of the Follow up column beside it, and the snooze
    // suffix put "follow up Tomorrow" in both columns at once.
    if (key === "due") return <InlineDue value={task.due} overdue={overdue && !isSnoozed(task)} showCountdown={false} formatValue={formatDue} showSnooze={false} followUpAt={task.followUpAt ?? null} recurrence={task.recurrence} onChange={(d) => onPatch(task.id, { due: d })} onRecurrenceChange={(r) => onPatch(task.id, { recurrence: r })} />;
    if (key === "created") return (
      <span className="truncate text-[13px] text-muted" title={`Created ${task.createdAt.slice(0, 10)}`}>{formatDue(task.createdAt.slice(0, 10))}</span>
    );
    if (key === "contact") { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return <span className="truncate text-[13px] text-muted">{ct?.name ?? "—"}</span>; }
    if (key === "labels") return <LabelChips ids={task.labelIds} />;
    return null;
  };
  return (
    <>
      {/* A real row again, which is the whole reason the list is a table: the
          hover, the selected background and the priority bar down the left
          edge are one element's business, not something painted per cell. */}
      <tr draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragOver={(e) => { if (onRowDragOver) { e.preventDefault(); onRowDragOver(); } }}
        onDragLeave={onRowDragLeave}
        onDrop={(e) => { if (onRowDrop) { e.preventDefault(); onRowDrop(); } }}
        className={`group/tr block border-b border-l-[3px] px-4 pb-1.5 transition-colors hover:bg-accent-soft/50 sm:table-row sm:px-0 sm:pb-0 ${delegated ? "border-l-accent bg-accent-soft/30" : ""} ${selected ? "bg-accent-soft" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${isMergeDropTarget ? "bg-accent-soft" : ""}`}
        style={{ borderLeftColor: delegated ? undefined : priorityBarColor }}>
        <td className="block w-full py-1 pr-3 align-middle sm:table-cell sm:max-w-0 sm:pl-4">
        <div className="flex min-w-0 items-center gap-0.5">
          {/* Bulk select, back as a permanent fixture at the leading edge
              (Derek, 2026-08-26: "we have to bring back the check box because
              most people aren't going to know about that"). It was briefly
              hover-only, then replaced entirely by shift/⌘-click — which
              works but is invisible, so nobody who wasn't told would ever
              find it. Modifier-clicking a row still selects, as a shortcut
              for people who know it, but this is the discoverable way. */}
          {onToggleSelect && (
            <button onClick={(e) => { e.stopPropagation(); onToggleSelect(e); }} title="Select — shift-click to select a range"
              className={`mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${selected ? "border-accent bg-accent text-white" : "border-border"}`}>
              {selected && <I.check />}
            </button>
          )}
          {/* Only when the Stage column is off, so there is never two of
              them on one row. */}
          {!cols.some((c) => c.key === "status") && (
            <span className="mr-1"><StatusDot value={effectiveStatus(task)} onChange={(st) => onPatch(task.id, { status: st })} /></span>
          )}
          <button onClick={onToggleExpand} className={`shrink-0 rounded p-0.5 text-muted hover:text-foreground ${task.subtasks.length ? "" : "opacity-0 group-hover/tr:opacity-40"}`} title="Subtasks"><I.chevron className={`transition ${expanded ? "-rotate-90" : "rotate-180"}`} /></button>
          {/* Always visible (Derek, 2026-08-24): hiding it whenever the
              assignee was you left most rows on a client's own list with no
              assignee shown at all, since most tasks are assigned to the
              admin viewing the list. */}
          <InlineAssignee value={task.assigneeId} waiting={task.waitingOnClient} client={client} onChange={(a) => onPatch(task.id, { assigneeId: a, waitingOnClient: false })} onSetWaiting={() => onPatch(task.id, { waitingOnClient: true, assigneeId: null })} size={30} />
          {/* Multi-select lives on the row itself now (Derek, 2026-08-26:
              "remove the multiple checkboxes and just make it shift and
              select multi"). Shift-click extends a range from the last row
              you touched, ⌘/Ctrl-click toggles one row on its own, and a
              plain click still opens the task — so the common action keeps
              the bare click and selection costs a modifier instead of a
              permanent column of checkboxes. */}
          <div role="button" tabIndex={0}
            onClick={(e) => {
              if (onToggleSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); onToggleSelect(e); return; }
              onOpen();
            }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
            className="flex min-w-0 flex-1 cursor-pointer flex-col justify-center pl-1 text-left">
            {/* Badges live below the title, never inline with it: a narrow
                Name column used to squeeze the title to "Crea te..." while a
                chip beside it kept its full width. Context belongs below the
                thing it describes, not in front of it. */}
            <span className="flex min-w-0 items-center gap-1.5">
              {delegated && <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Delegated</span>}
              {/* Wraps to a second line rather than pushing the table wider
                  than the window (Derek: "go ahead and wordwrap the titles if
                  you have to" — a sideways scrollbar that hides the Name
                  column is worse than a taller row). Clamped at two lines so
                  one essay of a title cannot own the screen; the full text is
                  in the title attribute and the task is one click away. */}
              <span className={`line-clamp-2 min-w-0 flex-1 break-words text-[15px] font-medium leading-snug ${isDone ? "text-muted line-through" : ""}`} title={task.title}>{task.title}</span>
            </span>
            {/* No icon row (Derek, 2026-09-01: "remove the icons not needed
                on tasks list view"). A repeat arrow, a paperclip, a comment
                bubble and a subtask count on every row is four pieces of
                trivia competing with the title, and none of them changes what
                you do next. All of it is in the task, one click away. The
                project crumb stays: it says which list you are looking at,
                which the row otherwise cannot tell you. */}
            {showCrumb && !showClient && crumb && (
              <span className="min-w-0 truncate text-[11px] leading-tight text-muted">{crumb}</span>
            )}
            {playbookStep?.youGet && task.status !== "done" && (
              <span className="block truncate text-[12px] text-muted" title={playbookStep.youGet}>📈 {playbookStep.youGet}</span>
            )}
          </div>
        </div>
        </td>
          {/* The client name is the obvious way to say "show me everything
              for these people", so it acts like one. stopPropagation keeps it
              from also opening the task behind it. Capped rather than sized to
              content: one long client name would otherwise widen the column
              for every row and eat the title. */}
          {showClient && (
            <td className="inline-flex items-center py-0.5 pr-3 align-middle sm:table-cell sm:max-w-[190px] sm:py-1 sm:pr-4">
            <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: client?.color }} />
              {onOpenClient && client ? (
                <button onClick={(e) => { e.stopPropagation(); onOpenClient(client.id); }}
                  title={`Open ${client.name}`}
                  className="min-w-0 truncate rounded px-1 -mx-1 text-left hover:bg-background hover:text-accent hover:underline">{client.name}</button>
              ) : (
                <span className="truncate">{client?.name}</span>
              )}
            </span>
            </td>
          )}
          {/* whitespace-nowrap is what makes the column size to its widest
              value instead of wrapping to fit a number somebody guessed. */}
          {cols.map((c) => (
            <td key={c.key} className={`inline-flex items-center whitespace-nowrap py-0.5 pr-3 align-middle sm:table-cell sm:py-1 sm:pr-4 `}>{cell(c.key)}</td>
          ))}
      </tr>
      {expanded && (
        <tr className="block sm:table-row"><td colSpan={colCount} className="block border-b bg-background/40 py-1.5 pl-10 pr-3 sm:table-cell">
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
        </td></tr>
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

// The stage's own dot, doubling as complete. Lives on its own so the Name
// cell can carry it when the Stage column is switched off — which the default
// All Tasks view does, and losing one-click complete along with a column you
// hid for width is not what anyone meant by hiding it.
export function StatusDot({ value, onChange }: { value: TaskStatus; onChange: (s: TaskStatus) => void }) {
  const isDone = value === "done";
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(isDone ? "todo" : "done"); }}
      title={isDone ? "Mark as not done" : "Mark done"} aria-pressed={isDone}
      className={`group/dot flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition ${isDone ? "text-white" : "hover:ring-2 hover:ring-success/40"}`}
      style={{ background: isDone ? "var(--success)" : STATUS_META[value].dot }}>
      {/* The tick only shows once it is done, or while you are hovering the
          dot — otherwise every row carries a checkmark it has not earned. */}
      <I.check className={`h-2.5 w-2.5 ${isDone ? "" : "text-white opacity-0 group-hover/dot:opacity-100"}`} />
    </button>
  );
}

// The dot completes the task, the label opens the stage menu.
//
// One-click complete came back without a second control beside the stage
// (Derek: "make the stage dot the toggle"). The circle that used to sit here
// said the same thing the stage label already says, and an empty ring on
// every row reads as an unticked box. The dot is already the stage's colour,
// so turning it into the tick keeps one thing where there were two.
function InlineStatus({ value, onChange }: { value: TaskStatus; onChange: (s: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  return (
    <div className="relative inline-flex items-center gap-1.5">
      <StatusDot value={value} onChange={onChange} />
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 144, STATUS_ORDER.length * 32 + 8)); setOpen((o) => !o); }} className="inline-flex items-center rounded px-1 py-0.5 text-[13px] font-medium hover:bg-background">
        {STATUS_META[value].label}
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

// Brought back as a real column (Derek, 2026-08-24): the leading-edge color
// bar alone wasn't enough on a single-client list — no way to actually
// change a task's priority from the row without opening it.
function InlinePriority({ value, auto = false, onChange }: { value: Priority; auto?: boolean; onChange: (p: Priority) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const options = manualPriorityOptions(value);
  return (
    <div className="relative">
      {/* whitespace-nowrap + a shrink-proof flag: "Client request" is the
          longest label and was wrapping onto two lines, which made its row
          taller than every other row in the list (Derek, 2026-08-27). The
          column now sizes itself to fit it. */}
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 128, options.length * 32 + 8)); setOpen((o) => !o); }}
        title={auto ? "Following the due date. Pick one to fix it." : "Set by hand"}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[13px] font-medium hover:bg-background" style={{ color: value === "none" ? "var(--muted)" : PRIORITY_META[value].color }}>
        {value === "none" ? "—" : (<><I.flag className="shrink-0" />{PRIORITY_META[value].label}</>)}
        {/* A dot, not a word: the row is already dense and this only answers
            "why did that change on its own". */}
        {auto && <span className="ml-0.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />}
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

export function InlineAssignee({ value, onChange, waiting, onSetWaiting, client, size = 22 }: { value: string | null; onChange: (a: string | null) => void; waiting?: boolean; onSetWaiting?: (v: boolean) => void; client?: Client | null; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  return (
    <div className="relative">
      <button ref={ref} title={waiting ? (client ? `Waiting on ${client.name}` : "Waiting on the client") : undefined} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 190, (users.length + 2) * 32 + 8)); setOpen((o) => !o); }} className="rounded-full hover:opacity-80">
        {waiting
          // Same visual language as a user's own Avatar (colored circle +
          // initials) — this task's blocker is that specific client, not a
          // generic "someone external" state, so it should read like one at
          // a glance instead of a plain "Client" pill.
          ? (client
              ? <span className="inline-flex items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: client.color, fontSize: size * 0.4 }}>{clientInitials(client.name)}</span>
              : <span className="inline-flex items-center justify-center rounded-full border border-amber-400/60 bg-amber-50 text-amber-700" style={{ width: size, height: size, fontSize: size * 0.42 }}><I.user /></span>)
          : <Avatar id={value} size={size} />}
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div style={{ position: "fixed", top: pos.top, left: pos.left, width: 190 }} className="z-40 rounded-lg border bg-surface p-1 shadow-xl">
          {onSetWaiting && (
            <button onClick={(e) => { e.stopPropagation(); onSetWaiting(true); setOpen(false); }} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-background ${waiting ? "font-medium text-amber-600" : "text-muted"}`}><I.user /> {client ? client.name : "Waiting on client"}</button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] text-muted hover:bg-background">Unassigned</button>
          {users.map((u) => (
            <button key={u.id} onClick={(e) => { e.stopPropagation(); onChange(u.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[15px] hover:bg-background"><Avatar id={u.id} size={20} /> <span className="min-w-0 flex-1 truncate">{u.name}</span></button>
          ))}
        </div>
      </>)}
    </div>
  );
}

const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
// Anchoring maths for the date popover, shared by InlineDue and InlineDate so
// the two triggers can't drift apart. Both had to solve the same two problems:
// never run off the right edge of a phone, and flip above the trigger when
// there's no room below without pushing the panel off the top.
function useDatePopover() {
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
      // Anchor to the trigger's own left edge instead of its right edge minus
      // the popover width — that right-aligned math went negative for a
      // trigger sitting close to the left edge of the content area (e.g. the
      // header's follow-up-date pill right next to the sidebar), clamping to
      // the viewport's 8px gutter and rendering the popover behind the
      // sidebar instead of under the button that opened it.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      // Prefer opening below the trigger; flip above it if there's no room
      // below, but clamp so a trigger near the top of a short window (a
      // header control, a split/docked browser) never pushes the panel's top
      // above y=0 and off-screen.
      const top = r.bottom + 300 > window.innerHeight ? Math.max(8, r.top - 304) : r.bottom + 4;
      setPos({ top, left, width });
    }
    setOpen(true);
  };
  return { open, setOpen, ref, pos, openIt };
}

// A plain date value that opens the same calendar as the due date. Exists so
// the follow-up date in the task drawer stops being a bare <input type=date>:
// that rendered "08/31/2026" in native widget chrome beside a "Jul 22"
// created date, in a taller box that knocked the whole row out of alignment.
export function InlineDate({ value, onChange, onClear, className = "", emptyLabel = "—", formatValue = friendlyDue }: { value: string | null; onChange: (d: string | null) => void; onClear?: () => void; className?: string; emptyLabel?: React.ReactNode; formatValue?: (iso: string) => string }) {
  const { open, setOpen, ref, pos, openIt } = useDatePopover();
  return (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <button ref={ref} onClick={openIt} className={`min-w-0 truncate rounded px-1 py-0.5 text-left hover:bg-surface ${className}`}>
          {value ? formatValue(value) : emptyLabel}
        </button>
        {value && onClear && (
          <button onClick={onClear} title="Clear the date" className="shrink-0 px-0.5 text-muted hover:text-danger">×</button>
        )}
      </span>
      {open && <DatePopover pos={pos} value={value} recurrence="none" onSelect={(d) => { onChange(d); setOpen(false); }} onClose={() => setOpen(false)} />}
    </>
  );
}

export function InlineDue({ value, overdue, followUpAt = null, recurrence = "none", recurrenceInterval, recurrenceUnit, recurrenceDaysOfMonth, recurrenceNth, recurrenceWeekday, onChange, onRecurrenceChange, emptyLabel = "—", strong = false, showRecurrenceLabel = false, showCountdown = true, showSnooze = true, formatValue = friendlyDue, textClass = "text-[13px]", toneClass }: { value: string | null; overdue: boolean; followUpAt?: string | null; recurrence?: Recurrence; recurrenceInterval?: number; recurrenceUnit?: import("@/lib/data").RecurrenceUnit; recurrenceDaysOfMonth?: number[]; recurrenceNth?: number; recurrenceWeekday?: number; onChange: (d: string | null) => void; onRecurrenceChange?: (r: Recurrence) => void; emptyLabel?: React.ReactNode; strong?: boolean; showRecurrenceLabel?: boolean; showCountdown?: boolean; showSnooze?: boolean; formatValue?: (iso: string) => string; textClass?: string; toneClass?: string }) {
  const { open, setOpen, ref, pos, openIt } = useDatePopover();
  // Amber only for a genuinely near date — not "any date that isn't
  // overdue," which would paint every far-future due date the same urgent
  // color as one due tomorrow.
  const dueThisWeek = !!value && !overdue && value >= TODAY && value <= addDaysIso(TODAY, 7);
  // toneClass lets a caller take the colour decision back. The drawer's dates
  // band does: it wants all three dates in plain foreground so they read as
  // one set of facts, and carries the urgency on the countdown line beneath
  // instead (Derek: "make all the dates black so they stick out").
  const tone = toneClass ?? (overdue ? "font-medium text-danger" : strong ? (value ? "font-semibold text-accent" : "font-medium text-accent/70") : dueThisWeek ? "font-medium text-amber-600" : "text-muted");
  return (
    <>
      {/* Size comes from the caller. Baked in at 11px, the drawer's dates band
          rendered its Due value visibly smaller than the Created value one
          column over, because this class won on specificity over the band's
          own sizing (Derek: "make all the dates larger and the same size"). */}
      <button ref={ref} onClick={openIt} className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-background ${textClass} ${tone}`}>
        {/* One value, never two (Derek: "either whose dates, tomorrow or
            days left, not not all, it's too much"). In a list row that is
            dueOneLine: the countdown inside the week, the date past it. The
            drawer's dates band turns the countdown off and formats the date
            itself, because "Mon" beside an "Aug 27" created date in the very
            next column reads as two different kinds of thing. */}
        {showSnooze && isSnoozed({ followUpAt }) ? null : value ? (showCountdown ? dueOneLine(value) : formatValue(value)) : emptyLabel}
        {/* While it's snoozed the countdown answers the question you can
            actually act on — when it comes back — not how late the promise
            is, which you already know and can't do anything about today. */}
        {showSnooze && isSnoozed({ followUpAt }) ? (
          <span className="shrink-0 text-accent opacity-80">follow up {friendlyDue(followUpAt!)}</span>
        ) : null}
        {recurrence !== "none" && <I.repeat className="text-accent" />}
        {recurrence !== "none" && showRecurrenceLabel && (
          <span className="text-accent">{describeRecurrence(recurrence, recurrenceInterval, recurrenceUnit, recurrenceDaysOfMonth, recurrenceNth, recurrenceWeekday)}</span>
        )}
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

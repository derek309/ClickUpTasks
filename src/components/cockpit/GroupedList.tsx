"use client";

// The ClickUp-style grouped list view: group headers, task rows, quick-add,
// expandable subtasks, and the inline cell editors (priority/assignee/due).
import { useMemo, useRef, useState } from "react";
import { usePersisted } from "@/lib/usePersisted";
import {
  users, formatDue, isOverdue, TODAY, COLLAPSED_DUE_BUCKETS, effectivePriority, effectiveStatus, timeAgo, userById, clientInitials, dueCountdown, isSnoozed,
  PRIORITY_META, manualPriorityOptions,
  STATUS_META, STATUS_ORDER, RECURRENCE_LABEL, RECURRENCE_ORDER, describeRecurrence,
  PLAYBOOK_STEP_BY_KEY,
  type Task, type Priority, type Recurrence, type Client, type Project, type TaskStatus,
} from "@/lib/data";
import { I, Avatar, LabelChips, CollapsibleText, COL_WIDTHS, LIST_COLUMNS } from "./ui";

// --- grouped list view (ClickUp-style: group, quick-add, expandable subtasks) --

export function GroupedList({ groups, groupKind, collapseFarBuckets, showClient, onOpenClient, clientById, projectById, contactById, visibleCols, sortKey, sortDir, onSort, onOpen, onPatch, canQuickAdd, quickAddHint, onQuickAdd, onToggleSub, onAddSub, onDeleteSub, onAddComment, hideEmpty, highlightDelegateFor, onDropInGroup, onMergeTasks, colOrder, onReorderCols, selectedIds, onToggleSelect, meId }: {
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
  onOpen: (id: string) => void; onOpenClient?: (clientId: string) => void; onPatch: (taskId: string, patch: Partial<Task>) => void; canQuickAdd: boolean; quickAddHint: string; onQuickAdd: (groupKey: string, title: string) => void;
  onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void; onDeleteSub: (taskId: string, subId: string) => void; onAddComment: (taskId: string, body: string) => void; hideEmpty?: boolean; highlightDelegateFor?: string;
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
  const [draft, setDraft] = useState<Record<string, string>>({});
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
  // The title takes everything the other columns give back: 2fr against their
  // fixed widths, so it grows with the window instead of the gaps doing it.
  const template = ["minmax(240px,2fr)", ...(showClient ? ["150px"] : []), ...cols.map((c) => COL_WIDTHS[c.key])].join(" ");
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
        <div className="hidden items-center gap-2 border-b bg-background/40 px-4 py-2 text-[12px] font-semibold tracking-wide text-muted sm:grid" style={{ gridTemplateColumns: template }}>
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
                <span className="rounded-[5px] px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.tasks.length}</span>
              </button>
              {!collapsedG.has(g.key) && (
                <div>
                  {/* Quick-add sits at the TOP of the group, not the bottom
                      (Derek: "move the add task to the top of the list") — on
                      a long group the bottom row was off screen, so adding a
                      task meant scrolling past everything first. border-b
                      rather than border-t since it now divides downward. */}
                  {canQuickAdd && (
                    <div className="flex items-center gap-2 border-b px-4 py-1.5">
                      <I.plus className="text-muted" />
                      <input value={draft[g.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [g.key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") { onQuickAdd(g.key, draft[g.key] ?? ""); setDraft((d) => ({ ...d, [g.key]: "" })); } }}
                        placeholder="Add task…" className="flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted" />
                    </div>
                  )}
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} template={template} cols={cols} showClient={showClient} showCrumb={showCrumb} onOpenClient={onOpenClient} clientById={clientById} projectById={projectById} contactById={contactById} onOpen={() => onOpen(t.id)} onPatch={onPatch} onAddComment={onAddComment} meId={meId} delegated={!!highlightDelegateFor && t.assigneeId !== highlightDelegateFor && t.subtasks.some((s) => s.assigneeId === highlightDelegateFor)}
                      selected={!!selectedIds?.has(t.id)} onToggleSelect={onToggleSelect ? (e) => handleSelectClick(t.id, e) : undefined}
                      draggable={!!onDropInGroup || !!onMergeTasks} onDragStart={() => setDragTaskId(t.id)} onDragEnd={() => { setDragTaskId(null); setDragOverKey(null); setDragOverTaskId(null); }}
                      isMergeDropTarget={dragOverTaskId === t.id}
                      onRowDragOver={onMergeTasks && dragTaskId && dragTaskId !== t.id ? () => setDragOverTaskId(t.id) : undefined}
                      onRowDragLeave={onMergeTasks ? () => setDragOverTaskId((k) => (k === t.id ? null : k)) : undefined}
                      onRowDrop={onMergeTasks ? () => { if (dragTaskId && dragTaskId !== t.id) onMergeTasks(dragTaskId, t.id); setDragTaskId(null); setDragOverTaskId(null); } : undefined}
                      expanded={expanded.has(t.id)} onToggleExpand={() => toggle(t.id)} onToggleSub={onToggleSub} onAddSub={onAddSub} onDeleteSub={onDeleteSub}
                      subDraft={subDraft[t.id] ?? ""} setSubDraft={(v) => setSubDraft((s) => ({ ...s, [t.id]: v }))} />
                  ))}
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

function TaskRow({ task, template, cols, showClient, showCrumb, onOpenClient, clientById, projectById, contactById, onOpen, onPatch, onAddComment, meId, delegated, selected, onToggleSelect, draggable, onDragStart, onDragEnd, isMergeDropTarget, onRowDragOver, onRowDragLeave, onRowDrop, expanded, onToggleExpand, onToggleSub, onAddSub, onDeleteSub, subDraft, setSubDraft }: {
  task: Task; template: string; cols: { key: string; label: string; sortable: boolean }[]; showClient: boolean; showCrumb: boolean; onOpenClient?: (clientId: string) => void;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null; onOpen: () => void; onPatch: (taskId: string, patch: Partial<Task>) => void; onAddComment: (taskId: string, body: string) => void; meId?: string; delegated?: boolean;
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
  const doneSubs = task.subtasks.filter((x) => x.done).length;
  const crumb = project && project.name !== "Tasks" ? project.name : "";
  const commentCount = task.comments.filter((c) => c.kind !== "event").length;
  const isDone = task.status === "done";
  const statusColShown = cols.some((c) => c.key === "status");
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
  // Sits to the right of the Stage label (Derek's pick) — the two say the
  // same thing, so they belong together, and unlike the row's far edge this
  // never scrolls out of view when the columns overflow.
  const doneToggle = (
    <button onClick={(e) => { e.stopPropagation(); onPatch(task.id, { status: isDone ? "todo" : "done" }); }}
      title={isDone ? "Mark as not done" : "Mark done"} aria-pressed={isDone}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition ${isDone ? "border-success bg-success text-white" : "border-border text-transparent hover:border-success hover:text-success"}`}>
      <I.check />
    </button>
  );
  const cell = (key: string) => {
    if (key === "status") return (
      <span className="flex min-w-0 items-center gap-1.5">
        <InlineStatus value={effectiveStatus(task)} onChange={(s) => onPatch(task.id, { status: s })} />
        {doneToggle}
      </span>
    );
    if (key === "assignee") return <InlineAssignee value={task.assigneeId} waiting={task.waitingOnClient} client={client} onChange={(a) => onPatch(task.id, { assigneeId: a, waitingOnClient: false })} onSetWaiting={() => onPatch(task.id, { waitingOnClient: true, assigneeId: null })} />;
    if (key === "priority") return <InlinePriority value={shownPriority} auto={task.priorityAuto !== false} onChange={(p) => onPatch(task.id, { priority: p })} />;
    if (key === "followUp") return (
      <InlineDate value={task.followUpAt ?? null} onChange={(d) => onPatch(task.id, { followUpAt: d })}
        onClear={() => onPatch(task.id, { followUpAt: null })}
        className={`text-[11px] ${isSnoozed(task) ? "font-medium text-amber-700" : "text-muted"}`} emptyLabel="—" />
    );
    if (key === "due") return <InlineDue value={task.due} overdue={overdue && !isSnoozed(task)} followUpAt={task.followUpAt ?? null} recurrence={task.recurrence} onChange={(d) => onPatch(task.id, { due: d })} onRecurrenceChange={(r) => onPatch(task.id, { recurrence: r })} />;
    if (key === "created") return (
      <span className="truncate text-[11px] text-muted" title={`Created ${task.createdAt.slice(0, 10)}`}>{formatDue(task.createdAt.slice(0, 10))}</span>
    );
    if (key === "contact") { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return <span className="truncate text-[11px] text-muted">{ct?.name ?? "—"}</span>; }
    if (key === "labels") return <LabelChips ids={task.labelIds} />;
    return null;
  };
  return (
    <>
      <div draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragOver={(e) => { if (onRowDragOver) { e.preventDefault(); onRowDragOver(); } }}
        onDragLeave={onRowDragLeave}
        onDrop={(e) => { if (onRowDrop) { e.preventDefault(); onRowDrop(); } }}
        className={`group/tr flex flex-col gap-1 border-b border-l-[3px] px-4 py-2 transition-colors last:border-0 hover:bg-accent-soft/50 sm:grid sm:min-h-[40px] sm:items-center sm:gap-2 sm:py-1.5 ${delegated ? "border-l-accent bg-accent-soft/30" : ""} ${selected ? "bg-accent-soft" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${isMergeDropTarget ? "ring-2 ring-inset ring-accent" : ""}`}
        style={{ gridTemplateColumns: template, borderLeftColor: delegated ? undefined : priorityBarColor }}>
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
          {/* Fallback home for the done toggle: it normally rides in the Stage
              cell (see doneToggle below), but that column can be switched off
              in Columns & density, and losing one-click complete along with it
              would be a surprise. */}
          {!statusColShown && doneToggle}
          <button onClick={onToggleExpand} className={`shrink-0 rounded p-0.5 text-muted hover:text-foreground ${task.subtasks.length ? "" : "opacity-0 group-hover/tr:opacity-40"}`} title="Subtasks"><I.chevron className={`transition ${expanded ? "-rotate-90" : "rotate-180"}`} /></button>
          {/* Always visible (Derek, 2026-08-24): hiding it whenever the
              assignee was you left most rows on a client's own list with no
              assignee shown at all, since most tasks are assigned to the
              admin viewing the list. */}
          <InlineAssignee value={task.assigneeId} waiting={task.waitingOnClient} client={client} onChange={(a) => onPatch(task.id, { assigneeId: a, waitingOnClient: false })} onSetWaiting={() => onPatch(task.id, { waitingOnClient: true, assigneeId: null })} size={30} />
          {/* A real <button> here used to wrap InlineComments, which renders
              its own <button> trigger — invalid HTML (button-in-button),
              flagged live as a hydration error. role="button" on a <div>
              gets the same click/keyboard-activation semantics without
              nesting an interactive element inside another one. */}
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
            className="flex min-w-0 flex-1 cursor-pointer flex-col justify-center py-0.5 pl-1 text-left">
            {/* Two lines, and the title owns the first one outright. Every
                badge used to sit inline with it, so a narrow Name column (an
                iPad) squeezed the title to "Crea te..." while a "Start now"
                chip beside it kept its full width. Context and badges belong
                below the thing they describe, not in front of it. */}
            <span className="flex min-w-0 items-center gap-1.5">
              {delegated && <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Delegated</span>}
              {/* One line, ellipsed. It used to wrap to two (break-words plus
                  line-clamp-2), so on a narrow Name column every long title
                  cost a second row of height and the list stopped scanning as
                  a list. The full text is in the title attribute and the task
                  is one click away. */}
              <span className={`min-w-0 flex-1 truncate text-[15px] font-medium leading-snug ${isDone ? "text-muted line-through" : ""}`} title={task.title}>{task.title}</span>
            </span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
              {showCrumb && !showClient && crumb && <span className="min-w-0 truncate text-[11px] leading-tight text-muted">{crumb}</span>}
              {task.recurrence !== "none" && <span title={describeRecurrence(task.recurrence, task.recurrenceInterval, task.recurrenceUnit, task.recurrenceDaysOfMonth, task.recurrenceNth, task.recurrenceWeekday)}><I.repeat className="shrink-0 text-muted" /></span>}
              {task.attachments.length > 0 && <I.clip className="shrink-0 text-muted" />}
              {commentCount > 0 && <span onClick={(e) => e.stopPropagation()}><InlineComments task={task} onAddComment={onAddComment} /></span>}
              {task.subtasks.length > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted"><I.check />{doneSubs}/{task.subtasks.length}</span>}
            </span>
            {playbookStep?.youGet && task.status !== "done" && (
              <span className="block truncate text-[12px] text-muted" title={playbookStep.youGet}>📈 {playbookStep.youGet}</span>
            )}
          </div>
        </div>
        {/* On mobile these wrap into a chip row under the title (indented past
            the avatar); on sm+ `contents` dissolves the wrapper so each cell
            drops back into its own grid column. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-11 sm:contents sm:pl-0">
          {/* The client name is the obvious way to say "show me everything
              for these people", so it acts like one. stopPropagation keeps it
              from also opening the task behind it. */}
          {showClient && (
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
          )}
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
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 144, STATUS_ORDER.length * 32 + 8)); setOpen((o) => !o); }} className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[13px] font-medium hover:bg-background">
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
          column is sized for it in COL_WIDTHS. */}
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

function InlineComments({ task, onAddComment }: { task: Task; onAddComment: (taskId: string, body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const visible = task.comments.filter((c) => c.kind !== "event");
  const send = () => { if (!body.trim()) return; onAddComment(task.id, body); setBody(""); };
  return (
    <div className="relative flex justify-center">
      <button ref={ref} onClick={(e) => { e.stopPropagation(); setPos(menuPos(ref, 320, 360)); setOpen((o) => !o); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted hover:bg-background">
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
                    <CollapsibleText text={c.body} className="text-[14px]" />
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && <div className="py-4 text-center text-[13px] text-muted">No comments yet.</div>}
          </div>
          <div className="flex items-end gap-1.5 border-t p-2">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Write a team chat… (internal only)" rows={1} className="max-h-32 min-h-[32px] flex-1 resize-y rounded-lg border bg-background px-2 py-1.5 text-[14px] outline-none placeholder:text-muted" />
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

export function InlineDue({ value, overdue, followUpAt = null, recurrence = "none", recurrenceInterval, recurrenceUnit, recurrenceDaysOfMonth, recurrenceNth, recurrenceWeekday, onChange, onRecurrenceChange, emptyLabel = "—", strong = false, showRecurrenceLabel = false, showCountdown = true, formatValue = friendlyDue, textClass = "text-[11px]", toneClass }: { value: string | null; overdue: boolean; followUpAt?: string | null; recurrence?: Recurrence; recurrenceInterval?: number; recurrenceUnit?: import("@/lib/data").RecurrenceUnit; recurrenceDaysOfMonth?: number[]; recurrenceNth?: number; recurrenceWeekday?: number; onChange: (d: string | null) => void; onRecurrenceChange?: (r: Recurrence) => void; emptyLabel?: React.ReactNode; strong?: boolean; showRecurrenceLabel?: boolean; showCountdown?: boolean; formatValue?: (iso: string) => string; textClass?: string; toneClass?: string }) {
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
        {/* friendlyDue by default, which says "Mon" for anything inside a
            week — right for a list row. The drawer's dates band overrides it,
            because "Mon" beside an "Aug 27" created date in the very next
            column reads as two different kinds of thing. */}
        {value ? formatValue(value) : emptyLabel}
        {/* "how long have I got", beside the date rather than instead of it
            (Derek: "say hey you have this many days to get this done", then
            "make the countdown show further out than 14 days"). Always shown
            now; dueCountdown switches to months past ~2 out so a distant date
            stays short and doesn't compete with the genuinely urgent rows. */}
        {/* While it's snoozed the countdown answers the question you can
            actually act on — when it comes back — not how late the promise
            is, which you already know and can't do anything about today. */}
        {isSnoozed({ followUpAt }) ? (
          <span className="shrink-0 text-accent opacity-80">follow up {friendlyDue(followUpAt!)}</span>
        ) : value && showCountdown ? (
          // The drawer's dates band prints the countdown on its own sub-line,
          // so it turns this one off. Left on, the Due column read "Mon
          // 3 days left" with "3 days left" repeated directly underneath.
          <span className="shrink-0 opacity-70">{dueCountdown(value)}</span>
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

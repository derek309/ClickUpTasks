"use client";

// The ClickUp-style grouped list view: group headers, task rows, quick-add,
// expandable subtasks, and the inline cell editors (priority/assignee/due).
import { useRef, useState } from "react";
import {
  users, formatDue, isOverdue, TODAY,
  PRIORITY_META, PRIORITY_ORDER,
  type Task, type Priority, type Recurrence, type Client, type Project,
} from "@/lib/data";
import { I, Avatar, LabelChips, COL_WIDTHS, LIST_COLUMNS } from "./ui";

// --- grouped list view (ClickUp-style: group, quick-add, expandable subtasks) --

export function GroupedList({ groups, showClient, clientById, projectById, contactById, visibleCols, sortKey, sortDir, onSort, onOpen, onPatch, canQuickAdd, quickAddHint, onQuickAdd, onToggleSub, onAddSub }: {
  groups: { key: string; label: string; color: string; tasks: Task[] }[];
  showClient: boolean; clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null;
  visibleCols: string[]; sortKey: string; sortDir: "asc" | "desc"; onSort: (key: string) => void;
  onOpen: (id: string) => void; onPatch: (taskId: string, patch: Partial<Task>) => void; canQuickAdd: boolean; quickAddHint: string; onQuickAdd: (groupKey: string, title: string) => void;
  onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [subDraft, setSubDraft] = useState<Record<string, string>>({});
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [collapsedG, setCollapsedG] = useState<Set<string>>(new Set());
  const toggleG = (k: string) => setCollapsedG((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const cols = LIST_COLUMNS.filter((c) => visibleCols.includes(c.key));
  const template = ["54px", "minmax(0,1fr)", ...(showClient ? ["180px"] : []), ...cols.map((c) => COL_WIDTHS[c.key])].join(" ");
  const sortColKey: Record<string, string> = { title: "task", priority: "priority", due: "due", assignee: "assignee", status: "status", comments: "comments" };
  const activeCol = sortColKey[sortKey];
  const Arrow = ({ col }: { col: string }) => (activeCol === col ? <span className="text-accent">{sortDir === "asc" ? "↑" : "↓"}</span> : null);

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="grid items-center gap-2 border-b bg-background/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted" style={{ gridTemplateColumns: template }}>
          <span />
          <button onClick={() => onSort("task")} className="flex items-center gap-1 text-left hover:text-foreground">Name <Arrow col="task" /></button>
          {showClient && <span>Client</span>}
          {cols.map((c) => c.sortable
            ? <button key={c.key} onClick={() => onSort(c.key)} className="flex items-center gap-1 text-left hover:text-foreground">{c.label} <Arrow col={c.key} /></button>
            : <span key={c.key}>{c.label}</span>)}
        </div>
        {groups.map((g) => (
          <div key={g.key} className="border-b last:border-0">
            <button onClick={() => toggleG(g.key)} className="flex w-full items-center gap-2 px-4 pb-1.5 pt-4 text-left">
              <I.chevron className={`text-muted transition ${collapsedG.has(g.key) ? "rotate-180" : "-rotate-90"}`} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
              <span className="text-[15px] font-bold">{g.label}</span>
              <span className="rounded-full bg-background px-1.5 text-[13px] font-normal normal-case tracking-normal text-muted">{g.tasks.length}</span>
            </button>
            {!collapsedG.has(g.key) && (
              <div>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} template={template} cols={cols} showClient={showClient} clientById={clientById} projectById={projectById} contactById={contactById} onOpen={() => onOpen(t.id)} onPatch={onPatch}
                    expanded={expanded.has(t.id)} onToggleExpand={() => toggle(t.id)} onToggleSub={onToggleSub} onAddSub={onAddSub}
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
        {groups.length === 0 && <div className="px-4 py-10 text-center text-[15px] text-muted">No tasks yet.</div>}
      </div>
      {!canQuickAdd && quickAddHint && <div className="mt-3 text-center text-[15px] text-muted">{quickAddHint}</div>}
    </div>
  );
}

function TaskRow({ task, template, cols, showClient, clientById, projectById, contactById, onOpen, onPatch, expanded, onToggleExpand, onToggleSub, onAddSub, subDraft, setSubDraft }: {
  task: Task; template: string; cols: { key: string; label: string; sortable: boolean }[]; showClient: boolean;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null; onOpen: () => void; onPatch: (taskId: string, patch: Partial<Task>) => void;
  expanded: boolean; onToggleExpand: () => void; onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void;
  subDraft: string; setSubDraft: (v: string) => void;
}) {
  const client = clientById(task.clientId);
  const project = projectById(task.projectId);
  const overdue = isOverdue(task.due) && task.status !== "done";
  const doneSubs = task.subtasks.filter((x) => x.done).length;
  const crumb = project && project.name !== "Tasks" ? project.name : "";
  const cell = (key: string) => {
    if (key === "priority") return <InlinePriority value={task.priority} onChange={(p) => onPatch(task.id, { priority: p })} />;
    if (key === "assignee") return <InlineAssignee value={task.assigneeId} onChange={(a) => onPatch(task.id, { assigneeId: a })} />;
    if (key === "due") return <InlineDue value={task.due} overdue={overdue} recurrence={task.recurrence} onChange={(d) => onPatch(task.id, { due: d })} onRecurrenceChange={(r) => onPatch(task.id, { recurrence: r })} />;
    if (key === "comments") { const n = task.comments.filter((c) => c.kind !== "event").length; return n ? <span className="inline-flex items-center gap-1 text-[13px] text-muted"><I.comment /> {n}</span> : <I.comment className="text-muted opacity-30" />; }
    if (key === "contact") { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return <span className="truncate text-[15px] text-muted">{ct?.name ?? "—"}</span>; }
    if (key === "labels") return <LabelChips ids={task.labelIds} />;
    return null;
  };
  return (
    <>
      <div className="group/tr grid min-h-[46px] items-center gap-2 border-b px-4 py-2 transition-colors last:border-0 hover:bg-accent-soft/50" style={{ gridTemplateColumns: template }}>
        <div className="flex items-center">
          <button onClick={onToggleExpand} className={`rounded p-0.5 text-muted hover:text-foreground ${task.subtasks.length ? "" : "opacity-0 group-hover/tr:opacity-40"}`} title="Subtasks"><I.chevron className={`transition ${expanded ? "-rotate-90" : "rotate-180"}`} /></button>
          <InlineAssignee value={task.assigneeId} onChange={(a) => onPatch(task.id, { assigneeId: a })} />
        </div>
        <button onClick={onOpen} className="flex min-w-0 flex-col justify-center py-0.5 text-left">
          {crumb && <span className="truncate text-[13px] leading-tight text-muted">{crumb}</span>}
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 whitespace-normal break-words text-[17px] font-medium leading-snug">{task.title}</span>
            {task.recurrence !== "none" && <I.repeat className="shrink-0 text-muted" />}
            {task.attachments.length > 0 && <I.clip className="shrink-0 text-muted" />}
            {task.subtasks.length > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[15px] text-muted"><I.check />{doneSubs}/{task.subtasks.length}</span>}
          </span>
        </button>
        {showClient && <span className="flex min-w-0 items-center gap-1.5 text-[15px]"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: client?.color }} /><span className="truncate">{client?.name}</span></span>}
        {cols.map((c) => <div key={c.key} className="min-w-0">{cell(c.key)}</div>)}
      </div>
      {expanded && (
        <div className="border-b bg-background/40 py-1.5 pl-10 pr-3">
          {task.subtasks.map((st) => (
            <label key={st.id} className="flex cursor-pointer items-center gap-2 py-0.5">
              <button onClick={() => onToggleSub(task.id, st.id)} className={`flex h-4 w-4 items-center justify-center rounded border ${st.done ? "border-accent bg-accent text-white" : "border-border"}`}>{st.done && <I.check />}</button>
              <span className={`text-[15px] ${st.done ? "text-muted line-through" : ""}`}>{st.title}</span>
            </label>
          ))}
          <div className="flex items-center gap-2 py-0.5">
            <span className="h-4 w-4 shrink-0" />
            <input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAddSub(task.id, subDraft); setSubDraft(""); } }} placeholder="Add subtask…" className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          </div>
        </div>
      )}
    </>
  );
}

// --- inline cell editors ----------------------------------------------------

function InlinePriority({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[15px] font-medium hover:bg-background" style={{ color: value === "none" ? "var(--muted)" : PRIORITY_META[value].color }}>
        {value === "none" ? "—" : (<><I.flag />{PRIORITY_META[value].label}</>)}
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div className="absolute left-0 z-40 mt-1 w-32 rounded-lg border bg-surface p-1 shadow-lg">
          {PRIORITY_ORDER.map((p) => (
            <button key={p} onClick={(e) => { e.stopPropagation(); onChange(p); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[15px] hover:bg-background" style={{ color: p === "none" ? "var(--muted)" : PRIORITY_META[p].color }}>
              {p !== "none" && <I.flag />} {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}

function InlineAssignee({ value, onChange }: { value: string | null; onChange: (a: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="rounded-full hover:opacity-80"><Avatar id={value} size={22} /></button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div className="absolute left-0 z-40 mt-1 w-44 rounded-lg border bg-surface p-1 shadow-xl">
          <button onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[15px] text-muted hover:bg-background">Unassigned</button>
          {users.map((u) => (
            <button key={u.id} onClick={(e) => { e.stopPropagation(); onChange(u.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[15px] hover:bg-background"><Avatar id={u.id} size={20} /> {u.name}</button>
          ))}
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

function InlineDue({ value, overdue, recurrence, onChange, onRecurrenceChange }: { value: string | null; overdue: boolean; recurrence: Recurrence; onChange: (d: string | null) => void; onRecurrenceChange: (r: Recurrence) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const openIt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, Math.min(r.right - 440, window.innerWidth - 448));
      const top = r.bottom + 300 > window.innerHeight ? r.top - 304 : r.bottom + 4;
      setPos({ top, left });
    }
    setOpen(true);
  };
  return (
    <>
      <button ref={ref} onClick={openIt} className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[15px] hover:bg-background ${overdue ? "font-medium text-danger" : "text-muted"}`}>
        {value ? friendlyDue(value) : "—"}{recurrence !== "none" && <I.repeat className="text-accent" />}
      </button>
      {open && <DatePopover pos={pos} value={value} recurrence={recurrence} onSelect={(d) => { onChange(d); setOpen(false); }} onRecurrenceChange={onRecurrenceChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function DatePopover({ pos, value, recurrence, onSelect, onRecurrenceChange, onClose }: { pos: { top: number; left: number }; value: string | null; recurrence: Recurrence; onSelect: (d: string | null) => void; onRecurrenceChange: (r: Recurrence) => void; onClose: () => void }) {
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
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: pos.top, left: pos.left, width: 440 }} className="z-50 flex rounded-xl border bg-surface shadow-xl">
        <div className="w-52 shrink-0 border-r p-1.5">
          {quicks.map(([label, iso]) => (
            <button key={label} onClick={() => onSelect(iso)} className="flex w-full items-center justify-between gap-3 whitespace-nowrap rounded px-2 py-1.5 text-left text-[15px] hover:bg-background"><span>{label}</span><span className="text-[15px] text-muted">{formatDue(iso)}</span></button>
          ))}
          <button onClick={() => onSelect(null)} className="mt-0.5 w-full rounded px-2 py-1.5 text-left text-[15px] text-danger hover:bg-background">No date</button>
          <div className="mt-1 border-t pt-1.5">
            <div className="px-2 pb-1 text-[15px] font-semibold uppercase tracking-wide text-muted">Repeat</div>
            <select value={recurrence} onClick={(e) => e.stopPropagation()} onChange={(e) => onRecurrenceChange(e.target.value as Recurrence)} className="w-full rounded border bg-background px-1.5 py-1 text-[15px] outline-none">
              <option value="none">Doesn&apos;t repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
        <div className="flex-1 p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[15px] font-semibold">{MO[ym.m]} {ym.y}</span>
            <span className="flex gap-0.5"><button onClick={() => shift(-1)} className="rounded px-1 text-muted hover:bg-background">‹</button><button onClick={() => shift(1)} className="rounded px-1 text-muted hover:bg-background">›</button></span>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[15px] text-muted">{WD.map((w) => <span key={w} className="py-0.5">{w}</span>)}</div>
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

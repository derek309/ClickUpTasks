"use client";

// A list with its Queue switch on (mcp/queue.mjs, mockup: CUL Tasks/
// queue-mockup.html): Now, Waiting, Up next ("2nd", "3rd", no dates) and
// done. Drag a row to change the order; on a phone, tap a row's grip, then
// the row it goes before. Moving someone else's task asks why and tells them.
// It reads only what it is handed: the list's tasks and its setting.

import * as React from "react";
import { CLAUDE_ID, currentStep, formatDue, needsYou, stepStage, userById, type Task } from "@/lib/data";
import { deadlineWarnings, groupQueue, isQueueWaiting, type QueueSettings } from "../../../mcp/queue.mjs";

type Pending = { id: string; beforeId: string | null; up: boolean; moveUp?: boolean };

export function QueueList({ name, tasks, settings, meId, clientFirst, today, onOpen, onMove, onMoveUp, onSettings }: {
  name: string;
  /** Every task on the list, done ones too. */
  tasks: Task[];
  settings: QueueSettings;
  meId: string;
  clientFirst: string;
  today: string;
  onOpen: (id: string) => void;
  onMove: (id: string, beforeId: string | null, reason?: string) => void;
  onMoveUp: (id: string, reason?: string) => void;
  onSettings: (next: QueueSettings) => void;
}) {
  const g = React.useMemo(() => groupQueue(tasks, settings), [tasks, settings]);
  const warnings = React.useMemo(() => deadlineWarnings(tasks, settings, today), [tasks, settings, today]);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [reason, setReason] = React.useState("");
  const [allNext, setAllNext] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  const order = [...g.now, ...g.waiting, ...g.upNext.map((u) => u.task)];
  const byId = (id: string) => tasks.find((t) => t.id === id) ?? null;
  const theirs = (t: Task) => !!t.assigneeId && t.assigneeId !== meId && t.assigneeId !== CLAUDE_ID;

  // A move: someone else's task asks for a reason first.
  const ask = (id: string, beforeId: string | null) => {
    setDragId(null); setOverId(null); setPicked(null);
    if (id === beforeId) return;
    const t = byId(id);
    if (!t) return;
    const from = order.findIndex((x) => x.id === id);
    const to = beforeId ? order.findIndex((x) => x.id === beforeId) : order.length;
    if (to === from || to === from + 1) return;
    if (theirs(t)) { setReason(""); setPending({ id, beforeId, up: to < from }); return; }
    onMove(id, beforeId);
  };
  const askMoveUp = (id: string) => {
    const t = byId(id);
    if (t && theirs(t)) { setReason(""); setPending({ id, beforeId: null, up: true, moveUp: true }); return; }
    onMoveUp(id);
  };
  const confirm = () => {
    if (!pending || !reason.trim()) return;
    if (pending.moveUp) onMoveUp(pending.id, reason.trim());
    else onMove(pending.id, pending.beforeId, reason.trim());
    setPending(null); setReason("");
  };

  // Whose turn, said the way the task page says it (TaskDrawer stepTone).
  const turn = (t: Task): { text: string; tone: "mine" | "wait" | "claude" | "plain" } => {
    const need = needsYou(t, meId, clientFirst);
    if (need) return { text: need, tone: "mine" };
    const cur = currentStep(t.subtasks);
    const person = cur?.assigneeId ?? t.assigneeId;
    if (cur?.assigneeId === CLAUDE_ID) return { text: "Claude's turn", tone: "claude" };
    if (t.waitingOnClient || (cur && (cur.onClient || cur.finishWhen === "reply" || stepStage(cur, t.assigneeId) === "waiting"))) return { text: `${clientFirst}'s turn${cur ? `: ${cur.title}` : ""}`, tone: "wait" };
    if (person && person !== meId) return { text: `${userById(person)?.name.split(" ")[0] ?? "A teammate"}'s turn${cur ? `: ${cur.title}` : ""}`, tone: isQueueWaiting(t) ? "wait" : "plain" };
    return { text: `Your turn${cur ? `: ${cur.title}` : ""}`, tone: "mine" };
  };
  const TONE = { mine: "text-red-700", wait: "text-amber-800", claude: "text-orange-700", plain: "text-muted" } as const;

  const row = (t: Task, right: React.ReactNode, showTurn: boolean) => {
    const tn = showTurn ? turn(t) : null;
    const need = !showTurn && needsYou(t, meId, clientFirst);
    return (
      <div key={t.id}
        draggable
        onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }}
        onDragEnd={() => { setDragId(null); setOverId(null); }}
        onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(t.id); } }}
        onDrop={(e) => { e.preventDefault(); if (dragId) ask(dragId, t.id); }}
        className={`grid grid-cols-[28px_1fr] items-center gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[28px_1fr_auto] ${dragId === t.id ? "opacity-40" : ""} ${overId === t.id && dragId !== t.id ? "shadow-[inset_0_3px_0_var(--accent)]" : ""} ${picked === t.id ? "bg-accent-soft" : ""}`}>
        <button type="button" onClick={() => (picked && picked !== t.id ? ask(picked, t.id) : setPicked(picked === t.id ? null : t.id))}
          aria-label={picked && picked !== t.id ? `Put it before ${t.title}` : `Move ${t.title}`} title="Drag to move, or tap here and then the row it goes before"
          className="flex h-11 w-7 cursor-grab items-center justify-center rounded-[5px] text-[16px] font-bold tracking-[-2px] text-muted hover:text-foreground active:cursor-grabbing">⋮⋮</button>
        <button type="button" onClick={() => (picked && picked !== t.id ? ask(picked, t.id) : onOpen(t.id))} className="min-w-0 text-left">
          <span className="block break-words text-[16px] font-semibold">{t.title}</span>
          {tn && <span className={`block text-[16px] font-semibold ${TONE[tn.tone]}`}>{tn.text}</span>}
          {need && <span className="block text-[16px] font-semibold text-red-700">{need}</span>}
        </button>
        <span className="col-start-2 text-[16px] sm:col-start-3 sm:text-right">{right}</span>
      </div>
    );
  };

  const group = (key: string, label: string, dot: string, head: string, count: number, body: React.ReactNode) => (
    <section key={key} className="mb-4 overflow-hidden rounded-[5px] border bg-surface">
      <div className="flex items-center gap-2.5 border-b px-4 py-3 text-[16px] font-bold" style={{ background: head }}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />{label} <span className="font-semibold text-muted">{count}</span>
      </div>
      {body}
    </section>
  );

  const SHOW_NEXT = 5;
  const nextShown = allNext ? g.upNext : g.upNext.slice(0, SHOW_NEXT);
  const finished = [...g.done].sort((a, b) => doneAt(b).localeCompare(doneAt(a))).slice(0, 5);

  return (
    <div className="bg-background p-4 sm:p-5">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[16px] text-muted">{tasks.filter((t) => t.status !== "done").length} in {name}, {settings.now} at a time. Drag to change the order.</p>
          {editing ? (
            <QueueSettingsForm settings={settings} onSave={(q) => { onSettings(q); setEditing(false); }} onCancel={() => setEditing(false)} />
          ) : (
            <p className="text-[16px]"><b>Queue</b> <span className="text-muted">· {settings.now} at a time · next one due {settings.spacing} business {settings.spacing === 1 ? "day" : "days"} out</span>{" "}
              <button type="button" onClick={() => setEditing(true)} className="font-semibold text-accent underline underline-offset-4 hover:opacity-80">Change</button></p>
          )}
        </div>

        {pending && (() => {
          const t = byId(pending.id);
          const owner = t?.assigneeId ? userById(t.assigneeId)?.name.split(" ")[0] ?? null : null;
          return (
            <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="mb-4 rounded-[5px] border bg-surface px-4 py-3">
              <label htmlFor="queue-reason" className="block text-[16px] font-semibold">{t?.title} is {owner ? `${owner}'s` : "a teammate's"}. Why move it {pending.up ? "up" : "down"}? {owner ?? "They"} will see this.</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <input id="queue-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={140} placeholder="A short reason"
                  className="h-11 min-w-0 flex-1 basis-full rounded-[5px] border bg-background px-3 text-[16px] outline-none focus:ring-2 focus:ring-accent sm:basis-auto" />
                <button type="submit" disabled={!reason.trim()} className="h-11 rounded-[5px] bg-foreground px-4 text-[16px] font-semibold text-background disabled:opacity-40">Move it</button>
                <button type="button" onClick={() => setPending(null)} className="h-11 px-2 text-[16px] font-semibold text-muted hover:text-foreground">Cancel</button>
              </div>
            </form>
          );
        })()}

        {picked && (
          <p className="mb-4 rounded-[5px] border bg-accent-soft px-4 py-3 text-[16px]">Moving <b>{byId(picked)?.title}</b>. Tap the grip of the row it goes before, or{" "}
            <button type="button" onClick={() => ask(picked, null)} className="font-semibold text-accent underline underline-offset-4">put it last</button>{" "}
            <button type="button" onClick={() => setPicked(null)} className="font-semibold text-muted underline underline-offset-4">cancel</button></p>
        )}

        {group("now", "Now", "#2563eb", "color-mix(in srgb, #2563eb 10%, var(--surface))", g.now.length,
          g.now.length ? g.now.map((t) => row(t, t.due ? <span className={`whitespace-nowrap font-semibold ${t.deadline ? "text-red-700" : "text-orange-700"}`}>{t.deadline ? "Deadline" : "Due"} {formatDue(t.due)}</span> : null, true))
            : <p className="px-4 py-3 text-[16px] text-muted">Nothing is Now. The next one comes up when something is added.</p>)}

        {g.waiting.length > 0 && group("waiting", "Waiting", "#b7791f", "color-mix(in srgb, #b7791f 10%, var(--surface))", g.waiting.length,
          g.waiting.map((t) => { const at = t.followUpAt ?? t.due; return row(t, at ? <span className="whitespace-nowrap text-muted">Check in {formatDue(at)}</span> : null, true); }))}

        {group("next", "Up next", "#9aa5b8", "color-mix(in srgb, #9aa5b8 12%, var(--surface))", g.upNext.length, <>
          {warnings.map((w) => (
            <p key={w.id} className="mx-4 my-3 rounded-[5px] bg-red-50 px-3 py-2.5 text-[16px] font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {w.title} is due {formatDue(w.deadline)}. At this pace it lands {formatDue(w.lands)}. Move it up?{" "}
              <button type="button" onClick={() => askMoveUp(w.id)} className="underline underline-offset-4 hover:opacity-80">Move it up</button>
            </p>
          ))}
          {nextShown.map((u) => row(u.task, u.task.deadline && u.task.due
            ? <span className="whitespace-nowrap font-bold text-red-700">Deadline {formatDue(u.task.due)}</span>
            : <span className="whitespace-nowrap text-muted">{u.label}</span>, false))}
          {!g.upNext.length && <p className="px-4 py-3 text-[16px] text-muted">Nothing waiting in line.</p>}
          {g.upNext.length > SHOW_NEXT && (
            <button type="button" onClick={() => setAllNext((v) => !v)} className="w-full border-t px-4 py-3 text-left text-[16px] font-semibold text-accent hover:bg-background">
              {allNext ? "Show fewer" : `Show ${g.upNext.length - SHOW_NEXT} more`}
            </button>
          )}
          {dragId && (
            <div onDragOver={(e) => { e.preventDefault(); setOverId("__end"); }} onDrop={(e) => { e.preventDefault(); ask(dragId, null); }}
              className={`border-t px-4 py-3 text-[16px] text-muted ${overId === "__end" ? "shadow-[inset_0_3px_0_var(--accent)]" : ""}`}>Drop here for the end of the line</div>
          )}
        </>)}

        {finished.map((t) => (
          <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="block py-1 text-left text-[16px] font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
            ✓ {t.title}{doneAt(t) ? ` · done ${formatDue(doneAt(t).slice(0, 10))}` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

/** When it was finished: its "Task done" step. */
function doneAt(t: Task): string {
  return t.subtasks.find((s) => s.addedFor === "finished")?.doneAt ?? "";
}

function QueueSettingsForm({ settings, onSave, onCancel }: { settings: QueueSettings; onSave: (q: QueueSettings) => void; onCancel: () => void }) {
  const [now, setNow] = React.useState(String(settings.now));
  const [spacing, setSpacing] = React.useState(String(settings.spacing));
  const field = "h-11 w-16 rounded-[5px] border bg-background px-2 text-center text-[16px] outline-none focus:ring-2 focus:ring-accent";
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ now: Number(now) || 1, spacing: Number(spacing) || 0 }); }} className="flex flex-wrap items-center gap-2 text-[16px]">
      <label className="flex items-center gap-2"><input type="number" min={1} max={10} value={now} onChange={(e) => setNow(e.target.value)} className={field} /> at a time</label>
      <label className="flex items-center gap-2">next one due <input type="number" min={0} max={30} value={spacing} onChange={(e) => setSpacing(e.target.value)} className={field} /> business days out</label>
      <button type="submit" className="h-11 rounded-[5px] bg-foreground px-4 font-semibold text-background">Save</button>
      <button type="button" onClick={onCancel} className="h-11 px-2 font-semibold text-muted hover:text-foreground">Cancel</button>
    </form>
  );
}

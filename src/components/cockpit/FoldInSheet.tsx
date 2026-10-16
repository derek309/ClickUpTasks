"use client";

// Fold in (Derek, 2026-10-15): the review sheet for the client's older tasks
// that are only flagged waiting on them. Each row, grouped by list, has the
// ask written for us (lib/foldIn askFromTaskTitle) to edit, a tick (on), and
// the fresh need by date it gets: the first 3 business days out, each next 2
// more, down the ticked ones in order. One dark button adds them, one task
// at a time, with the count as it goes. A sheet along the bottom on a phone,
// a panel in the middle elsewhere.
import { useState } from "react";
import { formatDayDate } from "@/lib/data";
import { askFromTaskTitle, foldInNeedBys, type FoldInPick } from "@/lib/foldIn";
import { useEscapeToClose } from "./useEscapeToClose";

export type FoldInRow = { taskId: string; title: string; listId: string | null; notes: string | null };

export function FoldInSheet({ first, rows, today, listName, onAdd, onClose }: {
  first: string;
  /** In order: grouped by list, each by due date (lib/foldIn foldInTasks). */
  rows: FoldInRow[];
  today: string;
  listName: (listId: string | null) => string | null;
  /** Adds them one at a time; resolves when the last is saved. */
  onAdd: (picks: FoldInPick[], onProgress: (done: number, total: number) => void) => Promise<void>;
  onClose: () => void;
}) {
  const [asks, setAsks] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.taskId, askFromTaskTitle(r.title, { first, notes: r.notes })])));
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = !!progress;
  useEscapeToClose(() => { if (!busy) onClose(); }, true);
  const picked = rows.filter((r) => !off.has(r.taskId) && (asks[r.taskId] ?? "").trim());
  const dates = foldInNeedBys(picked.length, today);
  const needBy = new Map(picked.map((r, i) => [r.taskId, dates[i]]));
  const lists: (string | null)[] = [];
  for (const r of rows) if (!lists.includes(r.listId)) lists.push(r.listId);
  const add = async () => {
    if (!picked.length || busy) return;
    setProgress({ done: 0, total: picked.length });
    try {
      await onAdd(picked.map((r) => ({ taskId: r.taskId, ask: asks[r.taskId].trim(), needBy: needBy.get(r.taskId)! })), (done, total) => setProgress({ done, total }));
    } finally {
      setProgress(null);
    }
    onClose();
  };
  const toggle = (id: string) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={() => { if (!busy) onClose(); }} />
      <div role="dialog" aria-label={`Add older tasks to ${first}'s list`}
        className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[90vh] flex-col rounded-t-[5px] bg-surface text-foreground shadow-[var(--shadow-md)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[6vh] sm:w-[min(720px,calc(100vw-32px))] sm:-translate-x-1/2 sm:rounded-[5px]">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <b className="min-w-0 flex-1 text-[18px] [overflow-wrap:anywhere]">Add to {first}&apos;s list</b>
          <button onClick={onClose} disabled={busy} className="h-10 shrink-0 rounded-[5px] px-3 text-[16px] font-semibold ring-1 ring-inset ring-[var(--border)] hover:bg-background disabled:opacity-40">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
          <p className="text-[16px] text-muted">Each one gets a step for {first} with its need by date. Edit the words first. Nothing is emailed: every reminder waits for review.</p>
          {lists.map((l) => {
            const group = rows.filter((r) => r.listId === l);
            return (
              <div key={l ?? "none"} className="mt-3 overflow-hidden rounded-[5px] ring-1 ring-inset ring-[var(--border)]">
                <div className="border-b bg-background px-3 py-2 text-[16px] font-bold [overflow-wrap:anywhere]">{listName(l) ?? "No list"} <span className="font-semibold opacity-80">{group.length}</span></div>
                {group.map((r) => {
                  const on = !off.has(r.taskId);
                  const date = needBy.get(r.taskId);
                  return (
                    <div key={r.taskId} className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-2 border-b px-2 py-2.5 last:border-b-0">
                      <label className="flex h-10 w-10 cursor-pointer items-center justify-center">
                        <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(r.taskId)} aria-label={`Add ${r.title}`} className="h-5 w-5 accent-[var(--foreground)]" />
                      </label>
                      <div className={`min-w-0 ${on ? "" : "opacity-50"}`}>
                        <span className="block text-[16px] text-muted [overflow-wrap:anywhere]">{r.title}</span>
                        <textarea value={asks[r.taskId] ?? ""} disabled={busy || !on} rows={2} aria-label={`What we ask ${first} for ${r.title}`}
                          onChange={(e) => { const v = e.target.value; setAsks((a) => ({ ...a, [r.taskId]: v })); }}
                          className="mt-1 block w-full resize-y rounded-[5px] bg-surface px-2.5 py-2 text-[16px] font-semibold leading-snug ring-1 ring-inset ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                        <span className="mt-1 block text-[16px] text-muted">{on ? (date ? `Need by ${formatDayDate(date)}` : "Write what we ask to add it") : "Left out"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
          <button onClick={onClose} disabled={busy} className="h-11 rounded-[5px] px-4 text-[16px] font-semibold ring-1 ring-inset ring-[var(--border)] hover:bg-background disabled:opacity-40">Cancel</button>
          <button onClick={() => void add()} disabled={busy || !picked.length} className="h-11 rounded-[5px] bg-foreground px-4 text-[16px] font-semibold text-background disabled:opacity-40">
            {progress ? `Adding ${Math.max(1, progress.done)} of ${progress.total}` : `Add ${picked.length} to ${first}'s list`}
          </button>
        </div>
      </div>
    </>
  );
}

"use client";

// What we need from a client (Derek and Justin, 2026-10-15, mockup part 2):
// one list across all their lists, from the waiting card's "N waiting on
// Brian". Grouped Overdue, Today, This week, Later (undated last); each row
// says its list and how often we asked; the top one with reminders on is the
// one being chased. Drag a row inside its group to change the order (saved
// as the step's clientOrder), or, on a phone where dragging doesn't work,
// tap its ⋮⋮ for Move to top, Up one, Down one, To bottom; click one to
// open its step. A sheet along the
// bottom on a phone, a panel in the middle elsewhere. Older tasks only flagged
// waiting on them show as one line at the top, "Add them" (FoldInSheet).
import { useState } from "react";
import { createPortal } from "react-dom";
import { formatDayDate, formatDue, toPacificDate } from "@/lib/data";
import { GROUP_LABEL, chasedRequest, expectedDoneLine, daysLate, orderRequests, reorderedClientOrder, requestGroup, type ClientRequest, type RequestGroup } from "@/lib/clientRequests";
import { useEscapeToClose } from "./useEscapeToClose";
import { useAsked, type AskedEntry } from "./AskedLog";
import { MenuSheet } from "./ActionMenu";
import { FoldInSheet, type FoldInRow } from "./FoldInSheet";
import type { FoldInPick } from "@/lib/foldIn";

const GROUPS: RequestGroup[] = ["overdue", "today", "week", "later"];
const GROUP_TONE: Record<RequestGroup, string> = { overdue: "bg-danger-soft text-danger", today: "bg-highlight-soft text-highlight", week: "bg-background", later: "bg-background" };

export function ClientRequestsList({ clientId, first, requests, today, listName, asked: given, foldIn = [], onFoldIn, onOpenStep, onReorder, onClose }: {
  clientId: string;
  first: string;
  requests: ClientRequest[];
  today: string;
  listName: (listId: string | null) => string | null;
  /** What went about each step; read here when not given. */
  asked?: Record<string, AskedEntry[]>;
  /** Their older tasks flagged waiting with no step for them, in order (lib/foldIn). */
  foldIn?: FoldInRow[];
  /** Adds the picked ones to this list, one task at a time. */
  onFoldIn?: (picks: FoldInPick[], onProgress: (done: number, total: number) => void) => Promise<void>;
  onOpenStep: (taskId: string, stepId: string) => void;
  onReorder: (changes: { taskId: string; stepId: string; clientOrder: number }[]) => void;
  onClose: () => void;
}) {
  // The fold in sheet over this list.
  const [folding, setFolding] = useState(false);
  useEscapeToClose(onClose, true);
  const fetched = useAsked(given ? null : clientId, given ? [] : requests.map((r) => r.stepId));
  const asked = given ?? fetched;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // The row whose ⋮⋮ was tapped: its move sheet is open.
  const [moveId, setMoveId] = useState<string | null>(null);
  useEscapeToClose(() => setMoveId(null), !!moveId);
  const ordered = orderRequests(requests, today);
  const chased = chasedRequest(ordered)?.stepId ?? null;
  // A task whose expected date moved because a request on it is late.
  const moved = requests.filter((r) => r.expectedFrom && r.taskDue && r.taskDue > r.expectedFrom);
  const move = (group: ClientRequest[], fromId: string, toId: string) => {
    if (fromId === toId) return;
    const changes = reorderedClientOrder(group, fromId, toId);
    if (changes.length) onReorder(changes.map((c) => ({ ...c, taskId: group.find((g) => g.stepId === c.stepId)!.taskId })));
  };
  const drop = (group: ClientRequest[], toId: string) => { if (dragId) move(group, dragId, toId); };
  // The move sheet: the tapped row's place in its own group.
  const moveGroup = moveId ? ordered.filter((r) => requestGroup(r.needBy, today) === requestGroup(ordered.find((x) => x.stepId === moveId)?.needBy ?? null, today)) : [];
  const moveAt = moveGroup.findIndex((r) => r.stepId === moveId);
  const moveItems = moveAt < 0 ? [] : [
    { label: "Move to top", to: 0 },
    { label: "Up one", to: moveAt - 1 },
    { label: "Down one", to: moveAt + 1 },
    { label: "To bottom", to: moveGroup.length - 1 },
  ].map((m) => ({ ...m, off: m.to < 0 || m.to >= moveGroup.length || m.to === moveAt }));
  const when = (r: ClientRequest, g: RequestGroup) => {
    if (g === "overdue") { const n = daysLate(r.needBy, today); return <span className="font-bold text-danger">{n ? `${n} ${n === 1 ? "day" : "days"} late` : "Late"}</span>; }
    if (g === "today") return <span className="font-bold text-highlight">Due today</span>;
    return <span className="text-muted">{r.needBy ? formatDayDate(r.needBy) : "In line"}</span>;
  };
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-label={`What we need from ${first}`}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-[5px] bg-surface text-foreground shadow-[var(--shadow-md)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8vh] sm:w-[min(720px,calc(100vw-32px))] sm:-translate-x-1/2 sm:rounded-[5px]">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <b className="min-w-0 flex-1 text-[18px]">What we need from {first} <span className="font-semibold text-muted">· {ordered.length}</span></b>
          <button onClick={onClose} className="h-10 shrink-0 rounded-[5px] px-3 text-[16px] font-semibold ring-1 ring-inset ring-[var(--border)] hover:bg-background">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
          {foldIn.length > 0 && onFoldIn && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[5px] bg-highlight-soft px-3 py-2">
              <span className="min-w-0 flex-1 text-[16px] [overflow-wrap:anywhere]">
                {foldIn.length} older {foldIn.length === 1 ? "task is" : "tasks are"} waiting on {first} but {foldIn.length === 1 ? "isn't" : "aren't"} in this list.
              </span>
              <button onClick={() => setFolding(true)} className="h-10 shrink-0 rounded-[5px] bg-surface px-3 text-[16px] font-semibold ring-1 ring-inset ring-[var(--border)] hover:bg-background">
                {foldIn.length === 1 ? "Add it" : "Add them"}
              </button>
            </div>
          )}
          {moved.map((r) => (
            <div key={r.stepId} className="mb-2 rounded-[5px] bg-accent-soft px-3 py-2 text-[16px] [overflow-wrap:anywhere]">{expectedDoneLine(r.taskTitle, r.expectedFrom!, r.taskDue!)}</div>
          ))}
          {!ordered.length && !foldIn.length && <p className="text-[16px] text-muted">Nothing is waiting on {first}.</p>}
          {GROUPS.map((g) => {
            const rows = ordered.filter((r) => requestGroup(r.needBy, today) === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="mt-3 overflow-hidden rounded-[5px] ring-1 ring-inset ring-[var(--border)]">
                <div className={`flex items-center gap-2 border-b px-3 py-2 text-[16px] font-bold ${GROUP_TONE[g]}`}>{GROUP_LABEL[g]} <span className="font-semibold opacity-80">{rows.length}</span></div>
                {rows.map((r) => {
                  const list = asked[r.stepId] ?? [];
                  const times = list.filter((e) => e.status === "sent").length;
                  const since = r.startedAt ? toPacificDate(r.startedAt) : list[0] ? toPacificDate(list[0].at) : null;
                  return (
                    <div key={r.stepId} draggable onDragStart={(e) => { setDragId(r.stepId); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragId(null); setOverId(null); }}
                      onDragOver={(e) => { if (dragId && rows.some((x) => x.stepId === dragId)) { e.preventDefault(); setOverId(r.stepId); } }}
                      onDrop={(e) => { e.preventDefault(); drop(rows, r.stepId); setDragId(null); setOverId(null); }}
                      className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2.5 last:border-b-0 ${overId === r.stepId && dragId !== r.stepId ? "bg-accent-soft" : ""} ${dragId === r.stepId ? "opacity-50" : ""}`}>
                      <button type="button" onClick={() => setMoveId(r.stepId)} aria-label={`Move ${r.title}`} title="Drag, or tap to move"
                        className="-mx-2 -my-2 flex h-10 w-9 cursor-grab select-none items-center justify-center rounded-[5px] text-[16px] font-bold tracking-[-2px] text-muted hover:bg-background">⋮⋮</button>
                      <button onClick={() => onOpenStep(r.taskId, r.stepId)} className="min-w-0 text-left">
                        <span className="block text-[16px] font-semibold [overflow-wrap:anywhere]">{r.title}{r.stepId === chased && <span className="ml-2 font-bold text-accent">being chased</span>}</span>
                        <span className="block text-[16px] text-muted [overflow-wrap:anywhere]">{[listName(r.listId) ?? r.taskTitle, times ? `asked ${times} ${times === 1 ? "time" : "times"}${since ? ` since ${formatDue(since)}` : ""}` : since ? `since ${formatDue(since)}` : null].filter(Boolean).join(" · ")}</span>
                      </button>
                      <span className="whitespace-nowrap text-right text-[16px]">{when(r, g)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {folding && onFoldIn && (
        <FoldInSheet first={first} rows={foldIn} today={today} listName={listName} onAdd={onFoldIn} onClose={() => setFolding(false)} />
      )}
      {moveId && moveAt >= 0 && typeof document !== "undefined" && createPortal(
        <MenuSheet label={`Move ${moveGroup[moveAt].title}`} onClose={() => setMoveId(null)} everywhere>
          <div className="px-3 pb-1 pt-2 text-[16px] font-semibold text-muted [overflow-wrap:anywhere]">{moveGroup[moveAt].title}</div>
          {moveItems.map((m) => (
            <button key={m.label} role="menuitem" disabled={m.off}
              onClick={() => { const from = moveGroup[moveAt].stepId; setMoveId(null); move(moveGroup, from, moveGroup[m.to].stepId); }}
              className="block h-12 w-full rounded-[5px] px-3 text-left text-[16px] hover:bg-background disabled:opacity-40">
              {m.label}
            </button>
          ))}
        </MenuSheet>,
        document.body,
      )}
    </>
  );
}

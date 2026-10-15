"use client";

// What we need from a client (Derek and Justin, 2026-10-15, mockup part 2):
// one list across all their lists, from the waiting card's "N waiting on
// Brian". Grouped Overdue, Today, This week, Later (undated last); each row
// says its list and how often we asked; the top one with reminders on is the
// one being chased. Drag a row inside its group to change the order (saved
// as the step's clientOrder); click one to open its step. A sheet along the
// bottom on a phone, a panel in the middle elsewhere.
import { useState } from "react";
import { formatDayDate, formatDue, toPacificDate } from "@/lib/data";
import { GROUP_LABEL, chasedRequest, daysLate, orderRequests, reorderedClientOrder, requestGroup, type ClientRequest, type RequestGroup } from "@/lib/clientRequests";
import { useEscapeToClose } from "./useEscapeToClose";
import { useAsked, type AskedEntry } from "./AskedLog";

const GROUPS: RequestGroup[] = ["overdue", "today", "week", "later"];
const GROUP_TONE: Record<RequestGroup, string> = { overdue: "bg-danger-soft text-danger", today: "bg-highlight-soft text-highlight", week: "bg-background", later: "bg-background" };

export function ClientRequestsList({ clientId, first, requests, today, listName, asked: given, onOpenStep, onReorder, onClose }: {
  clientId: string;
  first: string;
  requests: ClientRequest[];
  today: string;
  listName: (listId: string | null) => string | null;
  /** What went about each step; read here when not given. */
  asked?: Record<string, AskedEntry[]>;
  onOpenStep: (taskId: string, stepId: string) => void;
  onReorder: (changes: { taskId: string; stepId: string; clientOrder: number }[]) => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose, true);
  const fetched = useAsked(given ? null : clientId, given ? [] : requests.map((r) => r.stepId));
  const asked = given ?? fetched;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ordered = orderRequests(requests, today);
  const chased = chasedRequest(ordered)?.stepId ?? null;
  // A task whose expected date moved because a request on it is late.
  const moved = requests.filter((r) => r.expectedFrom && r.taskDue && r.taskDue > r.expectedFrom);
  const drop = (group: ClientRequest[], toId: string) => {
    if (!dragId || dragId === toId) return;
    const changes = reorderedClientOrder(group, dragId, toId);
    onReorder(changes.map((c) => ({ ...c, taskId: group.find((g) => g.stepId === c.stepId)!.taskId })));
  };
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
          {moved.map((r) => (
            <div key={r.stepId} className="mb-2 rounded-[5px] bg-accent-soft px-3 py-2 text-[16px]">Expected done: <b>{r.taskTitle}</b> {formatDue(r.expectedFrom!)} → {formatDue(r.taskDue!)}</div>
          ))}
          {!ordered.length && <p className="text-[16px] text-muted">Nothing is waiting on {first}.</p>}
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
                      className={`grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2.5 last:border-b-0 ${overId === r.stepId && dragId !== r.stepId ? "bg-accent-soft" : ""} ${dragId === r.stepId ? "opacity-50" : ""}`}>
                      <span aria-hidden title="Drag to change the order" className="cursor-grab select-none text-[16px] font-bold tracking-[-2px] text-muted">⋮⋮</span>
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
    </>
  );
}

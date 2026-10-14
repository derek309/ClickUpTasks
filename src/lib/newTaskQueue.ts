// The new task box on a queue list (Derek, 2026-10-14): instead of a due date
// and a follow up, the sentence says where the task joins the line, "On me,
// Normal, joins the line at the bottom (9th)", and the last words are a
// picker: now, next up or at the bottom. A deadline is the one date it can
// carry ("deadline Oct 30").
//
// Pure: the list's tasks, its queue settings and today in, words and places
// out. The placing itself is mcp/queue.mjs queueEntry, the same rule as a task
// moved into the list, then the Now check (queuePromotions).
import { formatDue } from "./data";
import { entryRank, groupQueue, queueEntry, queuePromotions, type QPatch, type QTask, type QueueSettings } from "../../mcp/queue.mjs";

export type QueueAt = "now" | "next" | "bottom";

/** Where a task of this priority joins when nobody picks: an urgent one, a
 *  client request or an interaction near the top (next up), the rest at the
 *  bottom. The same rule as queueEntry's own (entryIndex). */
export function defaultQueueAt(priority: string | undefined): QueueAt {
  return entryRank(priority) === "normal" ? "bottom" : "next";
}

/** The new task's queue fields and any other task's place that had to move
 *  (only when the line had no room and was renumbered), after the Now check:
 *  "now" is dated today and first in line; the others get a date only if the
 *  line had a free Now slot. `at` null follows the priority. */
export function placeNewTask(list: QTask[], settings: QueueSettings, task: QTask, at: QueueAt | null, today: string): { self: QPatch; others: QPatch[] } {
  const e = queueEntry(list, settings, task, at ? { at } : {});
  const self: QPatch = { ...e.self };
  if (at === "now") { self.due = task.deadline && task.due ? task.due : today; self.queueSavedDue = null; }
  const others = new Map(e.others.map((p) => [p.id, p]));
  const after = [
    ...list.filter((t) => t.id !== task.id).map((t) => { const p = others.get(t.id); return p ? { ...t, ...defined(p) } : t; }),
    { ...task, ...defined(self) },
  ];
  for (const p of queuePromotions(after, settings, today)) {
    if (p.id === task.id) Object.assign(self, defined(p));
    else others.set(p.id, { ...(others.get(p.id) ?? { id: p.id }), ...defined(p) });
  }
  return { self, others: [...others.values()] };
}

/** A patch's fields that are set: undefined means "leave it". */
function defined(p: QPatch): Partial<QTask> {
  const out: Partial<QTask> = {};
  if (p.queuePos !== undefined) out.queuePos = p.queuePos;
  if (p.due !== undefined) out.due = p.due;
  if (p.queueSavedDue !== undefined) out.queueSavedDue = p.queueSavedDue;
  return out;
}

/** Where it would land: its place counted as the queue shows it (Now first,
 *  then Up next "2nd", "3rd"), and whether that is Now. */
export function previewPlace(list: QTask[], settings: QueueSettings, task: QTask, at: QueueAt | null, today: string): { place: number; now: boolean } {
  const { self, others } = placeNewTask(list, settings, task, at, today);
  const byId = new Map(others.map((p) => [p.id, p]));
  const after = [
    ...list.filter((t) => t.id !== task.id).map((t) => { const p = byId.get(t.id); return p ? { ...t, ...defined(p) } : t; }),
    { ...task, ...defined(self) },
  ];
  const g = groupQueue(after, settings);
  const n = g.now.findIndex((t) => t.id === task.id);
  if (n >= 0) return { place: n + 1, now: true };
  const u = g.upNext.find((x) => x.task.id === task.id);
  return { place: u?.place ?? g.now.length + g.upNext.length + 1, now: false };
}

const ORD = (n: number) => { const v = n % 100; const s = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"; return `${n}${s}`; };

/** The picker's words: "now", "next up (2nd)", "at the bottom (9th)". */
export function queueAtWords(at: QueueAt, place?: number | null): string {
  if (at === "now") return "now";
  const where = at === "next" ? "next up" : "at the bottom";
  return place ? `${where} (${ORD(place)})` : where;
}

/** A deadline in the sentence: "deadline Oct 30". */
export function deadlineWords(date: string): string {
  return `deadline ${formatDue(date)}`;
}

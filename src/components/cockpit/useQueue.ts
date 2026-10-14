"use client";

// A list's queue (mcp/queue.mjs, Derek 2026-10-14): turning it on and off,
// its two settings, and moving tasks in its line. Who comes up next after an
// edit is useTaskEdits' followQueue, beside every other edit.

import * as React from "react";
import { newId } from "./ui";
import { formatDue, todayIso, userById, type Me, type NotificationKind, type Project, type Task } from "@/lib/data";
import { appendCommentDb, saveTaskEdit, upsertProject } from "@/lib/db";
import { DEFAULT_QUEUE, queueMove, queueMoveUp, queueOffPatches, queueOnPatches, queuePromotions, queueSettings, type QPatch } from "../../../mcp/queue.mjs";

export type UseQueueDeps = {
  projectById: (id: string) => Project | null;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  tasksRef: React.RefObject<Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  me: Me;
  notify: (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean; link?: string }) => void;
  pushToast: (text: string, action?: { label: string; run: () => void }) => void;
};

/** How many task writes go at once when a whole list changes. Each is one
 *  row; a list is tens of tasks, never the whole table. */
const AT_ONCE = 5;

/** The queue fields of a patch, as a Task edit. */
export function queueFields(p: QPatch): Partial<Task> {
  const f: Partial<Task> = {};
  if (p.queuePos !== undefined) f.queuePos = p.queuePos;
  if (p.due !== undefined) f.due = p.due;
  if (p.queueSavedDue !== undefined) f.queueSavedDue = p.queueSavedDue;
  return f;
}

export function useQueue({ projectById, setProjects, tasksRef, setTasks, me, notify, pushToast }: UseQueueDeps) {
  /** Writes patches: the screen at once, the database a few rows at a time. */
  const writeAll = async (patches: QPatch[], line?: (t: Task, p: QPatch) => string | null) => {
    const pairs = patches.map((p) => {
      const before = tasksRef.current.find((t) => t.id === p.id);
      return before ? { before, after: { ...before, ...queueFields(p) }, p } : null;
    }).filter((x): x is { before: Task; after: Task; p: QPatch } => !!x);
    if (!pairs.length) return;
    const byId = new Map(pairs.map((x) => [x.before.id, x.after]));
    const fieldsById = new Map(pairs.map((x) => [x.before.id, queueFields(x.p)]));
    tasksRef.current = tasksRef.current.map((t) => byId.get(t.id) ?? t);
    setTasks((ts) => ts.map((t) => { const f = fieldsById.get(t.id); return f ? { ...t, ...f } : t; }));
    for (let i = 0; i < pairs.length; i += AT_ONCE) {
      await Promise.all(pairs.slice(i, i + AT_ONCE).map(async ({ before, after, p }) => {
        await saveTaskEdit(before, after, me.id);
        const body = line?.(before, p);
        if (body) await appendCommentDb(before.id, { id: newId("cm_"), authorId: me.id, body, at: new Date().toISOString(), kind: "event" });
      }));
    }
  };

  const listTasks = (projectId: string) => tasksRef.current.filter((t) => t.projectId === projectId);

  /** The Queue switch. On: the list is lined up by due date and only Now
   *  keeps a date. Off: every date the queue saved comes back. */
  const toggleQueue = (projectId: string) => {
    const p = projectById(projectId);
    if (!p || p.queue === undefined) return;
    if (p.queue) {
      const np = { ...p, queue: null };
      setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
      void upsertProject(np);
      void writeAll(queueOffPatches(listTasks(projectId)));
      pushToast(`${p.name} is a plain list again; its dates are back`);
      return;
    }
    const q = { ...DEFAULT_QUEUE };
    const np = { ...p, queue: q };
    setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
    void upsertProject(np);
    void (async () => {
      await writeAll(queueOnPatches(listTasks(projectId), q), (t, patch) => (patch.due === null && t.due ? `put in the queue; its date ${formatDue(t.due)} is saved for when the queue is off` : null));
      // Now has a date from the start, like any task that comes up.
      await writeAll(queuePromotions(listTasks(projectId), q, todayIso()), (t, patch) => (patch.due && patch.due !== t.due ? `came up next in the queue, due ${formatDue(patch.due)}` : null));
    })();
    pushToast(`${p.name} is a queue: ${q.now} at a time`, { label: "Undo", run: () => toggleQueue(projectId) });
  };

  /** How many are Now at once, and the spacing in business days. */
  const setQueueSettings = (projectId: string, next: { now: number; spacing: number }) => {
    const p = projectById(projectId);
    const q = queueSettings(next);
    if (!p || !p.queue || !q) return;
    const np = { ...p, queue: q };
    setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
    void upsertProject(np);
  };

  /** Someone else's task moved: they hear why. */
  const tellOwner = (t: Task, up: boolean, reason: string | undefined) => {
    if (!t.assigneeId || t.assigneeId === me.id || !userById(t.assigneeId)) return;
    const who = me.name.split(/\s+/)[0] || me.name;
    notify(t.assigneeId, `${who} moved ${t.title} ${up ? "up" : "down"}${reason ? `: ${reason}` : ""}`, t.id, { projectId: t.projectId, clientId: t.clientId });
  };

  /** A drag in the line: `id` goes just before `beforeId` (null: the end). */
  const moveInQueue = (projectId: string, id: string, beforeId: string | null, reason?: string) => {
    const q = queueSettings(projectById(projectId)?.queue);
    const t = tasksRef.current.find((x) => x.id === id);
    if (!q || !t) return;
    const before = t.queuePos ?? null;
    const patches = queueMove(listTasks(projectId), q, id, beforeId, todayIso());
    if (!patches.length) return;
    const mine = patches.find((x) => x.id === id);
    const after = mine?.queuePos ?? before;
    void writeAll(patches, (task, p) => (p.due && p.due !== task.due ? `moved to Now in the queue, due ${formatDue(p.due)}` : null));
    tellOwner(t, before == null || (after != null && after < before), reason);
  };

  /** "Move it up" on a deadline warning: the top of Up next. */
  const moveUpInQueue = (projectId: string, id: string, reason?: string) => {
    const q = queueSettings(projectById(projectId)?.queue);
    const t = tasksRef.current.find((x) => x.id === id);
    if (!q || !t) return;
    const patches = queueMoveUp(listTasks(projectId), q, id, todayIso());
    if (!patches.length) return;
    void writeAll(patches);
    tellOwner(t, true, reason);
  };

  // A deadline is set on the task page's ⋯ menu (TaskDrawer deadlineItem).
  return { toggleQueue, setQueueSettings, moveInQueue, moveUpInQueue };
}

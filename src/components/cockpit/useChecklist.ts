"use client";

// A task's checklist and its handoffs: ticking, adding, renaming, removing and
// changing items, delegating a task or several at once, and labels. Each item
// change saves on its own (supabase/checklist-functions.sql). Lifted out of
// Cockpit.tsx unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { type ChecklistChange } from "./checklistChange";
import { type ConfirmSpec } from "./modals";
import { newId } from "./ui";
import { bulkDelegateSummary, bulkDelegations, type BulkDelegateSpec } from "@/lib/bulkDelegate";
import { delegateeOf, delegationTitle, handoffDoneEvent, type Me, type NotificationKind, type Priority, type Subtask, type Task, type TaskSize, userById, users } from "@/lib/data";
import { appendCommentDb, insertTaskAction } from "@/lib/db";

export type UseChecklistDeps = {
  tasks: Task[];
  update: (id: string, patch: Partial<Task>, item?: ChecklistChange) => void;
  me: Me;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  notify: (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean; link?: string; }) => void;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmSpec | null>>;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  tasksRef: React.RefObject<Task[]>;
  selectedTaskIds: Set<string>;
  setBulkDelegateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  clearSelection: () => void;
};

export function useChecklist({ tasks, update, me, setTasks, notify, setConfirmDialog, pushToast, tasksRef, selectedTaskIds, setBulkDelegateOpen, clearSelection }: UseChecklistDeps) {
  const toggleSub = (taskId: string, subId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const s = t.subtasks.find((x) => x.id === subId);
    const nowDone = s ? !s.done : false;
    const subtasks = t.subtasks.map((x) => (x.id === subId ? { ...x, done: !x.done } : x));
    const patch: Partial<Task> = { subtasks };
    // A finished handoff has to leave the Delegated stage, or the task sits
    // there for good claiming it is with someone who is done with it. Taking
    // one back already did this; the happy path, where they simply finish, is
    // the one that actually happens.
    if (t.status === "delegated" && !delegateeOf({ assigneeId: t.assigneeId, subtasks })) patch.status = "in_progress";
    update(taskId, patch, { patch: subId, with: { done: nowDone } });
    // A finished handoff goes on the task's record, so the Finished feed can
    // show it. Until now it left no trace but a bell: nothing said when it was
    // done or by whom, so it could not appear anywhere after the fact. The same
    // test deleteSub uses for a delegation: an item given to someone other than
    // the task's owner, not the owner ticking their own checklist.
    const handoff = !!s?.assigneeId && s.assigneeId !== t.assigneeId;
    if (nowDone && handoff && s) {
      const ev = { id: newId("cm_"), authorId: me.id, kind: "event" as const, at: new Date().toISOString(), body: handoffDoneEvent(s.title) };
      setTasks((prev) => prev.map((x) => (x.id === taskId ? { ...x, comments: [...x.comments, ev] } : x)));
      void appendCommentDb(taskId, ev);
    }
    // Completing a delegated item pings the task owner so they know it's handled.
    // Bell only — a checked-off checklist row is progress on work the owner is
    // already watching, not something that needs to interrupt their inbox.
    // Delegating an item TO someone (see patchSub) still emails, since that one
    // is a direct ask.
    if (nowDone && s?.assigneeId && t.assigneeId && t.assigneeId !== me.id) notify(t.assigneeId, `${me.name} completed "${s.title}" on ${t.title}`, taskId, { skipEmail: true });
  };
  const addSub = (taskId: string, title: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || !title.trim()) return;
    const sub: Subtask = { id: newId("s_"), title: title.trim(), done: false };
    update(taskId, { subtasks: [...t.subtasks, sub] }, { append: [sub] });
  };
  const renameSub = (taskId: string, subId: string, title: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, title } : s)) }, { patch: subId, with: { title } }); };
  const deleteSub = (taskId: string, subId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    const s = t?.subtasks.find((x) => x.id === subId);
    if (!t || !s) return;
    // Taking a handoff back is a bigger deal than deleting a checklist line:
    // it removes the only thing giving that person access to the task, so it
    // says whose it was and what happens to the stage.
    const isDelegation = !!s.assigneeId && s.assigneeId !== t.assigneeId;
    const who = isDelegation ? (userById(s.assigneeId!)?.name ?? "them") : "";
    const rest = t.subtasks.filter((x) => x.id !== subId);
    const lastOne = isDelegation && !delegateeOf({ assigneeId: t.assigneeId, subtasks: rest });
    setConfirmDialog({
      title: isDelegation ? `Take this back from ${who}?` : `Delete “${s.title || "this checklist item"}”?`,
      message: isDelegation
        ? `${who} loses access to this task${lastOne ? ", and it leaves the Delegated stage" : ""}. What they were asked to do is deleted with it, and this can't be undone.`
        : "This can't be undone.",
      confirmLabel: isDelegation ? "Take it back" : "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        const patch: Partial<Task> = { subtasks: rest };
        // Nothing is delegated any more, so the task cannot stay in a stage
        // that means it is with someone else.
        if (lastOne && t.status === "delegated") patch.status = "in_progress";
        update(taskId, patch, { remove: subId });
        if (isDelegation) pushToast(`Taken back from ${who}`);
      },
    });
  };
  const patchSub = (taskId: string, subId: string, patch: Partial<Subtask>) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const before = t.subtasks.find((s) => s.id === subId);
    update(taskId, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)) }, { patch: subId, with: patch });
    // Assigning a checklist item to someone else = delegating that step; ping them.
    if (patch.assigneeId && patch.assigneeId !== before?.assigneeId && patch.assigneeId !== me.id) notify(patch.assigneeId, `${me.name} delegated "${before?.title || "a checklist item"}" on ${t.title} to you`, taskId);
  };
  // Handing a task to a teammate without creating a second task. One write
  // does all of it: a checklist item assigned to them (which is what puts the
  // task on their list at all, via tasks.delegated_to and the RLS in
  // supabase/task-delegation.sql), the task's own dates and sizing, the
  // hidden Delegated stage, and the ping. It lives here rather than in the
  // dock because the notify and the task write belong to the same owner.
  const delegateTask = (taskId: string, spec: {
    toId: string; title: string; instructions: string; theirDue: string; followUpAt: string | null;
    size: TaskSize | null; priority: Priority; links: string[];
  }, opts?: { skipEmail?: boolean }): string | null => {
    const t = tasksRef.current.find((x) => x.id === taskId);
    if (!t) return null;
    // Whatever they called it, or a name derived from the brief when they
    // left it blank: see delegationTitle.
    const title = spec.title.trim() || delegationTitle(spec.instructions);
    const sub: Subtask = {
      id: newId("s_"), title: title || t.title, done: false,
      assigneeId: spec.toId, due: spec.theirDue,
      // Links ride in the instructions: LinkedText already renders a URL as a
      // chip wherever the note is shown, so a separate links column would be
      // a second way to say the same thing.
      note: [spec.instructions, ...spec.links].filter(Boolean).join("\n"),
    };
    const patch: Partial<Task> = {
      subtasks: [...t.subtasks, sub],
      status: "delegated",
      priority: spec.priority, priorityAuto: false,
    };
    if (spec.followUpAt) patch.followUpAt = spec.followUpAt;
    // Only when nobody has estimated it. A size the owner set by hand is
    // theirs, and the same rule governs the dock's other actions.
    if (spec.size && !t.size && !t.sizeHours) patch.size = spec.size;
    update(taskId, patch, { append: [sub] });
    if (spec.toId !== me.id) notify(spec.toId, `${me.name} delegated "${title}" to you on ${t.title}`, taskId, { skipEmail: opts?.skipEmail });
    // The handoff's own id, so the caller can open its page: the brief is
    // written there now rather than in the delegate box (Derek, 2026-09-18).
    return sub.id;
  };

  // The same handoff, applied to everything selected. Nine tasks to one person
  // should differ from nine handoffs only in how long it takes, so each task
  // gets its own subtask, its own activity line and its own bell, exactly as
  // it would one at a time. Only the email copies are collapsed: nine bells is
  // a list, nine emails is a mailbox.
  const bulkDelegate = (spec: BulkDelegateSpec) => {
    const chosen = [...selectedTaskIds]
      .map((id) => tasksRef.current.find((t) => t.id === id))
      .filter((t): t is Task => !!t);
    if (!chosen.length) { pushToast("Those tasks are no longer here."); setBulkDelegateOpen(false); return; }
    const toName = users.find((u) => u.id === spec.toId)?.name ?? "them";
    const at = new Date().toISOString();
    bulkDelegations(chosen, spec).forEach(({ taskId, spec: one }, i) => {
      delegateTask(taskId, one, { skipEmail: i > 0 });
      // The activity line the dock writes for a single handoff, so a delegated
      // task reads the same however it got that way.
      insertTaskAction({
        id: newId("ta_"), taskId, kind: "delegate", authorId: me.id,
        toId: spec.toId, parentId: null,
        body: one.instructions, at,
        // What you are waiting on is them, not your own follow-up.
        nextStep: `${toName} to finish this`,
        nextStepDue: one.theirDue, nextStepDoneAt: null,
      });
    });
    setBulkDelegateOpen(false);
    clearSelection();
    pushToast(bulkDelegateSummary(chosen.length, toName));
  };
  const toggleLabel = (taskId: string, labelId: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { labelIds: t.labelIds.includes(labelId) ? t.labelIds.filter((l) => l !== labelId) : [...t.labelIds, labelId] }); };

  // A client's ghlLocationId field is repurposed to store the contact's business/company name.
  // Which client a task belongs to when the composer is opened from somewhere
  // with no client on screen. The most recently opened one is the best guess
  // anyone can make, and clientUsed already knows it; picking another in the
  // composer replaces it for next time by the same route.
  return { toggleSub, addSub, deleteSub, renameSub, patchSub, toggleLabel, delegateTask, bulkDelegate };
}

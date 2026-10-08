"use client";

// Changing tasks: the one save path every edit goes through (update), the
// field edits that log a line in a task's activity (patchTask), comments,
// selection and bulk edits, duplicating and deleting. Lifted out of
// Cockpit.tsx unchanged (audit 2026-09-29, 3.4).

import { clientMoveLine } from "../../../mcp/taskMove.mjs";
import * as React from "react";
import { type ChecklistChange } from "./checklistChange";
import { type ConfirmSpec } from "./modals";
import { newId } from "./ui";
import { PRIORITY_META, STATUS_META, applyWaitingStatusSync, waitingFollowUp, followUpWithDue, delegatedItemFor, formatDue, hasFreshClone, htmlToText, mentionsUser, nextDueAhead, nextOccurrence, type Attachment, type Comment, type Me, type NotificationKind, type Client, type Project, type Task, type TaskStatus, userById, users } from "@/lib/data";
import { appendCommentDb, appendSubtasksDb, deleteTaskDb, patchSubtaskDb, removeSubtaskDb, saveTaskDraftEmail, saveTaskEdit, upsertTask } from "@/lib/db";

export type UseTaskEditsDeps = {
  tasksRef: React.RefObject<Task[]>;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  keepDoneVisible: (taskId: string) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  me: Me;
  toggleSubLate: (taskId: string, subId: string) => void;
  notify: (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean; link?: string; }) => void;
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedTaskIds: Set<string>;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmSpec | null>>;
  openTaskId: string | null;
  setOpenTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  projectById: (id: string) => Project | null;
  /** For the Changes line when a task moves to another client. */
  clientById?: (id: string) => Client | null;
  tasks: Task[];
  sendMentionEmail: (recipientMemberId: string, taskId: string, commentBody: string) => void;
};

export function useTaskEdits({ tasksRef, pushToast, keepDoneVisible, setTasks, me, toggleSubLate, notify, setSelectedTaskIds, selectedTaskIds, setConfirmDialog, openTaskId, setOpenTaskId, projectById, clientById, tasks, sendMentionEmail }: UseTaskEditsDeps) {
  // --- mutations ------------------------------------------------------------

  const saveChecklistChange = (taskId: string, item: ChecklistChange, author: string) => {
    if ("append" in item) void appendSubtasksDb(taskId, item.append, author);
    else if ("remove" in item) void removeSubtaskDb(taskId, item.remove, author);
    else void patchSubtaskDb(taskId, item.patch, item.with, author);
  };
  // `item` says which one checklist item the edit changes, when it does: that
  // item goes through its own locked write and the rest of the edit saves as
  // usual, so two people on one checklist keep both their changes.
  const update = (id: string, patch: Partial<Task>, item?: ChecklistChange) => {
    const cur = tasksRef.current.find((t) => t.id === id);
    // Keeps status:"waiting" and waitingOnClient in lockstep regardless of
    // which mutation path is used — setTaskStage (the Kanban drag handler)
    // patches status through here, bypassing patchTask entirely, so this
    // needs its own copy of the sync rather than relying on patchTask's.
    const synced = cur ? { ...patch, ...applyWaitingStatusSync(cur, patch) } : patch;
    // Starting a wait on the client sets when we check back (waitingFollowUp).
    const checkBack = cur ? waitingFollowUp(cur, synced) : null;
    if (checkBack) synced.followUpAt = checkBack;
    // A new due date brings its follow up (followUpWithDue), unless this change sets one.
    const withDue = cur ? followUpWithDue(cur, synced) : undefined;
    // null clears it: a due date this close needs no follow up.
    if (withDue !== undefined) synced.followUpAt = withDue;
    // Recurrence also needs its own copy, for the same reason — dragging a
    // recurring task into a done-flagged Kanban stage went through here, not
    // patchTask, so it was marking the task done with no next occurrence
    // ever created (Derek: "check recurring tasks... are recreated
    // according to settings and not just marked done"). Both paths build the
    // occurrence through nextOccurrence, so there is one answer to what a new
    // cycle carries; this one deliberately skips the event-comment logging
    // patchTask also does.
    let clone: Task | null = null;
    if (cur && synced.status === "done" && cur.status !== "done" && cur.recurrence !== "none") {
      const nextDue = nextDueAhead(cur.due, cur.recurrence, cur.recurrenceInterval, cur.recurrenceUnit, cur.recurrenceDaysOfMonth, cur.recurrenceNth, cur.recurrenceWeekday);
      if (!hasFreshClone(tasksRef.current, cur, nextDue)) {
        clone = nextOccurrence(cur, nextDue, newId);
        pushToast(`🔁 Recurring — next occurrence created for ${formatDue(nextDue)}`);
      }
    }
    if (cur && synced.status === "done" && cur.status !== "done") keepDoneVisible(id);
    setTasks((ts) => { let next = ts.map((t) => (t.id === id ? { ...t, ...synced } : t)); if (clone) next = [...next, clone]; return next; });
    // Only the columns this edit changed (saveTaskEdit), so a checklist tick
    // from this window can't carry stale comments or fields over newer ones.
    if (cur) {
      void saveTaskEdit(cur, { ...cur, ...synced, ...(item ? { subtasks: cur.subtasks } : {}) }, me.id);
      if (item) saveChecklistChange(id, item, me.id);
      if (clone) upsertTask(clone, me.id);
    }
    // The draft email is never part of a task save (db.ts taskToRow), only its own write.
    if (cur && "draftEmail" in synced) saveTaskDraftEmail(id, synced.draftEmail ?? null, me.id);
  };

  // Field changes on a task that are worth a line in its Activity feed. Stored
  // as kind:"event" comments (no schema change) so the existing JSONB column
  // and feed rendering carry them for free — excluded from comment counts.
  // Removes one entry from a task's activity: a note, or one of the app's own
  // field-change events. patchTask cannot do this — it rebuilds `comments`
  // from `before` so it can append events, so a comments array handed to it is
  // discarded (Derek: "I need to be able to delete anything from the
  // timeline"). Deliberately logs nothing: recording that someone tidied the
  // log would defeat the tidying.
  const deleteComment = (taskId: string, commentId: string) => {
    const before = tasksRef.current.find((x) => x.id === taskId);
    if (!before) return;
    const updated: Task = { ...before, comments: before.comments.filter((c) => c.id !== commentId) };
    setTasks((prev) => prev.map((x) => (x.id === taskId ? updated : x)));
    void saveTaskEdit(before, updated, me.id);
  };

  const describeFieldChange = (before: Task, patch: Partial<Task>): string[] => {
    const lines: string[] = [];
    // A move to another client (the Client box, or bulk Move to). Same line
    // the MCP's update_task writes (mcp/taskMove.mjs).
    if (patch.clientId !== undefined && patch.clientId !== before.clientId)
      lines.push(clientMoveLine(clientById?.(before.clientId)?.name ?? "another client", clientById?.(patch.clientId)?.name ?? "another client", patch.projectId ? projectById(patch.projectId)?.name : null));
    if (patch.status && patch.status !== before.status) lines.push(`changed status from ${STATUS_META[before.status].label} to ${STATUS_META[patch.status].label}`);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
      if (!before.assigneeId && patch.assigneeId) lines.push(`assigned to ${userById(patch.assigneeId)?.name ?? "someone"}`);
      else if (before.assigneeId && !patch.assigneeId) lines.push(`unassigned (was ${userById(before.assigneeId)?.name ?? "someone"})`);
      else lines.push(`reassigned from ${userById(before.assigneeId!)?.name ?? "someone"} to ${userById(patch.assigneeId!)?.name ?? "someone"}`);
    }
    if (patch.due !== undefined && patch.due !== before.due) {
      if (!before.due && patch.due) lines.push(`set due date to ${formatDue(patch.due)}`);
      else if (before.due && !patch.due) lines.push(`cleared the due date (was ${formatDue(before.due)})`);
      else lines.push(`changed due date from ${formatDue(before.due)} to ${formatDue(patch.due!)}`);
    }
    if (patch.priority && patch.priority !== before.priority) lines.push(`changed priority from ${PRIORITY_META[before.priority].label} to ${PRIORITY_META[patch.priority].label}`);
    if (patch.followUpAt !== undefined && patch.followUpAt !== before.followUpAt) {
      if (!before.followUpAt && patch.followUpAt) lines.push(`set follow up to ${formatDue(patch.followUpAt)}`);
      else if (before.followUpAt && !patch.followUpAt) lines.push(`cleared the follow up (was ${formatDue(before.followUpAt)})`);
      else lines.push(`moved follow up from ${formatDue(before.followUpAt!)} to ${formatDue(patch.followUpAt!)}`);
    }
    // The two changes that carry content worth reading. "Description updated"
    // on its own tells you something happened and then makes you go find it;
    // the point of a feed is that the thing is there (Derek: "just add the
    // description there ... and then put the link there").
    if (patch.description !== undefined && patch.description !== before.description) {
      const text = htmlToText(patch.description).trim();
      lines.push(text ? `updated the description: ${text.slice(0, 400)}` : "cleared the description");
    }
    if (patch.attachments !== undefined) {
      const had = new Set(before.attachments.map((a) => a.id));
      const has = new Set(patch.attachments.map((a) => a.id));
      for (const a of patch.attachments) {
        if (had.has(a.id)) continue;
        // Name only. Printing the URL beside it repeated a 90 character
        // string twice in one line, and the attachment list right there
        // already carries the link itself.
        lines.push(a.url ? `added the link ${a.name}` : `attached ${a.name}`);
      }
      for (const a of before.attachments) {
        if (!has.has(a.id)) lines.push(`removed ${a.url ? "the link" : "the file"} ${a.name}`);
      }
      // Renames are deliberately NOT recorded. Most of them are the app's own
      // doing — a link is added under a URL-derived name and renamed a second
      // later when its page title arrives — so every link produced two
      // entries, one of them quoting the full URL twice. The attachment list
      // already shows the current name.
    }
    return lines;
  };

  // Someone a task was handed to marks it Done: that finishes THEIR handoff,
  // never the owner's task (Derek: "when she completes the task it will only
  // complete the delegation"). RLS lets a delegatee update the task, so this
  // is the only thing stopping it. One check where status writes converge, so
  // the row dot, the drawer's stage chip, bulk Status, and dragging into a
  // status group all agree. Returns true when it handled the Done.
  const finishHandoffInstead = (task: Task): boolean => {
    const handoff = delegatedItemFor(task, me.id);
    if (!handoff) return false;
    toggleSubLate(task.id, handoff.id);
    return true;
  };

  const patchTask = (id: string, patch: Partial<Task>) => {
    const before = tasksRef.current.find((x) => x.id === id);
    if (!before) return;
    if (patch.status === "done" && finishHandoffInstead(before)) {
      const rest = { ...patch };
      delete rest.status;
      if (!Object.keys(rest).length) return;
      patch = rest;
    }
    // Keeps status:"waiting" and waitingOnClient in lockstep — see update()'s
    // matching comment for why this can't just live in one place.
    // Choosing a priority by hand takes this task off automatic for good: the
    // app must not argue with a deliberate decision the next time the due
    // date moves.
    const withAuto: Partial<Task> = patch.priority !== undefined && patch.priority !== before.priority ? { ...patch, priorityAuto: false } : patch;
    const synced: Partial<Task> = { ...withAuto, ...applyWaitingStatusSync(before, withAuto) };
    // Done is done: an unsent draft email on it is thrown out, so Drafts
    // doesn't fill with emails nobody will send (Derek, 2026-10-07).
    if (synced.status === "done" && before.draftEmail && synced.draftEmail === undefined) synced.draftEmail = null;
    const checkBack = waitingFollowUp(before, synced);
    if (checkBack) synced.followUpAt = checkBack;
    const withDue = followUpWithDue(before, synced);
    if (withDue !== undefined) synced.followUpAt = withDue;
    const events = describeFieldChange(before, synced).map((body) => ({ id: newId("cm_"), authorId: me.id, body, at: new Date().toISOString(), kind: "event" as const }));
    const updated: Task = { ...before, ...synced, comments: events.length ? [...before.comments, ...events] : before.comments };
    let clone: Task | null = null;
    if (synced.status === "done" && before.status !== "done" && before.recurrence !== "none") {
      const nextDue = nextDueAhead(before.due, before.recurrence, before.recurrenceInterval, before.recurrenceUnit, before.recurrenceDaysOfMonth, before.recurrenceNth, before.recurrenceWeekday);
      if (!hasFreshClone(tasksRef.current, before, nextDue)) {
        clone = nextOccurrence(before, nextDue, newId);
        pushToast(`🔁 Recurring — next occurrence created for ${formatDue(nextDue)}`);
      }
    }
    if (synced.status === "done" && before.status !== "done") keepDoneVisible(id);
    setTasks((prev) => { let next = prev.map((x) => (x.id === id ? updated : x)); if (clone) next = [...next, clone]; return next; });
    // Only the fields this edit changed, then each activity line appended on
    // its own (append_comment). Writing `comments` from `before` erased any
    // comment saved from another window, or by a teammate, in the meantime.
    void (async () => {
      await saveTaskEdit(before, { ...before, ...synced, comments: before.comments }, me.id);
      for (const e of events) await appendCommentDb(id, e);
    })();
    if (clone) upsertTask(clone, me.id);
    // The draft email is never part of a task save (db.ts taskToRow), only its own write.
    if ("draftEmail" in synced) saveTaskDraftEmail(id, synced.draftEmail ?? null, me.id);
    if (patch.assigneeId && patch.assigneeId !== me.id && patch.assigneeId !== before.assigneeId) {
      notify(patch.assigneeId, `${me.name} assigned you “${before.title}”`, id);
      pushToast(`Notified ${userById(patch.assigneeId)?.name}`);
    }
    // Finishing work is worth surfacing to the rest of the team, not just silence.
    // The bell/Inbox row still fires for everyone here exactly as before — only
    // the companion EMAIL is suppressed. This branch fans out to every admin on
    // every Kanban drag, which made it the single loudest source of notification
    // mail; a status move is already visible on the board.
    //
    // PENDING DEREK'S DECISION: "Changes requested" is split out and still
    // emails the ASSIGNEE, on the theory that having your own work kicked back
    // is worth an inbox hit even though the rest of this branch isn't. The
    // admin fan-out is skipped for that status too. If he decides changes
    // requested shouldn't mail either, delete `keepEmail` and pass a flat
    // `{ skipEmail: true }`.
    if (synced.status && (synced.status === "review" || synced.status === "changes_requested" || synced.status === "done") && synced.status !== before.status) {
      users.filter((u) => u.id !== me.id && (u.role === "admin" || before.assigneeId === u.id)).forEach((u) => {
        const keepEmail = synced.status === "changes_requested" && u.id === before.assigneeId;
        notify(u.id, `${me.name} moved “${before.title}” to ${STATUS_META[synced.status as TaskStatus].label}`, id, { skipEmail: !keepEmail });
      });
    }
    // A due-date change is easy for the assignee to miss otherwise.
    if (patch.due !== undefined && patch.due !== before.due && before.assigneeId && before.assigneeId !== me.id) {
      notify(before.assigneeId, `${me.name} changed the due date on “${before.title}”`, id);
    }
  };

  const toggleTaskSelection = (id: string) => setSelectedTaskIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSelection = () => setSelectedTaskIds(new Set());
  // Reuses patchTask per task (not a raw update()) so a bulk change still
  // gets the same event-log comments, notifications, and GHL sync a single
  // edit would — just applied to every selected task at once.
  //
  // Every bulk edit is gated behind a confirm and hands back an undo. These
  // controls sit one careless click away from rewriting a whole list (picking
  // "Done" from the status dropdown used to fire instantly, with no warning
  // and no way back), and the blast radius scales with the selection.
  //
  // Undo snapshots only the keys being written, so reverting restores exactly
  // what changed and can't clobber edits made to other fields in between.
  const bulkPatch = (patch: Partial<Task>, summary: string) => {
    const ids = [...selectedTaskIds];
    if (!ids.length) return;
    const n = ids.length;
    const plural = n === 1 ? "" : "s";
    setConfirmDialog({
      title: `${summary} for ${n} task${plural}?`,
      message: `This updates all ${n} selected task${plural} at once. You can undo it right after.`,
      confirmLabel: `Update ${n} task${plural}`,
      danger: false,
      onConfirm: () => {
        const keys = Object.keys(patch) as (keyof Task)[];
        const before = ids
          .map((id) => {
            const t = tasksRef.current.find((x) => x.id === id);
            if (!t) return null;
            const prev: Partial<Task> = {};
            keys.forEach((k) => { (prev as Record<string, unknown>)[k] = t[k]; });
            return { id, prev };
          })
          .filter((x): x is { id: string; prev: Partial<Task> } => !!x);
        ids.forEach((id) => patchTask(id, patch));
        setConfirmDialog(null);
        clearSelection();
        pushToast(`${summary} for ${n} task${plural}`, {
          label: "Undo",
          run: () => {
            before.forEach(({ id, prev }) => patchTask(id, prev));
            pushToast(`Reverted ${before.length} task${before.length === 1 ? "" : "s"}`);
          },
        });
      },
    });
  };
  // Same confirm-then-undo-toast shape as bulkPatch above, but a real delete
  // has no undo — the toast just reports what happened, it doesn't offer one.
  const bulkDelete = () => {
    const ids = [...selectedTaskIds];
    if (!ids.length) return;
    const deletable = ids.filter((id) => { const t = tasksRef.current.find((x) => x.id === id); return !!t; });
    const skipped = ids.length - deletable.length;
    if (!deletable.length) { pushToast("Nothing selected can be deleted."); return; }
    const n = deletable.length;
    setConfirmDialog({
      title: `Delete ${n} task${n === 1 ? "" : "s"}?`,
      message: `This can't be undone.${skipped ? ` ${skipped} selected step${skipped === 1 ? "" : "s"} will be skipped.` : ""}`,
      confirmLabel: `Delete ${n} task${n === 1 ? "" : "s"}`,
      onConfirm: () => {
        setConfirmDialog(null);
        const idSet = new Set(deletable);
        setTasks((ts) => ts.filter((t) => !idSet.has(t.id)));
        if (openTaskId && idSet.has(openTaskId)) setOpenTaskId(null);
        deletable.forEach((id) => deleteTaskDb(id, me.id));
        clearSelection();
        pushToast(`${n} task${n === 1 ? "" : "s"} deleted`);
      },
    });
  };
  // A copy of a task, ready to be worked rather than a snapshot of one that
  // already was. So the shape and the instructions come across (title,
  // description, checklist, links, client, list, priority, labels, dates) and
  // the history does not: no comments, no logged actions (they are keyed by
  // task id and stay with the original), no GHL link, and every checklist
  // item unticked. Status resets to To do, because "duplicate this" almost
  // always means "do it again", not "record that it is already done".
  //
  // Uploaded files are dropped and links are kept. A link is a pointer that
  // costs nothing to copy; a file lives in storage under the original task's
  // path, so a second row pointing at it would break the moment the first
  // task was deleted.
  const duplicateTask = (id: string, target?: { clientId: string; projectId: string }) => {
    const src = tasksRef.current.find((x) => x.id === id);
    if (!src) return;
    const copy: Task = {
      ...src,
      id: newId("t_"),
      title: `${src.title} (copy)`,
      status: "todo",
      subtasks: src.subtasks.map((sub) => ({ ...sub, id: newId("s_"), done: false })),
      attachments: src.attachments.filter((a) => !!a.url).map((a) => ({ ...a, id: newId("at_") })),
      comments: [],
      ghlTaskId: null,
      followUpAt: null,
      createdAt: new Date().toISOString(),
      createdBy: me.id,
      // A copy sent to another list is a fresh piece of work there, so it
      // arrives unassigned rather than silently landing on whoever happened
      // to own the original in a different client's list.
      ...(target && target.projectId !== src.projectId
        ? { clientId: target.clientId, projectId: target.projectId, assigneeId: null, waitingOnClient: false }
        : {}),
      // A Growth Plan step is pinned to its client's checklist by this key; a
      // copy carrying it would be treated as that same step somewhere else
      // and get reconciled away.
    };
    setTasks((ts) => [...ts, copy]);
    upsertTask(copy, me.id);
    setOpenTaskId(copy.id);
    pushToast(target && target.projectId !== src.projectId ? `Duplicated into ${projectById(target.projectId)?.name ?? "another list"}` : "Task duplicated", { label: "Undo", run: () => { setTasks((ts) => ts.filter((t) => t.id !== copy.id)); deleteTaskDb(copy.id, me.id); setOpenTaskId(id); } });
  };

  const deleteTask = (id: string) => {
    setConfirmDialog({
      title: "Delete this task?", message: "Moves to Trash — restorable there for 30 days.", confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setTasks((ts) => ts.filter((t) => t.id !== id));
        setOpenTaskId(null);
        deleteTaskDb(id, me.id);
        pushToast("Task moved to Trash");
      },
    });
  };

  const addComment = (id: string, body: string, attachments?: Attachment[]) => {
    if (!body.trim() && !attachments?.length) return;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    // Atomic JSONB append (append_comment RPC) instead of a full-row upsert —
    // two teammates commenting on the same task in the same window would
    // otherwise silently drop one comment (read-then-replace race).
    const newComment: Comment = { id: newId("cm_"), authorId: me.id, body: body.trim(), at: new Date().toISOString(), ...(attachments?.length ? { attachments } : {}) };
    setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, comments: [...x.comments, newComment] } : x)));
    appendCommentDb(id, newComment);
    // Comment notifications: @mentions get "mentioned you"; the task's assignee
    // always hears about new comments on their task (unless they wrote it).
    const mentioned = new Set<string>();
    users.forEach((u) => {
      if (u.id !== me.id && mentionsUser(body, u.name)) {
        mentioned.add(u.id);
        notify(u.id, `${me.name} mentioned you in “${t.title}”`, id, { kind: "message", skipEmail: true });
        pushToast(`Notified ${u.name}`);
        sendMentionEmail(u.id, id, body.trim());
      }
    });
    if (t.assigneeId && t.assigneeId !== me.id && !mentioned.has(t.assigneeId)) {
      notify(t.assigneeId, `${me.name} commented on “${t.title}”`, id, { kind: "message" });
    }
  };
  return { patchTask, update, clearSelection, finishHandoffInstead, toggleTaskSelection, bulkPatch, bulkDelete, deleteTask, addComment, duplicateTask, deleteComment };
}

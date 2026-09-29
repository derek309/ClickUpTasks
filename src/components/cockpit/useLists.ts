"use client";

// A client's lists, the folders they sit in and the stages inside them, and
// moving tasks between clients and lists, or merging one task into another.
// Lifted out of Cockpit.tsx unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { type ChecklistChange } from "./checklistChange";
import { type ConfirmSpec, type PromptSpec } from "./modals";
import { newId } from "./ui";
import { WORKSPACE_CLIENT_ID, type Client, type ClientNote, type Folder, type Me, type Message, type Project, type Stage, type Task, type TaskStatus } from "@/lib/data";
import { deleteFolderDb, deleteProjectDb, deleteStageDb, deleteTaskDb, reassignMessagesTaskDb, upsertFolder, upsertProject, upsertStage, upsertTask } from "@/lib/db";

export type UseListsDeps = {
  setPromptDialog: React.Dispatch<React.SetStateAction<PromptSpec | null>>;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  folderById: (id: string | null | undefined) => Folder | null;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmSpec | null>>;
  projectById: (id: string) => Project | null;
  stages: Stage[];
  setStages: React.Dispatch<React.SetStateAction<Stage[]>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  tasks: Task[];
  finishHandoffInstead: (task: Task) => boolean;
  update: (id: string, patch: Partial<Task>, item?: ChecklistChange) => void;
  activeClient: string;
  foldersForClient: (clientId: string) => Folder[];
  projectsForClient: (clientId: string) => Project[];
  canAdmin: boolean;
  me: Me;
  patchTask: (id: string, patch: Partial<Task>) => void;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  tasksRef: React.RefObject<Task[]>;
  clientById: (id: string) => Client | null;
  selectedTaskIds: Set<string>;
  clearSelection: () => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setOpenTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  setClientNotes: React.Dispatch<React.SetStateAction<ClientNote[]>>;
};

export function useLists({ setPromptDialog, projects, setProjects, folders, setFolders, folderById, setConfirmDialog, projectById, stages, setStages, setTasks, tasks, finishHandoffInstead, update, activeClient, foldersForClient, projectsForClient, canAdmin, me, patchTask, pushToast, tasksRef, clientById, selectedTaskIds, clearSelection, setMessages, setOpenTaskId, setClientNotes }: UseListsDeps) {
  const addProject = (clientId: string, folderId: string | null = null) => {
    setPromptDialog({ title: folderId ? "New list" : "New list / project", placeholder: "Name", confirmLabel: "Create", onSubmit: (name) => {
      setPromptDialog(null);
      const pos = projects.filter((p) => p.clientId === clientId && (p.folderId ?? null) === folderId).length;
      const p: Project = { id: newId("p_"), clientId, name, description: "", folderId, position: pos };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
    } });
  };
  // Folder CRUD (a folder groups lists). Mirrors createVaultFolder's optimistic
  // + fire-and-forget shape; admin-only per folders_write RLS.
  const createFolder = (clientId: string) => {
    setPromptDialog({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create", onSubmit: (name) => {
      setPromptDialog(null);
      const pos = folders.filter((f) => f.clientId === clientId).length;
      const f: Folder = { id: newId("fd_"), clientId, name, position: pos, createdAt: new Date().toISOString() };
      setFolders((fs) => [...fs, f]);
      upsertFolder(f);
    } });
  };
  const renameFolder = (id: string) => {
    const f = folderById(id);
    if (!f) return;
    setPromptDialog({ title: "Rename folder", initial: f.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const nf = { ...f, name };
      setFolders((fs) => fs.map((x) => (x.id === id ? nf : x)));
      upsertFolder(nf);
    } });
  };
  // Deleting a folder reparents its lists to standalone (folderId → null) and
  // KEEPS their tasks — the deliberate contrast to deleteProject, which
  // cascades tasks. The DB's ON DELETE SET NULL does the same server-side.
  const deleteFolder = (id: string) => {
    const f = folderById(id);
    if (!f) return;
    setConfirmDialog({
      title: `Delete folder “${f.name}”?`,
      message: "Its lists move to standalone — their tasks are kept.",
      confirmLabel: "Delete folder",
      onConfirm: () => {
        setConfirmDialog(null);
        projects.filter((p) => p.folderId === id).forEach((p) => upsertProject({ ...p, folderId: null }));
        setProjects((ps) => ps.map((p) => (p.folderId === id ? { ...p, folderId: null } : p)));
        setFolders((fs) => fs.filter((x) => x.id !== id));
        deleteFolderDb(id);
      },
    });
  };
  // Move a list into a folder (or out to standalone with null), appending it to
  // the end of the target bucket.
  const moveListToFolder = (projectId: string, folderId: string | null) => {
    const p = projectById(projectId);
    if (!p) return;
    const pos = projects.filter((x) => x.clientId === p.clientId && (x.folderId ?? null) === folderId && x.id !== projectId).length;
    const np = { ...p, folderId, position: pos };
    setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
    upsertProject(np);
  };
  // Drag-sort folders (B5). Renumber the client's folders to match orderedIds
  // and persist each — mirrors reorderLinks' shape. DB-backed = shared order.
  const reorderFolders = (clientId: string, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const f = folders.find((x) => x.id === id)!; return { ...f, position: i }; });
    setFolders((fs) => [...fs.filter((f) => f.clientId !== clientId), ...reordered]);
    reordered.forEach((f) => upsertFolder(f));
  };
  // Drag-sort lists within one bucket (a folder, or the standalone bucket when
  // folderId is null). Renumber only that bucket so positions stay local to it.
  const reorderLists = (clientId: string, folderId: string | null, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const p = projects.find((x) => x.id === id)!; return { ...p, position: i }; });
    setProjects((ps) => [...ps.filter((p) => !(p.clientId === clientId && (p.folderId ?? null) === folderId)), ...reordered]);
    reordered.forEach((p) => upsertProject(p));
  };
  // Custom Kanban stages (a project's own board columns, e.g. "Backlog /
  // Designing / In Review / Shipped"). Mirrors the folder CRUD shape exactly;
  // admin-only per stages_write RLS.
  const createStage = (projectId: string) => {
    setPromptDialog({ title: "New stage", placeholder: "Stage name", confirmLabel: "Create", onSubmit: (name) => {
      setPromptDialog(null);
      const pos = stages.filter((s) => s.projectId === projectId).length;
      const s: Stage = { id: newId("stg_"), projectId, name, position: pos, isDone: false, createdAt: new Date().toISOString() };
      setStages((ss) => [...ss, s]);
      upsertStage(s);
    } });
  };
  const renameStage = (id: string) => {
    const s = stages.find((x) => x.id === id);
    if (!s) return;
    setPromptDialog({ title: "Rename stage", initial: s.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const ns = { ...s, name };
      setStages((ss) => ss.map((x) => (x.id === id ? ns : x)));
      upsertStage(ns);
    } });
  };
  // Toggles whether landing in this stage counts as "done" — see setTaskStage,
  // which is what actually syncs Task.status when a task moves in/out.
  const toggleStageIsDone = (id: string) => {
    const s = stages.find((x) => x.id === id);
    if (!s) return;
    const ns = { ...s, isDone: !s.isDone };
    setStages((ss) => ss.map((x) => (x.id === id ? ns : x)));
    upsertStage(ns);
  };
  // Deleting a stage un-sets it from any task that was in it (ON DELETE SET
  // NULL server-side) — tasks are kept, never cascaded.
  const deleteStage = (id: string) => {
    const s = stages.find((x) => x.id === id);
    if (!s) return;
    setConfirmDialog({
      title: `Delete stage "${s.name}"?`,
      message: "Tasks in this stage are kept — they just fall back to no stage.",
      confirmLabel: "Delete stage",
      onConfirm: () => {
        setConfirmDialog(null);
        setStages((ss) => ss.filter((x) => x.id !== id));
        setTasks((ts) => ts.map((t) => (t.stageId === id ? { ...t, stageId: null } : t)));
        deleteStageDb(id);
      },
    });
  };
  const reorderStages = (projectId: string, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const s = stages.find((x) => x.id === id)!; return { ...s, position: i }; });
    setStages((ss) => [...ss.filter((s) => s.projectId !== projectId), ...reordered]);
    reordered.forEach((s) => upsertStage(s));
  };
  // Move a task into a stage (or out, with null — back to the project's plain
  // status board). The stage's isDone flag is the single source of truth for
  // syncing Task.status, so every existing done/not-done consumer (urgency
  // scoring, GHL sync, MCP, recurrence-on-complete, journal completion
  // detection) keeps working unmodified: landing in a done-flagged stage
  // flips status to "done"; leaving one drops it back to "todo".
  const setTaskStage = (taskId: string, stageId: string | null) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const targetStage = stageId ? stages.find((s) => s.id === stageId) : null;
    // Dragging into a done stage is Done too; see finishHandoffInstead.
    if (targetStage?.isDone && finishHandoffInstead(t)) return;
    const nextStatus: TaskStatus = targetStage?.isDone ? "done" : t.status === "done" ? "todo" : t.status;
    update(taskId, { stageId, status: nextStatus });
  };
  // Per-column quick-add on the Kanban board — mirrors quickAdd's Task shape,
  // just scoped by stage instead of a groupBy key.
  // Whether the folder rail is on screen. It carries the single Add task for
  // the whole view, so when it is hidden — a non-admin looking at a client
  // with no folders and at most one list — the per-group buttons have to come
  // back, or that view has no way to add a task at all. Derived once so the
  // rail and the lists beneath it can never disagree about it.
  const railHidden = activeClient === "all" || (
    foldersForClient(activeClient).length === 0 &&
    projectsForClient(activeClient).filter((l) => !l.folderId).length <= 1 &&
    !canAdmin
  );

  const quickAddInStage = (projectId: string, stageId: string, title: string) => {
    if (!title.trim()) return;
    const p = projectById(projectId);
    if (!p) return;
    const stage = stages.find((s) => s.id === stageId);
    const t: Task = {
      id: newId("t_"), projectId, clientId: p.clientId, title: title.trim(), description: "",
      status: stage?.isDone ? "done" : "todo", priority: "normal", assigneeId: me.id, contactId: p.clientId.slice(3), due: null,
      recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: true, private: false, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
      stageId, createdBy: me.id,
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
  };
  const moveTaskToNewProject =(taskId: string, clientId: string) => {
    setPromptDialog({ title: "New project", placeholder: "Project name", confirmLabel: "Create & move", onSubmit: (name) => {
      setPromptDialog(null);
      const p: Project = { id: newId("p_"), clientId, name, description: "" };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
      patchTask(taskId, { projectId: p.id });
      pushToast(`Moved to “${p.name}”`);
    } });
  };
  // Moving a task to a different client also has to move its project (a
  // project belongs to exactly one client) and its contact link — reuses the
  // same find-or-create-a-"Tasks"-project pattern as quickAdd. A GHL-linked
  // task is quietly unlinked rather than deleted remotely: the old link
  // points at the wrong contact once moved, but the task on GHL's side is
  // still real work someone may be tracking there — not ours to delete.
  const moveTaskToClient = (taskId: string, newClientId: string, silent?: boolean, targetProjectId?: string) => {
    const t = tasksRef.current.find((x) => x.id === taskId);
    // A move to a named project inside the client the task is already in is a
    // real move — only a move to the same client with no project named is the
    // no-op this guard is for.
    if (!t || (t.clientId === newClientId && (!targetProjectId || t.projectId === targetProjectId))) return;
    // Owner Growth Plan steps stay on their business — defense in depth
    // alongside the hidden Client/Project selects in TaskDrawer, in case
    // some other path (bulk move, a future feature) ever calls this directly.
    // A named target wins; otherwise land in the client's first project, and
    // failing that make one. Without the named target, "move to Tracy, CA"
    // could only ever mean "move to ClickUpLocal", dumping the task into
    // whichever of its projects happened to sort first.
    let projectId = (targetProjectId && projects.find((p) => p.id === targetProjectId && p.clientId === newClientId)?.id)
      ?? projects.find((p) => p.clientId === newClientId)?.id;
    if (!projectId) {
      const p: Project = { id: newId("p_"), clientId: newClientId, name: "Tasks", description: "" };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
      projectId = p.id;
    }
    const wasLinked = !!t.ghlTaskId;
    patchTask(taskId, {
      clientId: newClientId,
      projectId,
      contactId: newClientId.startsWith("cl_") && newClientId !== WORKSPACE_CLIENT_ID ? newClientId.slice(3) : null,
      ghlTaskId: null,
    });
    if (!silent) pushToast(`Moved to ${projectById(projectId)?.name ?? clientById(newClientId)?.name ?? "client"}${wasLinked ? " — unlinked from GoHighLevel" : ""}`);
  };
  // Bulk version of the above — moves every selected task in one pass with a
  // single summary toast instead of one per task. Confirmed and undoable for
  // the same reason as bulkPatch, and more so: a move rewrites client,
  // project, and contact together, so putting it back by hand is real work.
  // Destination is either a client ("c:<id>", land in its first project) or
  // one specific project ("p:<id>") — Derek: "when moving a task I can only
  // move to clients not projects", after searching the picker for "Tracy, CA"
  // and getting No matches, because Tracy is a ClickUpLocal project.
  const bulkMoveTo = (dest: string) => {
    const projectDest = dest.startsWith("p:") ? projectById(dest.slice(2)) : null;
    const clientId = projectDest ? projectDest.clientId : dest.slice(2);
    bulkMoveToClient(clientId, projectDest?.id);
  };
  const bulkMoveToClient = (clientId: string, targetProjectId?: string) => {
    const ids = [...selectedTaskIds];
    if (!ids.length) return;
    const name = (targetProjectId && projectById(targetProjectId)?.name) || clientById(clientId)?.name || "client";
    const movable = ids.filter((id) => { const t = tasks.find((x) => x.id === id); return t && (targetProjectId ? t.projectId !== targetProjectId : t.clientId !== clientId); });
    if (!movable.length) { pushToast(`Already in ${name}`); return; }
    const n = movable.length;
    const plural = n === 1 ? "" : "s";
    setConfirmDialog({
      title: `Move ${n} task${plural} to ${name}?`,
      message: `Each task's project and contact move too, and any GoHighLevel link is cleared. You can undo it right after.`,
      confirmLabel: `Move ${n} task${plural}`,
      danger: false,
      onConfirm: () => {
        const before = movable
          .map((id) => {
            const t = tasksRef.current.find((x) => x.id === id);
            return t ? { id, prev: { clientId: t.clientId, projectId: t.projectId, contactId: t.contactId, ghlTaskId: t.ghlTaskId } as Partial<Task> } : null;
          })
          .filter((x): x is { id: string; prev: Partial<Task> } => !!x);
        movable.forEach((id) => moveTaskToClient(id, clientId, true, targetProjectId));
        setConfirmDialog(null);
        clearSelection();
        pushToast(`Moved ${n} task${plural} to ${name}`, {
          label: "Undo",
          run: () => {
            before.forEach(({ id, prev }) => patchTask(id, prev));
            pushToast(`Moved ${before.length} task${before.length === 1 ? "" : "s"} back`);
          },
        });
      },
    });
  };
  // Folds one task into another — started life as "merge a Conversation task
  // into real work" but the mechanics (move messages, fold comments, delete
  // the source) apply to any two tasks, so it's now a general merge, driven
  // three ways: the picker modal (mergeSourceId), dragging one row onto
  // another (GroupedList's onMergeTasks), or checking exactly 2 and using
  // the bulk-action bar's Merge button. Always go through requestMerge below
  // — never call this directly — so every path gets the same confirmation.
  const mergeTasks = async (sourceId: string, targetId: string) => {
    const src = tasks.find((t) => t.id === sourceId);
    const target = tasks.find((t) => t.id === targetId);
    if (!src || !target || src.id === target.id) return;
    if (src.clientId !== target.clientId) { pushToast("Can't merge tasks across different clients."); return; }
    // Comments aren't lost on delete — folded into the target in
    // chronological order. A Conversation task is auto-managed and normally
    // carries none (see ghlConversationTask.ts) unless someone typed a note.
    if (src.comments.length) {
      const merged = [...target.comments, ...src.comments].sort((a, b) => a.at.localeCompare(b.at));
      update(targetId, { comments: merged });
    }
    setMessages((ms) => ms.map((m) => (m.taskId === sourceId ? { ...m, taskId: targetId } : m)));
    // Awaited, not fire-and-forget: messages.task_id references tasks(id) on
    // delete set null. Deleting the source task before this UPDATE actually
    // commits let the FK's own "set null" action win the race — the reassign
    // then matched zero rows (they'd already been nulled), permanently
    // orphaning the message from both tasks. Symptom: the message flashed
    // into the target's activity feed from the optimistic local update above,
    // then vanished again the moment the resulting realtime echo (task_id →
    // null) landed.
    await reassignMessagesTaskDb(sourceId, targetId);
    setTasks((ts) => ts.filter((t) => t.id !== sourceId));
    setOpenTaskId((id) => (id === sourceId ? targetId : id));
    deleteTaskDb(sourceId);
    pushToast(`Merged into "${target.title}"`);
  };
  // This can't be undone (the source task is deleted), so every entry point
  // routes through this confirmation instead of calling mergeTasks directly.
  const requestMerge = (sourceId: string, targetId: string) => {
    const src = tasks.find((t) => t.id === sourceId);
    const target = tasks.find((t) => t.id === targetId);
    if (!src || !target || src.id === target.id) return;
    setConfirmDialog({
      title: `Merge "${src.title}" into "${target.title}"?`,
      message: "Its messages and any notes move onto that task, and this one is removed. This can't be undone.",
      confirmLabel: "Merge",
      danger: true,
      onConfirm: () => { setConfirmDialog(null); clearSelection(); mergeTasks(sourceId, targetId); },
    });
  };
  const renameProject = (id: string) => {
    const p = projectById(id);
    if (!p) return;
    setPromptDialog({ title: "Rename project", initial: p.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const np = { ...p, name };
      setProjects((ps) => ps.map((x) => (x.id === id ? np : x)));
      upsertProject(np);
    } });
  };
  const deleteProject = (id: string) => {
    const p = projectById(id);
    const n = tasks.filter((t) => t.projectId === id).length;
    setConfirmDialog({
      title: `Delete “${p?.name}”?`,
      message: `${n ? `This also moves its ${n} task${n === 1 ? "" : "s"} to Trash. ` : ""}Restorable from Trash for 30 days.`,
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setProjects((ps) => ps.filter((x) => x.id !== id));
        setTasks((ts) => ts.filter((t) => t.projectId !== id));
        setClientNotes((ns) => ns.filter((n) => n.projectId !== id));
        deleteProjectDb(id);
      },
    });
  };

  return { createStage, addProject, renameProject, deleteProject, railHidden, createFolder, renameFolder, deleteFolder, moveListToFolder, reorderFolders, reorderLists, setTaskStage, quickAddInStage, renameStage, toggleStageIsDone, deleteStage, reorderStages, requestMerge, bulkMoveTo, moveTaskToClient, moveTaskToNewProject };
}

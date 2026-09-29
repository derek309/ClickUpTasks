"use client";

// Task templates: saving and deleting them, adding one's checklist to a task,
// and making a new task from one. Lifted out of Cockpit.tsx unchanged (audit
// 2026-09-29, 3.4).

import * as React from "react";
import { type ChecklistChange } from "./checklistChange";
import { type ConfirmSpec } from "./modals";
import { newId } from "./ui";
import { type Me, type Subtask, type Task, type TaskTemplate } from "@/lib/data";
import { deleteTaskTemplateDb, upsertTask, upsertTaskTemplate } from "@/lib/db";

export type UseTemplatesDeps = {
  setTaskTemplates: React.Dispatch<React.SetStateAction<TaskTemplate[]>>;
  taskTemplates: TaskTemplate[];
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmSpec | null>>;
  tasks: Task[];
  update: (id: string, patch: Partial<Task>, item?: ChecklistChange) => void;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  me: Me;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
};

export function useTemplates({ setTaskTemplates, taskTemplates, setConfirmDialog, tasks, update, pushToast, me, setTasks }: UseTemplatesDeps) {
  const saveTemplate = (id: string | undefined, spec: { name: string; checklistItems: string[] }) => {
    const t: TaskTemplate = { id: id ?? newId("tmpl_"), ...spec };
    setTaskTemplates((ts) => (id ? ts.map((x) => (x.id === id ? t : x)) : [...ts, t]));
    upsertTaskTemplate(t);
  };
  const deleteTemplate = (id: string) => {
    const t = taskTemplates.find((x) => x.id === id);
    setConfirmDialog({
      title: `Delete template “${t?.name ?? "this template"}”?`,
      message: "Tasks already created from it are not affected. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setTaskTemplates((ts) => ts.filter((x) => x.id !== id));
        deleteTaskTemplateDb(id);
      },
    });
  };
  // Appends a template's checklist items onto an existing task as new,
  // unchecked subtasks — one patch, not a loop of addSub calls, so it's a
  // single upsert instead of one per item.
  const applyTemplate = (taskId: string, templateId: string) => {
    const tpl = taskTemplates.find((t) => t.id === templateId);
    const t = tasks.find((x) => x.id === taskId);
    if (!tpl || !t) return;
    const added: Subtask[] = tpl.checklistItems.map((title) => ({ id: newId("s_"), title, done: false }));
    update(taskId, { subtasks: [...t.subtasks, ...added] }, { append: added });
    pushToast(`Added ${added.length} checklist item${added.length === 1 ? "" : "s"} from "${tpl.name}"`);
  };
  // Creates a brand-new task from a template — title defaults to the
  // template name, checklist pre-filled — to quickly populate a project.
  const useTemplateAsTask = (templateId: string, clientId: string, projectId: string) => {
    const tpl = taskTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const t: Task = {
      id: newId("t_"), projectId, clientId, title: tpl.name, description: "",
      status: "todo", priority: "normal", assigneeId: me.id,
      contactId: clientId.startsWith("cl_") ? clientId.slice(3) : null,
      due: null, recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: true, private: false,
      subtasks: tpl.checklistItems.map((title) => ({ id: newId("s_"), title, done: false })),
      attachments: [], comments: [], createdAt: new Date().toISOString(), createdBy: me.id,
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
    pushToast(`Created "${t.title}" from template`);
  };
  return { saveTemplate, deleteTemplate, useTemplateAsTask, applyTemplate };
}

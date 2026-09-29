"use client";

// The task composer's save: turning its parsed rows into tasks on the right
// client and list, in one request, with any pasted files attached after.
// Lifted out of Cockpit.tsx unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { type ParsedRow } from "./MindDumpModal";
import { newId } from "./ui";
import { PERSONAL_CLIENT_ID, PERSONAL_PROJECT_ID, applyWaitingStatusSync, isManuallyAssignable, plainTextToHtml, type Me, type NotificationKind, type Priority, type Project, type Task, type TaskStatus, users } from "@/lib/data";
import { bulkUpsertTasks, upsertProject } from "@/lib/db";

// A dumped task's description: what the AI summarised, then the client's own
// wording underneath as a blockquote so it stays visibly theirs. The verbatim
// half is escaped and line-broken but never reworded, which is the whole
// point of carrying it in its own field (see api/ai/parse-tasks).
function describeDumpRow(r: { description: string; verbatim: string }): string {
  const parts: string[] = [];
  if (r.description.trim()) parts.push(plainTextToHtml(r.description.trim()));
  if (r.verbatim.trim()) parts.push(`<blockquote>${plainTextToHtml(r.verbatim)}</blockquote>`);
  return parts.join("");
}

export type UseComposerDeps = {
  dumpGroup: { key: string | null; personal: boolean; clientId?: string | null; } | null;
  activeClient: string;
  groupBy: "project" | "status" | "priority" | "due";
  me: Me;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  pinJustAdded: (taskId: string) => void;
  setDumpGroup: React.Dispatch<React.SetStateAction<{ key: string | null; personal: boolean; clientId?: string | null; } | null>>;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  activeProject: string | null;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  notify: (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean; link?: string; }) => void;
  addFiles: (id: string, fileList: FileList | File[]) => Promise<void>;
};

export function useComposer({ dumpGroup, activeClient, groupBy, me, setTasks, pinJustAdded, setDumpGroup, pushToast, activeProject, projects, setProjects, notify, addFiles }: UseComposerDeps) {
  // One shared list resolution for the whole batch, so 12 tasks can't race
  // each other into creating 12 copies of a missing "Tasks" list.
  //
  // This is the single creation path for the composer, whichever plus opened
  // it: the group it was opened on decides the list, and (under a status or
  // priority grouping) the status or priority too, the same way the inline
  // quick-add used to.
  const createTasksFromDump = (rows: ParsedRow[], files: { file: File; row: number }[]) => {
    if (!rows.length || !dumpGroup) return;
    const { key: groupKey, personal } = dumpGroup;
    // The client the composer was opened for, which differs from the one on
    // screen only when it was opened from Tasks and picked inside.
    const targetClient = dumpGroup.clientId ?? activeClient;
    const now = new Date().toISOString();

    if (personal) {
      const made: Task[] = rows.map((r) => ({
        id: newId("t_"), projectId: PERSONAL_PROJECT_ID, clientId: PERSONAL_CLIENT_ID,
        title: r.title.trim(), description: describeDumpRow(r),
        status: groupKey && groupBy === "status" ? (groupKey as TaskStatus) : "todo",
        priority: r.priority, assigneeId: me.id, contactId: null,
        due: r.due, followUpAt: r.followUpAt, size: r.size,
        recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: r.priorityAuto, private: true,
        subtasks: [], attachments: [], comments: [], createdAt: now, createdBy: me.id,
      } as Task));
      setTasks((ts) => [...ts, ...made]);
      made.forEach((t) => pinJustAdded(t.id));
      bulkUpsertTasks(made, me.id);
      attachDumpFiles(made, files);
      setDumpGroup(null);
      pushToast(`Created ${made.length} task${made.length === 1 ? "" : "s"}`);
      return;
    }

    if (!targetClient.startsWith("cl_")) return;
    let projectId: string;
    // tasks.project_id is a foreign key, so a task inserted in the same tick
    // as the project it belongs to can reach Postgres first and fail the
    // constraint. When we create the list here, hold its write and chain the
    // inserts behind it.
    let projectWrite: PromiseLike<unknown> | null = null;
    // The group and activeProject only apply while the target IS the client on
    // screen: a task for another client must never land in this one's list.
    const sameClient = targetClient === activeClient;
    if (groupKey && groupBy === "project" && sameClient) projectId = groupKey;
    else if (activeProject && sameClient) projectId = activeProject;
    else {
      const existing = projects.find((pr) => pr.clientId === targetClient);
      if (existing) projectId = existing.id;
      else { const pr: Project = { id: newId("p_"), clientId: targetClient, name: "Tasks", description: "" }; setProjects((ps) => [...ps, pr]); projectWrite = upsertProject(pr); projectId = pr.id; }
    }
    const made: Task[] = rows.map((r) => {
      const waiting = r.assignee === "client";
      const member = r.assignee && r.assignee !== "client" ? users.find((u) => u.name === r.assignee) : null;
      return {
        id: newId("t_"), projectId, clientId: targetClient, title: r.title.trim(), description: describeDumpRow(r),
        status: groupKey && groupBy === "status" ? (groupKey as TaskStatus) : "todo",
        // isManuallyAssignable guards Conversation (auto-created-only, see
        // data.ts): a dump into that group still lands as the row's own
        // priority rather than manually assigning the reserved tier.
        priority: groupKey && groupBy === "priority" && isManuallyAssignable(groupKey as Priority) ? (groupKey as Priority) : r.priority,
        // Assignee defaults to whoever is dumping (Derek: "they're always
        // going to be defaulted to the person who is creating them") — the AI
        // only overrides it when the notes name someone else outright. A task
        // waiting on the client still has that owner (see applyWaitingStatusSync).
        assigneeId: member?.id ?? me.id, waitingOnClient: waiting,
        contactId: targetClient.slice(3),
        due: r.due, followUpAt: r.followUpAt, size: r.size,
        recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: r.priorityAuto,
        private: false, subtasks: [], attachments: [], comments: [], createdAt: now, createdBy: me.id,
      } as Task;
    });
    // waiting/status must move together — the one rule that owns that lives in
    // applyWaitingStatusSync, so route each one through it rather than hand
    // rolling it here.
    const synced = made.map((t) => ({ ...t, ...applyWaitingStatusSync({ status: t.status, waitingOnClient: t.waitingOnClient }, { waitingOnClient: t.waitingOnClient }) }));
    setTasks((ts) => [...ts, ...synced]);
    // Pinned so a task created into a group the current sort or filter would
    // hide does not vanish the moment it is made.
    synced.forEach((t) => pinJustAdded(t.id));
    const write = () => { bulkUpsertTasks(synced, me.id); attachDumpFiles(synced, files); };
    if (projectWrite) projectWrite.then(write); else write();
    setDumpGroup(null);
    pushToast(`Created ${synced.length} task${synced.length === 1 ? "" : "s"}`);
    synced.forEach((t) => { if (t.assigneeId && t.assigneeId !== me.id) notify(t.assigneeId, `${me.name} assigned you \u201C${t.title}\u201D`, t.id); });
  };

  // A pasted file is uploaded after its task exists, because an attachment
  // needs a row to hang on. The modal already decided which task each one
  // belongs to.
  const attachDumpFiles = (made: Task[], files: { file: File; row: number }[]) => {
    files.forEach((f) => { const t = made[f.row]; if (t) void addFiles(t.id, [f.file]); });
  };

  return { createTasksFromDump };
}

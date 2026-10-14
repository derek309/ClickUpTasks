"use client";

// The task composer's save: turning its parsed rows into tasks on the right
// client and list, in one request, with any pasted files attached after.
// Lifted out of Cockpit.tsx unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { type ParsedRow } from "./MindDumpModal";
import { newId } from "./ui";
import { directionsOntoStepOne, PERSONAL_CLIENT_ID, PERSONAL_PROJECT_ID, TODAY, addBusinessDaysIso, statusForStep, stepStage, userById, type Subtask, applyWaitingStatusSync, isManuallyAssignable, plainTextToHtml, type Me, type NotificationKind, type Priority, type Project, type Task, type TaskStatus, users } from "@/lib/data";
import { bulkUpsertTasks, tidyIfLong, upsertProject } from "@/lib/db";
import { authedFetch } from "@/lib/supabase";
import { applyStepOne, type StepOneOpen } from "@/lib/newTaskStep";
import { placeNewTask } from "@/lib/newTaskQueue";
import { queueSettings, type QPatch } from "../../../mcp/queue.mjs";

/** What to open on a task once it is saved: step 1's page on its box, its
 *  email window, or the ask to the client (TaskDrawer `start`). */
export type TaskStart = { taskId: string; stepId: string; open: StepOneOpen; when: string | null };

/** A queue patch as Task fields. */
function queueFields(p: QPatch): Partial<Task> {
  const f: Partial<Task> = {};
  if (p.queuePos !== undefined) f.queuePos = p.queuePos;
  if (p.due !== undefined) f.due = p.due;
  if (p.queueSavedDue !== undefined) f.queueSavedDue = p.queueSavedDue;
  return f;
}

// A dumped task's directions, on step 1 (Derek, 2026-10-14: no task
// description): what the AI summarised, then the client's own wording
// underneath as a blockquote so it stays visibly theirs. The verbatim
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
  /** The tasks as they are now, for a queue list's line. */
  tasksRef: React.RefObject<Task[]>;
  /** useTaskEdits' queue writes, for a task the new one moved in the line. */
  applyQueuePatches: (patches: QPatch[]) => void;
  /** Opens the task made, with step 1's action started on it. */
  openTaskWith: (start: TaskStart) => void;
  today: string;
};

export function useComposer({ dumpGroup, activeClient, groupBy, me, setTasks, pinJustAdded, setDumpGroup, pushToast, activeProject, projects, setProjects, notify, addFiles, tasksRef, applyQueuePatches, openTaskWith, today }: UseComposerDeps) {
  /** The list the composer will create into, when it already exists: the
   *  group it was opened on, the list on screen, or the client's first list.
   *  Null for your own list, no client yet, or a list still to be made. */
  const targetProjectId = (): string | null => {
    if (!dumpGroup || dumpGroup.personal) return null;
    const targetClient = dumpGroup.clientId ?? activeClient;
    if (!targetClient.startsWith("cl_")) return null;
    const sameClient = targetClient === activeClient;
    if (dumpGroup.key && groupBy === "project" && sameClient) return dumpGroup.key;
    if (activeProject && sameClient) return activeProject;
    return projects.find((pr) => pr.clientId === targetClient)?.id ?? null;
  };
  // Step 1 set up in the box, and a task to open once it is saved.
  const withStepOne = (t: Task, r: ParsedRow) => {
    const s = applyStepOne(t.subtasks, { setup: r.step1, title: t.title, owner: t.assigneeId ?? me.id, meId: me.id, today, now: t.createdAt, makeId: () => newId("s_") });
    return { task: s.subtasks === t.subtasks ? t : { ...t, subtasks: s.subtasks }, start: s.open && s.stepId ? { taskId: t.id, stepId: s.stepId, open: s.open, when: r.step1?.when ?? null } : null };
  };

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
      const stepped = rows.map((r) => ({
        id: newId("t_"), projectId: PERSONAL_PROJECT_ID, clientId: PERSONAL_CLIENT_ID,
        title: r.title.trim(), description: "",
        status: groupKey && groupBy === "status" ? (groupKey as TaskStatus) : "todo",
        priority: r.priority, assigneeId: me.id, contactId: null,
        due: r.due, followUpAt: r.followUpAt, size: r.size,
        recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: r.priorityAuto, private: true,
        subtasks: directionsOntoStepOne([], describeDumpRow(r), r.title, () => newId("s_"), now), attachments: [], comments: [], createdAt: now, createdBy: me.id,
      } as Task)).map((t, i) => withStepOne(t, rows[i]));
      const made = stepped.map((x) => x.task);
      setTasks((ts) => [...ts, ...made]);
      made.forEach((t) => pinJustAdded(t.id));
      const start = stepped.length === 1 ? stepped[0].start : null;
      void Promise.resolve(bulkUpsertTasks(made, me.id)).then(() => { if (start) openTaskWith(start); });
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
      const owner = member?.id ?? me.id;
      // Delegated as it is made (Derek, 2026-10-13): step 1 is theirs, the task
      // stays yours and comes back the business day after it is due.
      const to = r.delegateTo && r.delegateTo !== owner ? r.delegateTo : null;
      // Claude's step is due today with no follow up (Derek, 2026-10-13).
      const claude = to === "u_claude";
      // Its date is step 1's By when, else the task's.
      const stepDue = r.step1?.when ?? r.due;
      const step: Subtask | null = to ? { id: newId("s_"), title: `For ${userById(to)?.name.split(" ")[0] ?? "them"}`, done: false, assigneeId: to, due: claude ? TODAY : stepDue, ...(claude ? {} : { followUpAt: TODAY }), startedAt: now } : null;
      const handoff = step ? { status: statusForStep("todo", stepStage(step, owner)) ?? "todo", followUpAt: claude ? null : stepDue ? addBusinessDaysIso(stepDue, 1) : r.followUpAt } : null;
      return {
        id: newId("t_"), projectId, clientId: targetClient, title: r.title.trim(), description: "",
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
        private: false, subtasks: directionsOntoStepOne(step ? [step] : [], describeDumpRow(r), r.title, () => newId("s_"), now), attachments: [], comments: [], createdAt: now, createdBy: me.id,
        ...(r.deadline && r.due ? { deadline: true } : {}),
        ...(handoff && !waiting ? handoff : {}),
      } as Task;
    });
    // waiting/status must move together — the one rule that owns that lives in
    // applyWaitingStatusSync, so route each one through it rather than hand
    // rolling it here.
    const stepped = made.map((t, i) => withStepOne({ ...t, ...applyWaitingStatusSync({ status: t.status, waitingOnClient: t.waitingOnClient }, { waitingOnClient: t.waitingOnClient }) }, rows[i]));
    // A queue list (mcp/queue.mjs): each takes its place in the line as it is
    // made, the place picked in the box or the one its priority gives, the
    // same rule as a task moved into the list, and the Now check runs, so a
    // task placed now is dated today. Written with the task, so its place is
    // never missing.
    const q = queueSettings(projects.find((pr) => pr.id === projectId)?.queue);
    const placed: Task[] = [];
    stepped.forEach(({ task: t }, i) => {
      if (!q) { placed.push(t); return; }
      const list = [...tasksRef.current.filter((x) => x.projectId === projectId), ...placed];
      const { self, others } = placeNewTask(list, q, t, rows[i].queueAt ?? null, today);
      // Another task's place moves only when the line had to be renumbered.
      const ours = new Map(others.filter((p) => placed.some((x) => x.id === p.id)).map((p) => [p.id, p]));
      placed.forEach((x, k) => { const p = ours.get(x.id); if (p) placed[k] = { ...x, ...queueFields(p) }; });
      applyQueuePatches(others.filter((p) => !ours.has(p.id)));
      placed.push({ ...t, ...queueFields(self) });
    });
    const synced = placed;
    setTasks((ts) => [...ts, ...synced]);
    // Pinned so a task created into a group the current sort or filter would
    // hide does not vanish the moment it is made.
    synced.forEach((t) => pinJustAdded(t.id));
    // A task typed as the whole request gets its short name and the request
    // as step 1's directions once saved (lib/tidyTitle).
    const start = stepped.length === 1 ? stepped[0].start : null;
    const write = () => { void Promise.resolve(bulkUpsertTasks(synced, me.id)).then(() => { if (start) openTaskWith(start); }).then(() => synced.forEach((t) => {
      tidyIfLong(t.id, t.title);
      // Delegated to Claude as it was made: Claude starts in the cloud (lib/claudeCloud).
      const claudeStep = t.subtasks.find((x) => x.assigneeId === "u_claude" && !x.done);
      if (claudeStep) void authedFetch(`/api/tasks/${encodeURIComponent(t.id)}/claude-cloud`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepId: claudeStep.id }) }).catch(() => undefined);
    })); attachDumpFiles(synced, files); };
    if (projectWrite) projectWrite.then(write); else write();
    setDumpGroup(null);
    pushToast(`Created ${synced.length} task${synced.length === 1 ? "" : "s"}`);
    synced.forEach((t) => { if (t.assigneeId && t.assigneeId !== me.id) notify(t.assigneeId, `${me.name} assigned you \u201C${t.title}\u201D`, t.id); });
    synced.forEach((t) => { const to = t.subtasks[0]?.assigneeId; if (to && to !== t.assigneeId && userById(to) && to !== "u_claude") notify(to, `${me.name} gave you a step on \u201C${t.title}\u201D`, t.id); });
  };

  // A pasted file is uploaded after its task exists, because an attachment
  // needs a row to hang on. The modal already decided which task each one
  // belongs to.
  const attachDumpFiles = (made: Task[], files: { file: File; row: number }[]) => {
    files.forEach((f) => { const t = made[f.row]; if (t) void addFiles(t.id, [f.file]); });
  };

  return { createTasksFromDump, targetProjectId };
}

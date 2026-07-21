"use client";

// Playbooks: a named list of separate tasks, loaded onto a client at once —
// e.g. "Prospect" (a first-touch sequence) or "Claimed" (an onboarding
// kickoff list). Distinct from Task templates (one task's checklist) — see
// TemplatesPanel.tsx. Loaded manually today via "Load…"; the plan is to
// eventually trigger a playbook automatically when a client enters a given
// stage, but that trigger doesn't exist yet.
import { useState } from "react";
import { PRIORITY_META, PRIORITY_ORDER, type Playbook, type PlaybookTask, type Priority, type Client, type Project } from "@/lib/data";
import { I } from "./cockpit/ui";

// Playbook tasks are only ever manually assigned in the editor UI — never
// "conversation", which is reserved/auto-created only.
const ASSIGNABLE_PRIORITIES = PRIORITY_ORDER.filter((p) => p !== "conversation");

type DraftTask = { title: string; dueOffsetDays: string; priority: Priority };
const emptyDraftTask = (): DraftTask => ({ title: "", dueOffsetDays: "", priority: "normal" });

export default function PlaybooksPanel({ playbooks, clients, projects, onSave, onDelete, onLoad }: {
  playbooks: Playbook[];
  clients: Client[];
  projects: Project[];
  onSave: (id: string | undefined, spec: { name: string; tasks: PlaybookTask[] }) => void;
  onDelete: (id: string) => void;
  onLoad: (playbookId: string, clientId: string, projectId: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([emptyDraftTask()]);
  const [loadOpenId, setLoadOpenId] = useState<string | null>(null);
  const [loadClientId, setLoadClientId] = useState("");
  const [loadProjectId, setLoadProjectId] = useState("");

  const usableClients = clients.filter((c) => c.id.startsWith("cl_"));

  const startAdd = () => { setEditId(null); setName(""); setDraftTasks([emptyDraftTask()]); setAddOpen(true); };
  const startEdit = (p: Playbook) => {
    setEditId(p.id);
    setName(p.name);
    setDraftTasks(p.tasks.length
      ? p.tasks.map((t) => ({ title: t.title, dueOffsetDays: typeof t.dueOffsetDays === "number" ? String(t.dueOffsetDays) : "", priority: t.priority ?? "normal" }))
      : [emptyDraftTask()]);
    setAddOpen(true);
  };
  const patchDraftTask = (i: number, patch: Partial<DraftTask>) => setDraftTasks((ds) => ds.map((d, x) => (x === i ? { ...d, ...patch } : d)));
  const removeDraftTask = (i: number) => setDraftTasks((ds) => (ds.length > 1 ? ds.filter((_, x) => x !== i) : ds));
  const submit = () => {
    if (!name.trim()) return;
    const tasks: PlaybookTask[] = draftTasks
      .filter((d) => d.title.trim())
      .map((d) => ({
        title: d.title.trim(),
        dueOffsetDays: d.dueOffsetDays.trim() === "" ? null : Math.max(0, parseInt(d.dueOffsetDays, 10) || 0),
        priority: d.priority,
      }));
    if (!tasks.length) return;
    onSave(editId ?? undefined, { name: name.trim(), tasks });
    setAddOpen(false);
  };
  const openLoad = (id: string) => { setLoadOpenId(id); setLoadClientId(""); setLoadProjectId(""); };
  const submitLoad = () => {
    if (!loadOpenId || !loadClientId || !loadProjectId) return;
    onLoad(loadOpenId, loadClientId, loadProjectId);
    setLoadOpenId(null);
  };

  return (
    <div>
        <div className="border-b bg-background/40 px-5 py-3">
          {addOpen ? (
            <div className="space-y-2.5">
              <div>
                <label className="block text-[13px] font-medium text-muted">Playbook name</label>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prospect"
                  className="mt-1 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted">Tasks</label>
                <div className="mt-1 space-y-1.5">
                  {draftTasks.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input value={d.title} onChange={(e) => patchDraftTask(i, { title: e.target.value })} placeholder="Task title"
                        className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-accent" />
                      <input type="number" min={0} value={d.dueOffsetDays} onChange={(e) => patchDraftTask(i, { dueOffsetDays: e.target.value })}
                        title="Due N days after the playbook is loaded — blank for no due date" placeholder="Due in…"
                        className="w-20 shrink-0 rounded-md border bg-surface px-2 py-1.5 text-[14px] outline-none focus:border-accent" />
                      <select value={d.priority} onChange={(e) => patchDraftTask(i, { priority: e.target.value as Priority })}
                        className="shrink-0 rounded-md border bg-surface px-1.5 py-1.5 text-[13px] outline-none focus:border-accent">
                        {ASSIGNABLE_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
                      </select>
                      <button onClick={() => removeDraftTask(i)} title="Remove task" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-danger"><I.close /></button>
                    </div>
                  ))}
                </div>
                <button onClick={() => setDraftTasks((ds) => [...ds, emptyDraftTask()])} className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                  <I.plus /> Add task
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setAddOpen(false)} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
                <button onClick={submit} disabled={!name.trim() || !draftTasks.some((d) => d.title.trim())} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{editId ? "Save" : "Add playbook"}</button>
              </div>
            </div>
          ) : (
            <button onClick={startAdd} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
              <I.plus /> Add playbook
            </button>
          )}
        </div>

        <div className="px-5 py-3">
          {playbooks.length === 0 && (
            <div className="py-8 text-center text-[13px] text-muted">No playbooks yet — click &quot;Add playbook&quot; to create one.</div>
          )}
          {playbooks.map((p) => (
            <div key={p.id} className="mb-2 rounded-xl border">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <I.bookmark className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{p.name}</div>
                  <div className="truncate text-[13px] text-muted">{p.tasks.length} task{p.tasks.length === 1 ? "" : "s"}</div>
                </div>
                <button onClick={() => openLoad(p.id)} className="shrink-0 rounded-md border border-accent px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">Load…</button>
                <button onClick={() => startEdit(p)} title="Edit" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-foreground"><I.pencil /></button>
                <button onClick={() => onDelete(p.id)} title="Delete playbook" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
              </div>
              {loadOpenId === p.id && (
                <div className="flex flex-wrap items-center gap-2 border-t bg-background/40 px-3 py-2.5">
                  <select value={loadClientId} onChange={(e) => { setLoadClientId(e.target.value); setLoadProjectId(""); }} className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent">
                    <option value="">Pick a client…</option>
                    {usableClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={loadProjectId} onChange={(e) => setLoadProjectId(e.target.value)} disabled={!loadClientId} className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent disabled:opacity-50">
                    <option value="">Pick a project…</option>
                    {projects.filter((pr) => pr.clientId === loadClientId).map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                  <button onClick={submitLoad} disabled={!loadClientId || !loadProjectId} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Load {p.tasks.length} task{p.tasks.length === 1 ? "" : "s"}</button>
                  <button onClick={() => setLoadOpenId(null)} className="shrink-0 rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
    </div>
  );
}

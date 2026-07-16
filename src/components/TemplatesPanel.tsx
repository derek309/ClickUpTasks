"use client";

// Reusable task templates: a name + a checklist of item titles. Applied
// either by appending the checklist onto an already-open task (see the
// "+ From template" button in TaskDrawer.tsx), or from here to spin up a
// brand-new task — title defaults to the template name — in a chosen
// client/project, for quickly populating a project with a standard list of
// tasks.
import { useState } from "react";
import { type TaskTemplate, type Client, type Project } from "@/lib/data";
import { I } from "./cockpit/ui";

export default function TemplatesPanel({ templates, clients, projects, onSave, onDelete, onUseAsTask }: {
  templates: TaskTemplate[];
  clients: Client[];
  projects: Project[];
  onSave: (id: string | undefined, spec: { name: string; checklistItems: string[] }) => void;
  onDelete: (id: string) => void;
  onUseAsTask: (templateId: string, clientId: string, projectId: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [useOpenId, setUseOpenId] = useState<string | null>(null);
  const [useClientId, setUseClientId] = useState("");
  const [useProjectId, setUseProjectId] = useState("");

  const usableClients = clients.filter((c) => c.id.startsWith("cl_"));

  const startAdd = () => { setEditId(null); setName(""); setItemsText(""); setAddOpen(true); };
  const startEdit = (t: TaskTemplate) => { setEditId(t.id); setName(t.name); setItemsText(t.checklistItems.join("\n")); setAddOpen(true); };
  const submit = () => {
    const checklistItems = itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!name.trim()) return;
    onSave(editId ?? undefined, { name: name.trim(), checklistItems });
    setAddOpen(false);
  };
  const openUse = (id: string) => { setUseOpenId(id); setUseClientId(""); setUseProjectId(""); };
  const submitUse = () => {
    if (!useOpenId || !useClientId || !useProjectId) return;
    onUseAsTask(useOpenId, useClientId, useProjectId);
    setUseOpenId(null);
  };

  return (
    <div>
        <div className="border-b bg-background/40 px-5 py-3">
          {addOpen ? (
            <div className="space-y-2.5">
              <div>
                <label className="block text-[13px] font-medium text-muted">Template name</label>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New client onboarding" onKeyDown={(e) => { if (e.key === "Escape") setAddOpen(false); }}
                  className="mt-1 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted">Checklist items (one per line)</label>
                <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={5} placeholder={"Set up GHL sub-account\nConnect domain\nSchedule kickoff call"}
                  className="mt-1 w-full resize-y rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setAddOpen(false)} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
                <button onClick={submit} disabled={!name.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{editId ? "Save" : "Add template"}</button>
              </div>
            </div>
          ) : (
            <button onClick={startAdd} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
              <I.plus /> Add template
            </button>
          )}
        </div>

        <div className="px-5 py-3">
          {templates.length === 0 && (
            <div className="py-8 text-center text-[13px] text-muted">No templates yet — click &quot;Add template&quot; to create one.</div>
          )}
          {templates.map((t) => (
            <div key={t.id} className="mb-2 rounded-xl border">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <I.clipboard className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{t.name}</div>
                  <div className="truncate text-[13px] text-muted">{t.checklistItems.length} checklist item{t.checklistItems.length === 1 ? "" : "s"}</div>
                </div>
                <button onClick={() => openUse(t.id)} className="shrink-0 rounded-md border border-accent px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">Use…</button>
                <button onClick={() => startEdit(t)} title="Edit" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-foreground"><I.pencil /></button>
                <button onClick={() => onDelete(t.id)} title="Delete template" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
              </div>
              {useOpenId === t.id && (
                <div className="flex flex-wrap items-center gap-2 border-t bg-background/40 px-3 py-2.5">
                  <select value={useClientId} onChange={(e) => { setUseClientId(e.target.value); setUseProjectId(""); }} className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent">
                    <option value="">Pick a client…</option>
                    {usableClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={useProjectId} onChange={(e) => setUseProjectId(e.target.value)} disabled={!useClientId} className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent disabled:opacity-50">
                    <option value="">Pick a project…</option>
                    {projects.filter((p) => p.clientId === useClientId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button onClick={submitUse} disabled={!useClientId || !useProjectId} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Create task</button>
                  <button onClick={() => setUseOpenId(null)} className="shrink-0 rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
    </div>
  );
}

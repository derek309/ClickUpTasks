"use client";

// Reusable plans (task templates): a name and its steps. Each step can carry
// its stage, the deliverable it makes and what it needs (task detail redesign
// phase 5, 2026-10-11, Derek: "stage the stages to use with other clients or
// for that client"), and a plan can be one client's or everyone's. Applied by
// appending the steps onto an open task ("From template" on its Steps), from
// a task's own "Save as template", or from here to make a new task, titled
// after the plan, in a chosen client and list.
import { useState } from "react";
import { type TaskTemplate, type TemplateStep, type Client, type Project, type DeliverableKey, type TaskStatus, STATUS_META, STEP_STAGES, templateSteps, compactTemplateStep } from "@/lib/data";
import { I, SearchableSelect } from "./cockpit/ui";

const MAKES: { key: DeliverableKey; label: string }[] = [
  { key: "doc", label: "Client document" }, { key: "image", label: "Image review" }, { key: "page", label: "HTML review" },
  { key: "video", label: "Video review" }, { key: "brief", label: "Project instructions" }, { key: "email", label: "Draft email" },
];
const makesLabel = (k?: DeliverableKey) => MAKES.find((m) => m.key === k)?.label ?? null;

type Row = { title: string; stage: TaskStatus | ""; makes: DeliverableKey | ""; needs: string };
const toRow = (x: TemplateStep): Row => ({ title: x.title, stage: x.stage ?? "", makes: x.makes ?? "", needs: (x.needs ?? []).join(", ") });
const blankRow = (): Row => ({ title: "", stage: "", makes: "", needs: "" });

export default function TemplatesPanel({ templates, clients, projects, onSave, onDelete, onUseAsTask }: {
  templates: TaskTemplate[];
  clients: Client[];
  projects: Project[];
  onSave: (id: string | undefined, spec: { name: string; checklistItems: TaskTemplate["checklistItems"]; clientId?: string | null }) => void;
  onDelete: (id: string) => void;
  onUseAsTask: (templateId: string, clientId: string, projectId: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [forClient, setForClient] = useState("");
  const [wasClient, setWasClient] = useState(false);
  const [useOpenId, setUseOpenId] = useState<string | null>(null);
  const [useClientId, setUseClientId] = useState("");
  const [useProjectId, setUseProjectId] = useState("");

  const usableClients = clients.filter((c) => c.id.startsWith("cl_"));
  const clientOptions = usableClients.map((c) => ({ value: c.id, label: c.name }));
  const clientName = (id?: string | null) => (id ? clients.find((c) => c.id === id)?.name ?? "one client" : null);

  const startAdd = () => { setEditId(null); setName(""); setRows([blankRow()]); setForClient(""); setWasClient(false); setAddOpen(true); };
  const startEdit = (t: TaskTemplate) => {
    setEditId(t.id); setName(t.name);
    const steps = templateSteps(t).map(toRow);
    setRows(steps.length ? steps : [blankRow()]);
    setForClient(t.clientId ?? ""); setWasClient(!!t.clientId); setAddOpen(true);
  };
  const patchRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = () => {
    if (!name.trim()) return;
    const checklistItems = rows.filter((r) => r.title.trim()).map((r) => compactTemplateStep({
      title: r.title, stage: r.stage || undefined, makes: r.makes || undefined, needs: r.needs.split(",").map((n) => n.trim()).filter(Boolean),
    }));
    // null clears a client only on a plan that had one; a new everyone plan leaves it unset.
    onSave(editId ?? undefined, { name: name.trim(), checklistItems, ...(forClient ? { clientId: forClient } : wasClient ? { clientId: null } : {}) });
    setAddOpen(false);
  };
  const openUse = (t: TaskTemplate) => { setUseOpenId(t.id); setUseClientId(t.clientId ?? ""); setUseProjectId(""); };
  const submitUse = () => {
    if (!useOpenId || !useClientId || !useProjectId) return;
    onUseAsTask(useOpenId, useClientId, useProjectId);
    setUseOpenId(null);
  };

  const field = "w-full rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent";
  return (
    <div>
        <div className="border-b bg-background/40 px-5 py-3">
          {addOpen ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="tpl-name" className="block text-[16px] font-medium text-muted">Template name</label>
                  <input id="tpl-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BibBoards email campaign" onKeyDown={(e) => { if (e.key === "Escape") setAddOpen(false); }}
                    className={`mt-1 ${field}`} />
                </div>
                <div>
                  <span className="block text-[16px] font-medium text-muted">For</span>
                  <div className="mt-1">
                    <SearchableSelect value={forClient} onChange={setForClient} options={[{ value: "", label: "Everyone" }, ...clientOptions]}
                      placeholder="Everyone" searchPlaceholder="Search clients…" className="rounded-md border bg-surface px-2.5 py-1.5 text-[16px] focus:border-accent" />
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[16px] font-medium text-muted">Steps, in order</div>
                <ol className="mt-1 space-y-2">
                  {rows.map((r, i) => (
                    <li key={i} className="rounded-[5px] border bg-surface p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-center text-[16px] font-semibold text-muted">{i + 1}</span>
                        <input value={r.title} onChange={(e) => patchRow(i, { title: e.target.value })} placeholder="Step, like: Write the email" aria-label={`Step ${i + 1}`} className={`min-w-0 flex-1 ${field}`} />
                        <button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blankRow()]))} title="Remove this step" aria-label={`Remove step ${i + 1}`}
                          className="shrink-0 rounded p-1.5 text-muted hover:bg-background hover:text-danger"><I.trash className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-2 grid gap-2 pl-8 sm:grid-cols-3">
                        <select value={r.stage} onChange={(e) => patchRow(i, { stage: e.target.value as TaskStatus | "" })} aria-label={`Stage for step ${i + 1}`} className={field}>
                          <option value="">Stage from its words</option>
                          {STEP_STAGES.map((st) => <option key={st} value={st}>{STATUS_META[st].label}</option>)}
                        </select>
                        <select value={r.makes} onChange={(e) => patchRow(i, { makes: e.target.value as DeliverableKey | "" })} aria-label={`What step ${i + 1} makes`} className={field}>
                          <option value="">Makes nothing</option>
                          {MAKES.map((m) => <option key={m.key} value={m.key}>Makes: {m.label}</option>)}
                        </select>
                        <input value={r.needs} onChange={(e) => patchRow(i, { needs: e.target.value })} placeholder="Needs, like: store list link, photos" aria-label={`What step ${i + 1} needs`} className={field} />
                      </div>
                    </li>
                  ))}
                </ol>
                <button onClick={() => setRows((rs) => [...rs, blankRow()])} className="mt-2 inline-flex items-center gap-1.5 text-[16px] font-medium text-accent"><I.plus /> Add step</button>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setAddOpen(false)} className="rounded-md border px-3 py-1.5 text-[16px] font-medium hover:bg-background">Cancel</button>
                <button onClick={submit} disabled={!name.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">{editId ? "Save" : "Add template"}</button>
              </div>
            </div>
          ) : (
            <button onClick={startAdd} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">
              <I.plus /> Add template
            </button>
          )}
        </div>

        <div className="px-5 py-3">
          {templates.length === 0 && (
            <div className="py-8 text-center text-[16px] text-muted">No templates yet. Click &quot;Add template&quot;, or save a task&apos;s steps from the task.</div>
          )}
          {templates.map((t) => {
            const steps = templateSteps(t);
            return (
              <div key={t.id} className="mb-2 rounded-[5px] border">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <I.clipboard className="shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-medium">{t.name}</div>
                    <div className="truncate text-[16px] text-muted">{steps.length} {steps.length === 1 ? "step" : "steps"} · {clientName(t.clientId) ?? "Everyone"}</div>
                  </div>
                  <button onClick={() => openUse(t)} className="shrink-0 rounded-md border border-accent px-2.5 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft">Use…</button>
                  <button onClick={() => startEdit(t)} title="Edit" aria-label={`Edit ${t.name}`} className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-foreground"><I.pencil /></button>
                  <button onClick={() => onDelete(t.id)} title="Delete template" aria-label={`Delete ${t.name}`} className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
                </div>
                {steps.some((x) => x.stage || x.makes || x.needs?.length) && (
                  <ol className="border-t px-3 py-2 text-[16px]">
                    {steps.map((x, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 py-0.5">
                        <span className="w-5 shrink-0 text-muted">{i + 1}</span>
                        <span className="font-medium">{x.title}</span>
                        {x.stage && <span className="text-muted">· {STATUS_META[x.stage].label}</span>}
                        {x.makes && <span className="text-muted">· makes {makesLabel(x.makes)}</span>}
                        {!!x.needs?.length && <span className="text-muted">· needs {x.needs.join(", ")}</span>}
                      </li>
                    ))}
                  </ol>
                )}
                {useOpenId === t.id && (
                  <div className="flex flex-wrap items-center gap-2 border-t bg-background/40 px-3 py-2.5">
                    <div className="min-w-0 flex-1"><SearchableSelect value={useClientId} onChange={(v) => { setUseClientId(v); setUseProjectId(""); }}
                      options={clientOptions} placeholder="Pick a client…" searchPlaceholder="Search clients…"
                      className="rounded-md border bg-surface px-2.5 py-1.5 text-[16px] focus:border-accent" /></div>
                    <select value={useProjectId} onChange={(e) => setUseProjectId(e.target.value)} disabled={!useClientId} aria-label="List" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent disabled:opacity-50">
                      <option value="">Pick a list…</option>
                      {projects.filter((p) => p.clientId === useClientId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button onClick={submitUse} disabled={!useClientId || !useProjectId} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Create task</button>
                    <button onClick={() => setUseOpenId(null)} className="shrink-0 rounded-md border px-3 py-1.5 text-[16px] font-medium hover:bg-background">Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
}

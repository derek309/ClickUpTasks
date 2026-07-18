"use client";

// The global quick-add-task modal, opened by the floating "+" button. Pre-fills
// the client/list from wherever you are (still changeable), and creates a task
// via the same path as the inline grouped-list quick-add (assignee = you).
import { useEffect, useRef, useState } from "react";
import { type Client, type Project, type Priority, PRIORITY_ORDER, PRIORITY_META, isManuallyAssignable } from "@/lib/data";

export function QuickAddTask({
  clients, projectsFor, companyFor, defaultClientId, defaultProjectId, onCreate, onClose,
}: {
  clients: Client[];
  projectsFor: (clientId: string) => Project[];
  companyFor: (clientId: string) => string | undefined;
  defaultClientId: string;         // "" when there's no client context
  defaultProjectId: string | null;
  onCreate: (clientId: string, projectId: string | null, title: string, due: string | null, priority: Priority) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState(defaultClientId);
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const lists = clientId ? projectsFor(clientId) : [];
  const priorities = PRIORITY_ORDER.filter(isManuallyAssignable);
  const canCreate = !!title.trim() && !!clientId;

  const submit = () => {
    if (!title.trim() || !clientId) return;
    onCreate(clientId, projectId || null, title.trim(), due || null, priority);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-5 shadow-xl"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <h2 className="text-[16px] font-semibold">New task</h2>

        <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); submit(); } }}
          placeholder="What needs doing?"
          className="mt-3 w-full rounded-md border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Client</span>
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(""); }}
              className="w-full rounded-md border bg-background px-2 py-2 text-[15px] outline-none focus:border-accent">
              <option value="">Select a client…</option>
              {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => {
                const co = companyFor(c.id);
                return <option key={c.id} value={c.id}>{c.name}{co ? ` — ${co}` : ""}</option>;
              })}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">List</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}
              className="w-full rounded-md border bg-background px-2 py-2 text-[15px] outline-none focus:border-accent disabled:opacity-50">
              <option value="">Default (Tasks list)</option>
              {lists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Due date</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-2 text-[15px] outline-none focus:border-accent" />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full rounded-md border bg-background px-2 py-2 text-[15px] outline-none focus:border-accent">
              {priorities.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
          <button onClick={submit} disabled={!canCreate}
            className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Create task</button>
        </div>
      </div>
    </>
  );
}

"use client";

// The global quick-add-task modal. Pre-fills
// the client/list from wherever you are (still changeable), and creates a task
// via the same path as the inline grouped-list quick-add (assignee = you).
import { useEffect, useRef, useState } from "react";
import { type Client, type Project, type Priority, type TaskSize, PRIORITY_ORDER, PRIORITY_META, SIZE_META, SIZE_ORDER, isManuallyAssignable } from "@/lib/data";
import { SearchableSelect } from "./ui";

export function QuickAddTask({
  clients, projectsFor, companyFor, defaultClientId, defaultProjectId, onCreate, onClose,
}: {
  clients: Client[];
  projectsFor: (clientId: string) => Project[];
  companyFor: (clientId: string) => string | undefined;
  defaultClientId: string;         // "" when there's no client context
  defaultProjectId: string | null;
  onCreate: (clientId: string, projectId: string | null, title: string, due: string | null, priority: Priority, followUpAt: string | null, size: TaskSize | null) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState(defaultClientId);
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [due, setDue] = useState("");
  // Asked for at creation, not left for someone to fill in later (Derek: "when
  // we create a task we have to make sure that we ask for the due date, the
  // follow-up date, and how long it's gonna take"). Ninety-odd open tasks with
  // no date on them is what happens when these are optional afterthoughts, and
  // the plan cannot place a task nobody has sized.
  const [followUp, setFollowUp] = useState("");
  const [size, setSize] = useState<TaskSize | null>(null);
  const [priority, setPriority] = useState<Priority>("normal");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const lists = clientId ? projectsFor(clientId) : [];
  // The business name rides along as `sub` so it's both visible and
  // searchable — two clients can share a first name, the company never does.
  const clientOptions = [...clients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name, sub: companyFor(c.id) }));
  const priorities = PRIORITY_ORDER.filter(isManuallyAssignable);
  // Required, not encouraged (Derek: "make it required"). A task with no date
  // and no size cannot be planned, cannot surface on My Work, and is how
  // ninety odd open tasks ended up with nothing on them. The form is the last
  // place anyone has the answers in their head.
  const missing = [
    !title.trim() && "a title",
    !clientId && "a client",
    !due && "a due date",
    !followUp && "a follow-up date",
    !size && "how long it takes",
  ].filter(Boolean) as string[];
  const canCreate = missing.length === 0;

  const submit = () => {
    if (!title.trim() || !clientId) return;
    onCreate(clientId, projectId || null, title.trim(), due || null, priority, followUp || null, size);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-5 shadow-xl"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <h2 className="text-[16px] font-semibold">New task</h2>

        {/* Wraps rather than scrolling sideways, same as the inline row: a
            pasted paragraph is a normal way to start a task, and you should
            be able to read it while you type. Grows to about five lines,
            then scrolls. */}
        <textarea ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} rows={1}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && canCreate) { e.preventDefault(); submit(); } }}
          placeholder="What needs doing?"
          className="mt-3 max-h-[7.5rem] w-full resize-none overflow-y-auto rounded-md border bg-background px-3 py-2 text-[15px] leading-snug outline-none [field-sizing:content] focus:border-accent" />

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* A plain div, not a <label>: a <button> is labelable, so wrapping
              the searchable picker in one would re-fire its click. */}
          <div className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Client</span>
            <SearchableSelect value={clientId} onChange={(v) => { setClientId(v); setProjectId(""); }}
              options={clientOptions} placeholder="Select a client…" searchPlaceholder="Search clients…"
              className="w-full rounded-md border bg-background px-2 py-2 text-[15px] focus:border-accent" />
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">List</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}
              className="w-full rounded-md border bg-background px-2 py-2 text-[15px] outline-none focus:border-accent disabled:opacity-50">
              <option value="">Default (Tasks list)</option>
              {lists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Due date <b className="text-danger">*</b></span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-2 text-[15px] outline-none focus:border-accent" />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Follow up <b className="text-danger">*</b></span>
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)}
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

        {/* How long it takes, asked here because the plan has to place this
            task tomorrow and an unsized one is counted at a number the plan
            invents rather than one anyone stands behind. */}
        <div className="mt-3">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">How long will it take <b className="text-danger">*</b></span>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_ORDER.map((sz) => (
              <button key={sz} onClick={() => setSize(size === sz ? null : sz)} title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
                className={`rounded-md border px-2.5 py-1 text-[14px] ${size === sz ? "border-accent bg-accent text-white" : "bg-background hover:bg-surface"}`}>
                {SIZE_META[sz].label}
              </button>
            ))}
          </div>
        </div>

        {/* Says which answer is missing rather than just greying the button
            out. A disabled button with no reason is a dead end you have to
            hunt for. */}
        {missing.length > 0 && (
          <div className="mt-3 rounded-md border border-dashed px-2.5 py-1.5 text-[13px] text-muted">
            Still needs {missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0]}.
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
          <button onClick={submit} disabled={!canCreate}
            title={canCreate ? "" : `Still needs ${missing.join(", ")}`}
            className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Create task</button>
        </div>
      </div>
    </>
  );
}

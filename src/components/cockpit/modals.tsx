"use client";

// Styled in-app replacements for window.confirm()/prompt().
import { useEffect, useRef, useState } from "react";
import { LINK_COLORS, randomLinkColor, STATUS_META, type TaskStatus } from "@/lib/data";

export type ConfirmSpec = { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void };
export function ConfirmModal({ title, message, confirmLabel = "Confirm", danger = true, onConfirm, onCancel }: ConfirmSpec & { onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <p className="mt-1.5 text-[13px] text-muted">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
          <button onClick={onConfirm} autoFocus className={`rounded-md px-3 py-1.5 text-[15px] font-medium text-white ${danger ? "bg-red-500 hover:bg-red-600" : "bg-accent hover:opacity-90"}`}>{confirmLabel}</button>
        </div>
      </div>
    </>
  );
}

export type PromptSpec = { title: string; label?: string; initial?: string; placeholder?: string; confirmLabel?: string; onSubmit: (v: string) => void };
export function PromptModal({ title, label, initial = "", placeholder, confirmLabel = "Save", onSubmit, onCancel }: PromptSpec & { onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = () => { if (value.trim()) onSubmit(value.trim()); };
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {label && <label className="mt-1.5 block text-[13px] text-muted">{label}</label>}
        <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
          className="mt-2 w-full rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
          <button onClick={submit} disabled={!value.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{confirmLabel}</button>
        </div>
      </div>
    </>
  );
}

// Merges a Conversation-priority task into an existing, ongoing task —
// picked from other open tasks under the same client (conversation tasks
// themselves excluded, since merging one into another doesn't make sense).
export type MergeTaskSpec = { sourceTitle: string; candidates: { id: string; title: string; status: TaskStatus }[]; onSubmit: (targetTaskId: string) => void };
export function MergeTaskModal({ sourceTitle, candidates, onSubmit, onCancel }: MergeTaskSpec & { onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const q = query.trim().toLowerCase();
  const filtered = q ? candidates.filter((c) => c.title.toLowerCase().includes(q)) : candidates;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[70vh] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-surface p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold">Merge &ldquo;{sourceTitle}&rdquo; into…</h2>
        <p className="mt-1 text-[13px] text-muted">Its messages move onto the task you pick, then this conversation task is removed.</p>
        <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks…"
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
          className="mt-3 w-full shrink-0 rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 && <div className="py-6 text-center text-[13px] text-muted">No matching tasks.</div>}
          {filtered.map((t) => (
            <button key={t.id} onClick={() => onSubmit(t.id)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[14px] hover:bg-background">
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="shrink-0 text-[12px] text-muted">{STATUS_META[t.status].label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex shrink-0 justify-end">
          <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
        </div>
      </div>
    </>
  );
}

export type LinkFormSpec = { initial?: { label: string; url: string; groupLabel: string; color: string }; onSubmit: (v: { label: string; url: string; groupLabel: string; color: string }) => void };
export function LinkFormModal({ initial, onSubmit, onCancel }: LinkFormSpec & { onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [groupLabel, setGroupLabel] = useState(initial?.groupLabel ?? "");
  // New links get a random color so a link bar doesn't render as a wall of
  // identical chips; editing an existing link keeps its color unless changed.
  const [color, setColor] = useState(initial?.color ?? randomLinkColor());
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = () => { if (label.trim() && url.trim()) onSubmit({ label: label.trim(), url: url.trim(), groupLabel: groupLabel.trim(), color }); };
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold">{initial ? "Edit link" : "Add link"}</h2>
        <label className="mt-3 block text-[13px] font-medium text-muted">Label</label>
        <input ref={ref} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Live Site" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
          className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
        <label className="mt-3 block text-[13px] font-medium text-muted">URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
          className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
        <label className="mt-3 block text-[13px] font-medium text-muted">Group (optional)</label>
        <input value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} placeholder="Launch" onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
          className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
        <label className="mt-3 block text-[13px] font-medium text-muted">Color</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {LINK_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} title={c}
              className={`h-6 w-6 shrink-0 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-offset-surface" : "hover:scale-110"}`}
              style={{ background: c, ...(color === c ? { ["--tw-ring-color" as string]: c } : {}) }} />
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
          <button onClick={submit} disabled={!label.trim() || !url.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{initial ? "Save" : "Add link"}</button>
        </div>
      </div>
    </>
  );
}

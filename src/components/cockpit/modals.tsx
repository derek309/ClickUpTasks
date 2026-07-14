"use client";

// Styled in-app replacements for window.confirm()/prompt().
import { useEffect, useRef, useState } from "react";
import { LINK_COLORS, randomLinkColor } from "@/lib/data";

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

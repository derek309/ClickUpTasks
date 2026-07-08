"use client";

// Styled in-app replacements for window.confirm()/prompt().
import { useEffect, useRef, useState } from "react";

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
        <p className="mt-1.5 text-[15px] text-muted">{message}</p>
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
        {label && <label className="mt-1.5 block text-[15px] text-muted">{label}</label>}
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

"use client";

// Styled in-app replacements for window.confirm()/prompt().
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LINK_COLORS, randomLinkColor, STATUS_META, clientStatusMeta, formatDue, type TaskStatus, type Client, type Contact } from "@/lib/data";

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

// Merges two client records that represent the same real business (e.g. the
// same contact promoted from both the agency and directory GHL accounts).
// Phase 1: pick the other client. Phase 2: choose which record survives and,
// per field, which record's value wins. Everything from both ends up on the
// survivor; the other is removed. Irreversible.
type MergeField = "name" | "ghlLocationId" | "status" | "color" | "followUpAt";
export type MergeClientSpec = {
  a: Client;
  candidates: Client[];           // other clients that can be picked as the second side
  initialB?: Client;              // when launched from a "possible duplicate" hint, skip phase 1
  contactFor: (c: Client) => Contact | null;
  taskCount: (clientId: string) => number;
  onSubmit: (sourceId: string, targetId: string, patch: Partial<Client>) => void;
};
export function MergeClientModal({ a, candidates, initialB, contactFor, taskCount, onSubmit, onCancel }: MergeClientSpec & { onCancel: () => void }) {
  // Survivor defaults to whichever side has more tasks (least data to move);
  // per-field defaults follow the survivor. Seeded at init from initialB so
  // there's no set-state-in-effect when launched from a duplicate hint.
  const seedSurvivor = initialB && taskCount(initialB.id) > taskCount(a.id) ? initialB.id : a.id;
  const seedSide: "a" | "b" = seedSurvivor === a.id ? "a" : "b";
  const [b, setB] = useState<Client | null>(initialB ?? null);
  const [query, setQuery] = useState("");
  const [survivorId, setSurvivorId] = useState<string>(seedSurvivor);
  const [choice, setChoice] = useState<Record<MergeField, "a" | "b">>({ name: seedSide, ghlLocationId: seedSide, status: seedSide, color: seedSide, followUpAt: seedSide });
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!b) ref.current?.focus(); }, [b]);

  // Phase-1 selection: choosing the second side seeds survivor + field
  // defaults to whichever side has more tasks.
  const pickB = (other: Client) => {
    setB(other);
    const surv = taskCount(other.id) > taskCount(a.id) ? other : a;
    setSurvivorId(surv.id);
    const side: "a" | "b" = surv.id === a.id ? "a" : "b";
    setChoice({ name: side, ghlLocationId: side, status: side, color: side, followUpAt: side });
  };

  if (!b) {
    const q = query.trim().toLowerCase();
    const list = (q ? candidates.filter((c) => c.name.toLowerCase().includes(q) || (contactFor(c)?.email ?? "").toLowerCase().includes(q)) : candidates);
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
        <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[70vh] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-surface p-5 shadow-xl">
          <h2 className="text-[16px] font-semibold">Merge “{a.name}” with…</h2>
          <p className="mt-1 text-[13px] text-muted">Pick the other record for the same business.</p>
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients…" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
            className="mt-3 w-full shrink-0 rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 && <div className="py-6 text-center text-[13px] text-muted">No other clients.</div>}
            {list.map((c) => (
              <button key={c.id} onClick={() => pickB(c)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[14px] hover:bg-background">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: clientStatusMeta(c.status).dot }} />
                <span className="min-w-0 flex-1 truncate">{c.name}<span className="text-muted"> · {contactFor(c)?.email ?? clientStatusMeta(c.status).label}</span></span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex shrink-0 justify-end"><button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button></div>
        </div>
      </>
    );
  }

  const survivor = survivorId === a.id ? a : b;
  const source = survivorId === a.id ? b : a;
  const val = (c: Client, f: MergeField) => c[f];
  const rows: { f: MergeField; label: string; render: (c: Client) => ReactNode }[] = [
    { f: "name", label: "Name", render: (c) => c.name || "—" },
    { f: "ghlLocationId", label: "Business", render: (c) => c.ghlLocationId || "—" },
    { f: "status", label: "Status", render: (c) => clientStatusMeta(c.status).label },
    { f: "color", label: "Color", render: (c) => <span className="inline-block h-4 w-4 rounded-full align-middle" style={{ background: c.color }} /> },
    { f: "followUpAt", label: "Follow-up", render: (c) => (c.followUpAt ? formatDue(c.followUpAt) : "—") },
  ];
  const submit = () => {
    const patch: Partial<Client> = {};
    for (const { f } of rows) { const from = choice[f] === "a" ? a : b; (patch as Record<string, unknown>)[f] = val(from, f); }
    onSubmit(source.id, survivor.id, patch);
  };
  const sTasks = taskCount(source.id);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-surface p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold">Merge two clients into one</h2>
        <p className="mt-1 text-[13px] text-muted">All tasks, lists, messages, notes and files from both end up on the one you keep. {sTasks > 0 ? `${sTasks} task${sTasks === 1 ? "" : "s"} will move over. ` : ""}This can’t be undone.</p>

        <div className="mt-3 flex items-center gap-2 text-[13px]">
          <span className="text-muted">Keep as:</span>
          <div className="inline-flex overflow-hidden rounded-md border">
            {[a, b].map((c) => (
              <button key={c.id} onClick={() => { setSurvivorId(c.id); const side: "a" | "b" = c.id === a.id ? "a" : "b"; setChoice({ name: side, ghlLocationId: side, status: side, color: side, followUpAt: side }); }}
                className={`px-2.5 py-1 font-medium ${survivorId === c.id ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>{c.name}</button>
            ))}
          </div>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border">
          <div className="grid grid-cols-[80px_1fr_1fr] border-b bg-background/40 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span>Field</span><span className="truncate">{a.name}</span><span className="truncate">{b.name}</span>
          </div>
          {rows.map(({ f, label, render }) => (
            <div key={f} className="grid grid-cols-[80px_1fr_1fr] items-center border-b px-2 py-1.5 text-[13px] last:border-0">
              <span className="text-muted">{label}</span>
              {(["a", "b"] as const).map((side) => {
                const c = side === "a" ? a : b;
                const on = choice[f] === side;
                return (
                  <button key={side} onClick={() => setChoice((ch) => ({ ...ch, [f]: side }))}
                    className={`mx-1 flex items-center gap-1.5 truncate rounded-md border px-2 py-1 text-left ${on ? "border-accent bg-accent-soft text-accent" : "border-transparent hover:bg-background"}`}>
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${on ? "border-accent bg-accent" : "border-border"}`}>{on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}</span>
                    <span className="min-w-0 truncate">{render(c)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
          <button onClick={submit} className="rounded-md bg-red-500 px-3 py-1.5 text-[15px] font-medium text-white hover:bg-red-600">Merge</button>
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

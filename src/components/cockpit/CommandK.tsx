"use client";

// Cmd/Ctrl-K quick-jump palette over tasks and clients — plus, while actively
// searching, a "Not imported" section over the full synced GHL contact list
// (contacts with no `clients` row yet at all, any type) so finding someone
// and adding them as a client doesn't require the separate Settings dialog.
import { useState } from "react";
import { type Task, type Client, type Contact } from "@/lib/data";
import { I } from "./ui";

// --- ⌘K command palette -----------------------------------------------------

export function CommandK({ tasks, clients, contacts, addedContactIds, clientById, onOpenTask, onOpenClient, onAddContact, onClose }: {
  tasks: Task[]; clients: Client[]; contacts: Contact[]; addedContactIds: Set<string>; clientById: (id: string) => Client | null;
  onOpenTask: (id: string) => void; onOpenClient: (id: string) => void; onAddContact: (contact: Contact) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const ql = q.trim().toLowerCase();
  const taskItems = (ql ? tasks.filter((t) => t.title.toLowerCase().includes(ql)) : tasks).slice(0, 8);
  const clientItems = (ql ? clients.filter((c) => c.name.toLowerCase().includes(ql) || (c.ghlLocationId ?? "").toLowerCase().includes(ql)) : clients).slice(0, 6);
  // Only surfaced once you're actually typing — an unfiltered slice of
  // thousands of raw contacts isn't useful, and would just be noise on open.
  const notImportedItems = ql
    ? contacts.filter((c) => !addedContactIds.has(c.id) && (c.name.toLowerCase().includes(ql) || (c.email ?? "").toLowerCase().includes(ql))).slice(0, 6)
    : [];
  const total = taskItems.length + clientItems.length + notImportedItems.length;
  const activate = (i: number) => {
    if (i < taskItems.length) onOpenTask(taskItems[i].id);
    else if (i - taskItems.length < clientItems.length) onOpenClient(clientItems[i - taskItems.length].id);
    else onAddContact(notImportedItems[i - taskItems.length - clientItems.length]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, total - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); activate(idx); }
    else if (e.key === "Escape") onClose();
  };
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-24 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <I.search className="text-muted" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} placeholder="Search tasks, clients, and contacts…" className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          <span className="rounded border px-1.5 py-0.5 text-[13px] text-muted">Esc</span>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {total === 0 && <div className="px-3 py-6 text-center text-[15px] text-muted">No matches</div>}
          {taskItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">Tasks</div>}
          {taskItems.map((t, i) => { const client = clientById(t.clientId); return (
            <button key={t.id} onMouseEnter={() => setIdx(i)} onClick={() => activate(i)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === i ? "bg-background" : ""}`}>
              <span className="min-w-0 flex-1 truncate text-[15px]">{t.title}</span>
              <span className="shrink-0 text-[13px] text-muted">{client?.name}</span>
            </button>
          ); })}
          {clientItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">Clients</div>}
          {clientItems.map((c, i) => { const gi = taskItems.length + i; return (
            <button key={c.id} onMouseEnter={() => setIdx(gi)} onClick={() => activate(gi)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === gi ? "bg-background" : ""}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="truncate text-[15px]">{c.name}</span>
            </button>
          ); })}
          {notImportedItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">Not imported</div>}
          {notImportedItems.map((c, i) => { const gi = taskItems.length + clientItems.length + i; return (
            <button key={c.id} onMouseEnter={() => setIdx(gi)} onClick={() => activate(gi)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === gi ? "bg-background" : ""}`}>
              <I.plus className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-muted">{c.name}{c.company && <span className="text-muted/70"> · {c.company}</span>}</span>
              <span className="shrink-0 text-[13px] text-accent">Add as client</span>
            </button>
          ); })}
        </div>
      </div>
    </>
  );
}

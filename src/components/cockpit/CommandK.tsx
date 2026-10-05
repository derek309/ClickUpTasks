"use client";

// Cmd/Ctrl-K quick-jump palette over clients, projects, and tasks — plus, while
// actively searching, a "Not imported" section over the full synced GHL contact
// list (contacts with no `clients` row yet at all, any type) so finding someone
// and adding them as a client doesn't require the separate Settings dialog.
import { useState } from "react";
import { type Task, type Client, type Project, type Contact } from "@/lib/data";
import { I } from "./ui";

// --- ⌘K command palette -----------------------------------------------------

// Go to: the sidebar's places, 1 to 5 on an empty search (Derek, 2026-10-05:
// "command K then 1 and it does the inbox"), so they are a keystroke away with
// the sidebar hidden.
export type GoView = "inbox" | "dashboard" | "alltasks" | "projects" | "personal";
const GO: { view: GoView; label: string; icon: string }[] = [
  { view: "inbox", label: "Inbox", icon: "📥" },
  { view: "dashboard", label: "Clients", icon: "👤" },
  { view: "alltasks", label: "Tasks", icon: "☰" },
  { view: "projects", label: "Projects", icon: "🗂" },
  { view: "personal", label: "Personal", icon: "✓" },
];

export function CommandK({ tasks, clients, projects, contacts, addedContactIds, clientById, pinnedClients = [], pinnedLists = [], onGo, onOpenTask, onOpenClient, onOpenProject, onAddContact, onClose }: {
  tasks: Task[]; clients: Client[]; projects: Project[]; contacts: Contact[]; addedContactIds: Set<string>; clientById: (id: string) => Client | null;
  /** The sidebar's Pinned people and lists, shown under Go to before you type. */
  pinnedClients?: Client[]; pinnedLists?: Project[];
  onGo?: (view: GoView) => void;
  onOpenTask: (id: string) => void; onOpenClient: (id: string) => void; onOpenProject: (id: string) => void; onAddContact: (contact: Contact) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const ql = q.trim().toLowerCase();
  // The client's linked GHL contact — for showing business + email inline so
  // two same-named clients (e.g. "Derek Fox") are tell-apart-able at a glance.
  const contactOf = (c: Client): Contact | undefined =>
    (c.linkedContactId ? contacts.find((ct) => ct.id === c.linkedContactId) : undefined)
    ?? contacts.find((ct) => ct.clientId === c.id)
    ?? (c.id.startsWith("cl_") ? contacts.find((ct) => ct.id === c.id.slice(3)) : undefined);
  const goItems = onGo ? GO.filter((g) => !ql || g.label.toLowerCase().includes(ql)) : [];
  // Before you type: the places, then what is pinned, then tasks.
  // Order matches how people think about the hierarchy: Clients → Projects → Tasks.
  const clientItems = (ql ? clients.filter((c) => { const ct = contactOf(c); return c.name.toLowerCase().includes(ql) || (c.ghlLocationId ?? "").toLowerCase().includes(ql) || (ct?.company ?? "").toLowerCase().includes(ql) || (ct?.email ?? "").toLowerCase().includes(ql); }).slice(0, 6) : pinnedClients);
  const projectItems = (ql ? projects.filter((p) => p.name.toLowerCase().includes(ql)).slice(0, 6) : pinnedLists);
  const taskItems = (ql ? tasks.filter((t) => t.title.toLowerCase().includes(ql)) : tasks).slice(0, 8);
  // Only surfaced once you're actually typing — an unfiltered slice of
  // thousands of raw contacts isn't useful, and would just be noise on open.
  const notImportedItems = ql
    ? contacts.filter((c) => !addedContactIds.has(c.id) && (c.name.toLowerCase().includes(ql) || (c.email ?? "").toLowerCase().includes(ql))).slice(0, 6)
    : [];
  const total = goItems.length + clientItems.length + projectItems.length + taskItems.length + notImportedItems.length;
  const G = goItems.length;
  const activate = (gi: number) => {
    if (gi < G) return onGo?.(goItems[gi].view);
    const i = gi - G;
    if (i < clientItems.length) return onOpenClient(clientItems[i].id);
    let j = i - clientItems.length;
    if (j < projectItems.length) return onOpenProject(projectItems[j].id);
    j -= projectItems.length;
    if (j < taskItems.length) return onOpenTask(taskItems[j].id);
    j -= taskItems.length;
    onAddContact(notImportedItems[j]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!q && onGo && /^[1-5]$/.test(e.key)) { e.preventDefault(); onGo(GO[Number(e.key) - 1].view); return; }
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
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} placeholder={onGo ? "Search, or press 1 to 5 to go to a place" : "Search clients, projects, and tasks…"} className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          <span className="rounded border px-1.5 py-0.5 text-[13px] text-muted">Esc</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {total === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">No matches</div>}
          {goItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Go to</div>}
          {goItems.map((g, i) => (
            <button key={g.view} onMouseEnter={() => setIdx(i)} onClick={() => activate(i)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${idx === i ? "bg-background" : ""}`}>
              <span className="w-5 shrink-0 text-center">{g.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[15px]">{g.label}</span>
              {!q && <kbd className="shrink-0 rounded border border-b-2 px-1.5 text-[13px] text-muted">{GO.indexOf(g) + 1}</kbd>}
            </button>
          ))}
          {clientItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{q ? "Clients" : "Pinned"}</div>}
          {clientItems.map((c, ci) => { const i = G + ci; const ct = contactOf(c); const sub = [ct?.company, ct?.email].filter(Boolean).join(" · "); return (
            <button key={c.id} onMouseEnter={() => setIdx(i)} onClick={() => activate(i)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === i ? "bg-background" : ""}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px]">{c.name}</span>
                {sub && <span className="truncate text-[12px] text-muted">{sub}</span>}
              </span>
            </button>
          ); })}
          {projectItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{q ? "Projects" : clientItems.length ? "Pinned lists" : "Pinned"}</div>}
          {projectItems.map((p, i) => { const gi = G + clientItems.length + i; const client = clientById(p.clientId); return (
            <button key={p.id} onMouseEnter={() => setIdx(gi)} onClick={() => activate(gi)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === gi ? "bg-background" : ""}`}>
              <I.folder className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[15px]">{p.name}</span>
              <span className="shrink-0 text-[13px] text-muted">{client?.name}</span>
            </button>
          ); })}
          {taskItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Tasks</div>}
          {taskItems.map((t, i) => { const gi = G + clientItems.length + projectItems.length + i; const client = clientById(t.clientId); return (
            <button key={t.id} onMouseEnter={() => setIdx(gi)} onClick={() => activate(gi)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === gi ? "bg-background" : ""}`}>
              <span className="min-w-0 flex-1 truncate text-[15px]">{t.title}</span>
              <span className="shrink-0 text-[13px] text-muted">{client?.name}</span>
            </button>
          ); })}
          {notImportedItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Not imported</div>}
          {notImportedItems.map((c, i) => { const gi = G + clientItems.length + projectItems.length + taskItems.length + i; return (
            <button key={c.id} onMouseEnter={() => setIdx(gi)} onClick={() => activate(gi)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === gi ? "bg-background" : ""}`}>
              <I.plus className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{c.name}{c.company && <span className="text-muted/70"> · {c.company}</span>}</span>
              <span className="shrink-0 text-[13px] text-accent">Add as client</span>
            </button>
          ); })}
        </div>
      </div>
    </>
  );
}

"use client";

// Trash for clients/projects/tasks (see supabase/soft-delete.sql) — added
// after an accidental project delete turned out to be permanent and
// unrecoverable, cascading away every task under it with no way back.
// Deleting any of the three now just sets deleted_at; this panel is where
// that becomes visible and reversible, for 30 days, before the daily
// /api/cron/purge-trash sweep really deletes it.
import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/data";
import { I } from "./cockpit/ui";
import { type TrashEntry, fetchTrash } from "@/lib/db";

const RETENTION_DAYS = 30;
const daysLeft = (deletedAt: string) => Math.max(0, RETENTION_DAYS - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000));

export default function TrashPanel({ onRestoreClient, onRestoreProject, onRestoreTask, onPurgeClient, onPurgeProject, onPurgeTask }: {
  onRestoreClient: (id: string) => Promise<void> | void;
  onRestoreProject: (id: string) => Promise<void> | void;
  onRestoreTask: (id: string) => Promise<void> | void;
  onPurgeClient: (id: string) => Promise<void> | void;
  onPurgeProject: (id: string) => Promise<void> | void;
  onPurgeTask: (id: string) => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(true);
  const [trash, setTrash] = useState<{ clients: TrashEntry[]; projects: TrashEntry[]; tasks: TrashEntry[] }>({ clients: [], projects: [], tasks: [] });
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => { setLoading(true); try { setTrash(await fetchTrash()); } finally { setLoading(false); } };
  // Deferred a frame: load() sets state, and writing state synchronously from
  // an effect body is what makes the compiler stop optimising a component.
  useEffect(() => { const r = requestAnimationFrame(() => { void load(); }); return () => cancelAnimationFrame(r); }, []);

  const remove = (kind: "clients" | "projects" | "tasks", id: string) =>
    setTrash((t) => ({ ...t, [kind]: t[kind].filter((e) => e.id !== id) }));

  const act = async (kind: "clients" | "projects" | "tasks", id: string, fn: (id: string) => Promise<void> | void) => {
    setBusyId(id);
    try { await fn(id); remove(kind, id); } finally { setBusyId(null); }
  };

  const groups: { key: "clients" | "projects" | "tasks"; label: string; entries: TrashEntry[]; onRestore: (id: string) => Promise<void> | void; onPurge: (id: string) => Promise<void> | void }[] = [
    { key: "clients", label: "Clients", entries: trash.clients, onRestore: onRestoreClient, onPurge: onPurgeClient },
    { key: "projects", label: "Projects", entries: trash.projects, onRestore: onRestoreProject, onPurge: onPurgeProject },
    { key: "tasks", label: "Tasks", entries: trash.tasks, onRestore: onRestoreTask, onPurge: onPurgeTask },
  ];
  const isEmpty = groups.every((g) => g.entries.length === 0);

  return (
    <div className="p-5">
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold">Trash</h2>
        <p className="text-[13px] text-muted">Deleted clients, projects, and tasks stay here for {RETENTION_DAYS} days before they&apos;re gone for good.</p>
      </div>
      {loading ? (
        <div className="text-[13px] text-muted">Loading…</div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-10 text-center text-muted">
          <I.trash />
          <span className="text-[14px]">Nothing in Trash</span>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.filter((g) => g.entries.length > 0).map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label} · {g.entries.length}</div>
              <div className="overflow-hidden rounded-lg border">
                {g.entries.map((e, i) => (
                  <div key={e.id} className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? "border-t" : ""}`}>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{e.name}</span>
                    <span className="shrink-0 text-[12px] text-muted">Deleted {timeAgo(e.deletedAt)} · {daysLeft(e.deletedAt)}d left</span>
                    <button onClick={() => act(g.key, e.id, g.onRestore)} disabled={busyId === e.id}
                      className="shrink-0 rounded-md border border-accent/40 px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50">
                      Restore
                    </button>
                    <button
                      onClick={() => { if (window.confirm(`Permanently delete "${e.name}"? This can't be undone.`)) act(g.key, e.id, g.onPurge); }}
                      disabled={busyId === e.id}
                      className="shrink-0 rounded-md border px-2.5 py-1 text-[13px] font-medium text-muted hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                      Delete forever
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

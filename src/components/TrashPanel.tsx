"use client";

// Trash for clients/projects/tasks (see supabase/soft-delete.sql) — added
// after an accidental project delete turned out to be permanent and
// unrecoverable, cascading away every task under it with no way back.
// Deleting any of the three now just sets deleted_at; this panel is where
// that becomes visible and reversible, for 30 days, before the daily
// /api/cron/purge-trash sweep really deletes it.
import { useEffect, useState } from "react";
import { timeAgo, userById } from "@/lib/data";
import { I } from "./cockpit/ui";
import { type TrashEntry, fetchTrash } from "@/lib/db";
import { SettingsCard } from "./settings/ui";

const RETENTION_DAYS = 30;
/** The teammate's name, or null when nobody was recorded or they left the team. */
const deleterName = (id: string | null) => (id ? userById(id)?.name ?? null : null);
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
    <div className="space-y-4">
      <p className="text-[16px] text-muted">Everything here is kept for {RETENTION_DAYS} days, then it is gone for good.</p>
      {loading ? (
        <div className="text-[16px] text-muted">Loading…</div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[5px] border border-dashed bg-surface py-10 text-center text-muted">
          <I.trash />
          <span className="text-[16px]">Nothing in Trash</span>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.filter((g) => g.entries.length > 0).map((g) => (
            <SettingsCard key={g.key} title={`${g.label} · ${g.entries.length}`} icon={<I.trash className="h-4 w-4" />} tone="slate">
              <div className="overflow-hidden rounded-[5px] border bg-background">
                {g.entries.map((e, i) => (
                  <div key={e.id} className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? "border-t" : ""}`}>
                    {/* Whose it was and who binned it (Derek, 2026-09-29: "can we say who
                        deleted and what client it went with"). Anything trashed before
                        deleted_by existed just leaves the name off. */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-medium">{e.name}</div>
                      <div className="truncate text-[16px] text-muted">
                        {[e.clientName, `Deleted ${timeAgo(e.deletedAt)}${deleterName(e.deletedBy) ? ` by ${deleterName(e.deletedBy)}` : ""}`, `${daysLeft(e.deletedAt)} days left`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button onClick={() => act(g.key, e.id, g.onRestore)} disabled={busyId === e.id}
                      className="shrink-0 rounded-[5px] border border-accent/40 px-2.5 py-1 text-[16px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50">
                      Restore
                    </button>
                    <button
                      onClick={() => { if (window.confirm(`Permanently delete "${e.name}"? This can't be undone.`)) act(g.key, e.id, g.onPurge); }}
                      disabled={busyId === e.id}
                      className="shrink-0 rounded-[5px] border px-2.5 py-1 text-[16px] font-medium text-muted hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                      Delete forever
                    </button>
                  </div>
                ))}
              </div>
            </SettingsCard>
          ))}
        </div>
      )}
    </div>
  );
}

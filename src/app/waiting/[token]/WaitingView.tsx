"use client";

// Public, no login — see supabase/client-share-token.sql,
// src/app/api/waiting/[token]/route.ts (list), .../respond/route.ts
// (submit/edit a reply), .../upload/route.ts (attach files). Styled like
// App.tsx's Login/SetNewPassword screens (the only other "outside the main
// Cockpit shell" surfaces in this app) rather than through Cockpit.tsx —
// deliberately self-contained (its own tiny formatBytes/kindFromName)
// rather than importing from src/components/cockpit/ui.tsx, so this public
// page doesn't pull in the internal component tree.
import { useEffect, useMemo, useState } from "react";
import { formatDue, isOverdue, type Attachment } from "@/lib/data";

type WaitingAttachment = { id: string; name: string; kind: Attachment["kind"]; size: string; path: string | null; url: string | null };
type WaitingTask = {
  id: string; title: string; due: string | null; description: string; status: string; needsResponse: boolean;
  response: { body: string; submittedAt: string; attachments: WaitingAttachment[] } | null;
};
type DraftAttachment = { id: string; name: string; kind: Attachment["kind"]; size: string; path: string };
type Draft = { body: string; attachments: DraftAttachment[] };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function formatBytes(n: number) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function kindFromName(name: string): Attachment["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  return "doc";
}
const localId = () => `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export default function WaitingView({ token }: { token: string }) {
  const [clientName, setClientName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WaitingTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  // A separate "need something else?" composer — raises a brand-new task
  // rather than replying to one already waiting on the client.
  const [newBody, setNewBody] = useState("");
  const [newAttachments, setNewAttachments] = useState<DraftAttachment[]>([]);
  const [newUploading, setNewUploading] = useState(false);
  const [newSaving, setNewSaving] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [newSent, setNewSent] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/waiting/${token}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || "This link isn't valid."); return; }
      setClientName(j.clientName ?? null);
      const list: WaitingTask[] = Array.isArray(j.tasks) ? j.tasks : [];
      setTasks(list);
      // Seed a draft per task from its existing response (so "Edit" opens
      // pre-filled) — only for tasks with no draft yet, so a later refetch
      // (after Save) doesn't clobber a draft someone's mid-typing elsewhere.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const t of list) {
          if (next[t.id]) continue;
          next[t.id] = t.response
            ? { body: t.response.body, attachments: t.response.attachments.filter((a) => a.path).map((a) => ({ id: a.id, name: a.name, kind: a.kind, size: a.size, path: a.path as string })) }
            : { body: "", attachments: [] };
        }
        return next;
      });
    } catch {
      setError("Couldn't load this page — check your connection and try again.");
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const sorted = useMemo(() => {
    if (!tasks) return [];
    const rank = (t: WaitingTask) => (t.status === "done" ? 2 : t.needsResponse ? 0 : 1);
    return [...tasks].sort((a, b) => rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }, [tasks]);

  const updateBody = (taskId: string, body: string) =>
    setDrafts((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] ?? { attachments: [] }), body } }));

  const handleFiles = async (taskId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingIds((s) => new Set(s).add(taskId));
    for (const f of Array.from(files)) {
      if (f.size > MAX_UPLOAD_BYTES) continue;
      const form = new FormData();
      form.append("task_id", taskId);
      form.append("file", f);
      try {
        const res = await fetch(`/api/waiting/${token}/upload`, { method: "POST", body: form });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.path) {
          setDrafts((prev) => {
            const d = prev[taskId] ?? { body: "", attachments: [] };
            return { ...prev, [taskId]: { ...d, attachments: [...d.attachments, { id: localId(), name: f.name, kind: kindFromName(f.name), size: formatBytes(f.size), path: j.path }] } };
          });
        }
      } catch { /* one file failing shouldn't block the rest */ }
    }
    setUploadingIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
  };

  const removeAttachment = (taskId: string, attId: string) =>
    setDrafts((prev) => { const d = prev[taskId]; if (!d) return prev; return { ...prev, [taskId]: { ...d, attachments: d.attachments.filter((a) => a.id !== attId) } }; });

  const save = async (taskId: string) => {
    const draft = drafts[taskId] ?? { body: "", attachments: [] };
    setSavingIds((s) => new Set(s).add(taskId));
    try {
      const res = await fetch(`/api/waiting/${token}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, body: draft.body, attachments: draft.attachments }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setSaveErrors((e) => ({ ...e, [taskId]: j.error || "Couldn't save — try again." })); return; }
      setSaveErrors((e) => { const n = { ...e }; delete n[taskId]; return n; });
      setEditingIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
      setSavedIds((s) => new Set(s).add(taskId));
      setTimeout(() => setSavedIds((s) => { const n = new Set(s); n.delete(taskId); return n; }), 3000);
      await load();
    } finally {
      setSavingIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
    }
  };

  const handleNewFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setNewUploading(true);
    for (const f of Array.from(files)) {
      if (f.size > MAX_UPLOAD_BYTES) continue;
      const form = new FormData();
      form.append("file", f);
      try {
        const res = await fetch(`/api/waiting/${token}/upload`, { method: "POST", body: form });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.path) setNewAttachments((prev) => [...prev, { id: localId(), name: f.name, kind: kindFromName(f.name), size: formatBytes(f.size), path: j.path }]);
      } catch { /* one file failing shouldn't block the rest */ }
    }
    setNewUploading(false);
  };

  const submitNewRequest = async () => {
    setNewSaving(true);
    try {
      const res = await fetch(`/api/waiting/${token}/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newBody, attachments: newAttachments }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setNewError(j.error || "Couldn't send — try again."); return; }
      setNewError(null);
      setNewBody("");
      setNewAttachments([]);
      setNewSent(true);
      setTimeout(() => setNewSent(false), 3000);
      await load();
    } finally {
      setNewSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 py-10">
      <div className="w-full max-w-7xl">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">CT</span>
          <div className="leading-tight">
            <div className="font-semibold">ClickUpLocal</div>
            <div className="text-[13px] text-muted">What we&apos;re waiting on you for</div>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-600">{error}</div>
        ) : !tasks ? (
          <div className="py-8 text-center text-[13px] text-muted">Loading…</div>
        ) : (
          <>
            {clientName && <h1 className="mb-4 text-[20px] font-semibold">{clientName}</h1>}
            {tasks.length === 0 ? (
              <div className="py-8 text-center text-[15px] text-muted">Nothing needed from you right now — you&apos;re all caught up. 🎉</div>
            ) : (
              <div className="space-y-4">
                {sorted.map((t) => {
                  const isDone = t.status === "done";
                  const isEditing = !isDone && (t.needsResponse || editingIds.has(t.id));
                  const draft = drafts[t.id] ?? { body: "", attachments: [] };
                  const saving = savingIds.has(t.id);
                  const uploading = uploadingIds.has(t.id);
                  const justSaved = savedIds.has(t.id);
                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border border-l-4 p-3.5 shadow-sm ${isDone ? "bg-green-50" : ""}`}
                      // A global `* { border-color: var(--border) }` rule in globals.css is
                      // unlayered, so per CSS cascade-layer rules it beats ANY Tailwind
                      // border-color utility (including border-l-accent, border-green-200,
                      // etc.) regardless of specificity — inline style is the reliable way
                      // to override it.
                      style={{ borderColor: isDone ? "#bbf7d0" : undefined, borderLeftColor: isDone ? "#22c55e" : "var(--accent)" }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-[17px] font-medium">
                          {isDone && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 text-[11px] text-white">✓</span>}
                          <span className={isDone ? "text-green-800" : ""}>{t.title}</span>
                        </div>
                        {t.due && !isDone && (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${isOverdue(t.due) ? "bg-red-50 text-red-600" : "bg-accent-soft text-accent"}`}>
                            {formatDue(t.due)}
                          </span>
                        )}
                      </div>
                      {t.description && <p className="mt-1.5 whitespace-pre-wrap text-[14px] text-muted">{t.description}</p>}

                      {isDone ? (
                        t.response && (t.response.body || t.response.attachments.length > 0) && (
                          <div className="mt-2 rounded-lg bg-white/70 p-2.5 text-[13px] text-green-900">
                            <div className="mb-1 font-medium">Completed</div>
                            {t.response.body && <p className="whitespace-pre-wrap">{t.response.body}</p>}
                            {t.response.attachments.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {t.response.attachments.map((a) => a.url && (
                                  <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-green-200 bg-white px-2 py-1 text-[12px] text-green-800 hover:underline">{a.name}</a>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      ) : isEditing ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={draft.body}
                            onChange={(e) => updateBody(t.id, e.target.value)}
                            placeholder="Type your answer or notes here…"
                            rows={3}
                            className="w-full rounded-lg border bg-background px-2.5 py-2 text-[14px] outline-none focus:border-accent"
                          />
                          {draft.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {draft.attachments.map((a) => (
                                <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px]">
                                  {a.name} <span className="text-muted">{a.size}</span>
                                  <button onClick={() => removeAttachment(t.id, a.id)} title="Remove" className="text-muted hover:text-red-500">✕</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-accent">
                              + Attach files
                              <input type="file" multiple className="hidden" onChange={(e) => { handleFiles(t.id, e.target.files); e.target.value = ""; }} />
                            </label>
                            <div className="flex items-center gap-2">
                              {editingIds.has(t.id) && !t.needsResponse && (
                                <button onClick={() => setEditingIds((s) => { const n = new Set(s); n.delete(t.id); return n; })} className="text-[13px] text-muted hover:text-foreground">Cancel</button>
                              )}
                              <button
                                onClick={() => save(t.id)}
                                disabled={saving || uploading || (!draft.body.trim() && draft.attachments.length === 0)}
                                className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
                              >
                                {saving ? "Saving…" : uploading ? "Uploading…" : "Save"}
                              </button>
                            </div>
                          </div>
                          {saveErrors[t.id] && <div className="text-[13px] text-red-600">{saveErrors[t.id]}</div>}
                        </div>
                      ) : (
                        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-accent-soft/40 px-2.5 py-2">
                          <div className="min-w-0 text-[13px] text-muted">{justSaved ? "Saved — the team's on it." : "Submitted — the team's working on it."}</div>
                          <button onClick={() => setEditingIds((s) => new Set(s).add(t.id))} className="shrink-0 text-[13px] font-medium text-accent hover:underline">Edit</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 rounded-xl border border-dashed p-3.5">
              <div className="text-[15px] font-medium">Need something else?</div>
              <div className="mt-0.5 text-[13px] text-muted">Tell us what you need and we&apos;ll take a look.</div>
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="What do you need?"
                rows={3}
                className="mt-2 w-full rounded-lg border bg-background px-2.5 py-2 text-[14px] outline-none focus:border-accent"
              />
              {newAttachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {newAttachments.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px]">
                      {a.name} <span className="text-muted">{a.size}</span>
                      <button onClick={() => setNewAttachments((prev) => prev.filter((x) => x.id !== a.id))} title="Remove" className="text-muted hover:text-red-500">✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-accent">
                  + Attach files
                  <input type="file" multiple className="hidden" onChange={(e) => { handleNewFiles(e.target.files); e.target.value = ""; }} />
                </label>
                <button
                  onClick={submitNewRequest}
                  disabled={newSaving || newUploading || (!newBody.trim() && newAttachments.length === 0)}
                  className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
                >
                  {newSaving ? "Sending…" : newUploading ? "Uploading…" : "Send"}
                </button>
              </div>
              {newError && <div className="mt-1.5 text-[13px] text-red-600">{newError}</div>}
              {newSent && <div className="mt-1.5 text-[13px] text-green-700">Sent — we&apos;ll take a look!</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

// Public, no login — see supabase/client-share-token.sql,
// src/app/api/waiting/[token]/route.ts (list), .../respond/route.ts
// (submit/edit a reply), .../upload/route.ts (attach files). Styled like
// App.tsx's Login/SetNewPassword screens (the only other "outside the main
// Cockpit shell" surfaces in this app) rather than through Cockpit.tsx —
// deliberately self-contained (its own tiny formatBytes/kindFromName)
// rather than importing from src/components/cockpit/ui.tsx, so this public
// page doesn't pull in the internal component tree.
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDue, isOverdue, timeAgo, type Attachment } from "@/lib/data";

type WaitingAttachment = { id: string; name: string; kind: Attachment["kind"]; size: string; path: string | null; url: string | null };
type WaitingProject = { id: string; name: string };
// One message in a task's running chat — see ./messages/route.ts (client
// sends) and the team's existing task drawer (reads/sends the same
// underlying `messages` row, just via the internal app instead of here).
type WaitingSender = { name: string; avatarUrl: string | null; color: string; initials: string };
type WaitingMessage = { id: string; from: "team" | "client"; body: string; at: string; attachments: WaitingAttachment[]; sender?: WaitingSender | null };
type WaitingTask = {
  id: string; projectId: string | null; title: string; due: string | null; description: string; status: string; needsResponse: boolean;
  attachments: WaitingAttachment[];
  response: { body: string; submittedAt: string; attachments: WaitingAttachment[] } | null;
  thread: WaitingMessage[];
};
// A draft attachment is either a stored file (has `path`, uploaded via
// upload/route.ts) or a plain link (kind "link", has `url` instead) — mirrors
// the real Attachment shape closely enough for sanitizeWaitingAttachments to
// accept either on submit.
type DraftAttachment = { id: string; name: string; kind: Attachment["kind"]; size: string; path?: string; url?: string };
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

// Who's on the other end of a team message — a real photo if they've set
// one, else a colored initials circle, same fallback the internal app's own
// Avatar component uses (mirrored here rather than imported, since this
// page deliberately doesn't pull in the cockpit component tree).
function SenderAvatar({ sender }: { sender?: WaitingSender | null }) {
  const size = 22;
  if (!sender) return <span className="flex shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white" style={{ width: size, height: size }}>CT</span>;
  if (sender.avatarUrl) return (
    // eslint-disable-next-line @next/next/no-img-element -- small inline avatar, not a next/image-friendly static asset.
    <img src={sender.avatarUrl} alt={sender.name} title={sender.name} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  );
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" title={sender.name} style={{ width: size, height: size, background: sender.color }}>
      {sender.initials}
    </span>
  );
}

// Mockups/screenshots/staging links the team attached to a task, or the
// client's own reply attachments — same tile treatment either way, so the
// client can actually review the page/media in question, not just read a
// text description. Images get a real thumbnail; everything else (a
// staging-page link, a PDF, a doc) is a small labeled chip.
function AttachmentGallery({ items }: { items: WaitingAttachment[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) => {
        if (!a.url) return <span key={a.id} className="rounded-md border bg-background px-2 py-1 text-[12px] text-muted">{a.name}</span>;
        if (a.kind === "image") {
          return (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name} className="block h-20 w-20 overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed-URL thumbnail, not a next/image-friendly static asset. */}
              <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
            </a>
          );
        }
        return (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px] text-accent hover:underline">
            {a.kind === "link" ? "🔗" : "📄"} {a.name}
          </a>
        );
      })}
    </div>
  );
}

// Full task detail — title, due date, description, attachments, the
// complete running chat, and a composer. Used only for whichever one task
// is currently selected (see selectedTaskId in WaitingView) — pulled out of
// the list rows entirely so the landing page can stay a lean list instead
// of every row carrying its own thread+composer inline (that's what made
// the old combined view unreadable on mobile with more than a task or two).
function TaskDetailCard({
  task: t, showProjectName, projectName, draft, sending, uploading, sendError, linkOpen, linkUrl, linkLabel, threadRef,
  onBody, onFiles, onRemoveAttachment, onToggleLink, onLinkUrl, onLinkLabel, onAddLink, onSend,
}: {
  task: WaitingTask;
  showProjectName: boolean;
  projectName: string | null;
  draft: Draft;
  sending: boolean;
  uploading: boolean;
  sendError?: string;
  linkOpen: boolean;
  linkUrl: string;
  linkLabel: string;
  threadRef: (el: HTMLDivElement | null) => void;
  onBody: (body: string) => void;
  onFiles: (files: FileList | null) => void;
  onRemoveAttachment: (attId: string) => void;
  onToggleLink: () => void;
  onLinkUrl: (v: string) => void;
  onLinkLabel: (v: string) => void;
  onAddLink: () => void;
  onSend: () => void;
}) {
  const isDone = t.status === "done";
  // Backward compat: a response submitted before per-task chat existed
  // lives on the task itself, not in the messages table — shown as the
  // thread's opening message only when there's no real thread yet, so
  // history isn't lost but a task that's since moved to real chat doesn't
  // show it twice.
  const displayThread: WaitingMessage[] = t.thread.length > 0 || !t.response
    ? t.thread
    : [{ id: "legacy_response", from: "client", body: t.response.body, at: t.response.submittedAt, attachments: t.response.attachments }];
  return (
    // Full-bleed below md — the page's own -mx-6 side padding otherwise
    // stacks with this card's border+rounded corners+shadow to read like a
    // boxed iframe on a phone, when the whole point of the detail view is
    // to actually use the screen. Reintroduced at md, where there's a
    // sidebar next to it and the boxed look reads as a real card again.
    <div className="-mx-6 overflow-hidden border-y bg-surface md:mx-0 md:rounded-2xl md:border md:shadow-[var(--shadow-md)]">
      <div className="border-l-4 p-4" style={{ borderLeftColor: isDone ? "var(--success)" : "var(--highlight)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={`text-[17px] font-bold ${isDone ? "text-muted line-through decoration-muted/40" : ""}`}>{t.title}</div>
            {showProjectName && projectName && <div className="text-[12px] text-muted">{projectName}</div>}
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {isDone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[12px] font-medium text-success">✓ Completed</span>
            )}
            {t.due && (
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[12px] font-medium ${isOverdue(t.due) && !isDone ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}
                style={{ borderColor: isOverdue(t.due) && !isDone ? "color-mix(in srgb, var(--danger) 30%, var(--border))" : "transparent" }}
              >
                {formatDue(t.due)}
              </span>
            )}
          </span>
        </div>
        {t.description && <p className="mt-1.5 max-w-[62ch] whitespace-pre-wrap break-words text-[14px] text-muted">{t.description}</p>}
        <AttachmentGallery items={t.attachments} />

        {displayThread.length > 0 && (
          // Fixed-height scroll pane, not an ever-growing card — a chatty
          // thread otherwise makes the whole page longer every time someone
          // replies. Auto-scrolled to the newest message (see the effect in
          // WaitingView) so it opens already showing what's current.
          <div ref={threadRef} className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {displayThread.map((m) => (
              <div key={m.id} className={`flex items-end gap-1.5 ${m.from === "client" ? "justify-end" : "justify-start"}`}>
                {m.from === "team" && <SenderAvatar sender={m.sender} />}
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[14px] ${m.from === "client" ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm border bg-surface-2"}`}>
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <AttachmentGallery items={m.attachments} />
                  <div className={`mt-1 text-[11px] ${m.from === "client" ? "text-white/70" : "text-muted"}`}>
                    {m.from === "client" ? "You" : m.sender?.name ?? "Team"} · {timeAgo(m.at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 space-y-2 border-t pt-3">
          <textarea
            value={draft.body}
            onChange={(e) => onBody(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSend(); }}
            placeholder="Type a message…"
            rows={2}
            className="w-full rounded-lg border bg-background px-2.5 py-2 text-[14px] outline-none focus:border-accent"
          />
          {draft.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {draft.attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px]">
                  {a.name} <span className="text-muted">{a.size}</span>
                  <button onClick={() => onRemoveAttachment(a.id)} title="Remove" className="text-muted hover:text-danger">✕</button>
                </span>
              ))}
            </div>
          )}
          {linkOpen && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
              <input autoFocus value={linkUrl} onChange={(e) => onLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddLink(); }} placeholder="Paste a link (Drive, website, doc…)" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
              <input value={linkLabel} onChange={(e) => onLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddLink(); }} placeholder="Label (optional)" className="w-32 rounded-md border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
              <button onClick={onAddLink} disabled={!linkUrl.trim()} className="rounded-md bg-accent px-2.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">Add</button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-accent">
                + Attach files
                <input type="file" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <button onClick={onToggleLink} className="text-[13px] font-medium text-accent">+ Add link</button>
            </div>
            <button
              onClick={onSend}
              disabled={sending || uploading || (!draft.body.trim() && draft.attachments.length === 0)}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
            >
              {sending ? "Sending…" : uploading ? "Uploading…" : "Send"}
            </button>
          </div>
          {sendError && <div className="text-[13px] text-danger">{sendError}</div>}
          <div className="text-[12px] text-muted">We&apos;ll email the team when you send a message here.</div>
        </div>
      </div>
    </div>
  );
}

export default function WaitingView({ token }: { token: string }) {
  const [clientName, setClientName] = useState<string | null>(null);
  const [projects, setProjects] = useState<WaitingProject[]>([]);
  // Which list the switcher is showing — null = "All". Seeded from
  // ?project=<id> so a link copied from a specific project's "Copy list
  // link" (Cockpit.tsx) opens straight into that list, without this being a
  // second kind of link — it's the same client token, just a starting
  // filter. Read once via the raw querystring (no next/navigation import
  // elsewhere in this deliberately self-contained page) rather than a
  // useEffect, so the switcher doesn't visibly flash "All" first.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("project"));
  // ?task=<id> — a link composed from one specific task (the task drawer's
  // email tab) so that exact item is visible here even if it isn't
  // otherwise waiting-on-client or answered (e.g. "this is done"), and gets
  // scrolled to + highlighted below instead of buried in the rest of the list.
  const deepLinkTaskId = useMemo(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("task")), []);
  // Landing page is a plain list — title + status only, no inline threads —
  // and opening one task swaps the whole main column to that task's full
  // chat instead of every card carrying its own thread+composer inline.
  // That's what was making the list unreadable on mobile: N tasks each
  // rendering a scrollable thread and a composer, stacked on top of each
  // other. A ?task= deep link (e.g. from the task drawer's email tab) opens
  // straight into that task's detail view instead of the list.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => deepLinkTaskId);
  const openTask = (id: string) => { setSelectedTaskId(id); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const closeTask = () => { setSelectedTaskId(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [tasks, setTasks] = useState<WaitingTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // Chat is always open for any non-done task (no more "submit once, then
  // click Edit to reopen" toggle) — a running conversation doesn't have an
  // edit mode, just a composer that's always there until the task is done.
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});

  // A separate "need something else?" composer — raises a brand-new task
  // rather than replying to one already waiting on the client.
  const [newBody, setNewBody] = useState("");
  // Which list a new request goes to — only shown/asked when there's more
  // than one project; undefined = "let the picker default itself" (to
  // whichever list is currently being viewed, or the first one) the next
  // time projects loads, rather than fighting that default forever once
  // the client has touched the dropdown themselves.
  const [newProjectId, setNewProjectId] = useState<string | undefined>(undefined);
  const [newAttachments, setNewAttachments] = useState<DraftAttachment[]>([]);
  const [newUploading, setNewUploading] = useState(false);
  const [newSaving, setNewSaving] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [newSent, setNewSent] = useState(false);

  // Collapsed behind a big "Add something else" button by default — an
  // always-open composer read as a third thing competing for attention next
  // to whatever's actually open; this is deliberately a request, not the
  // default state of the page.
  const [addElseOpen, setAddElseOpen] = useState(false);
  // Completed items are history, not something waiting on the client — kept
  // out of the main list and tucked behind a closed-by-default toggle at
  // the bottom instead of sorted inline with what's still open.
  const [completedOpen, setCompletedOpen] = useState(false);

  // Shared "add a link" popover — only one open at a time, keyed by task id
  // or the "__new__" sentinel for the "Need something else?" composer, so
  // both places reuse the same small bit of state instead of duplicating it.
  const [linkForId, setLinkForId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const addLinkAttachment = (id: string) => {
    const raw = linkUrl.trim();
    if (!raw) return;
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const att: DraftAttachment = { id: localId(), name: linkLabel.trim() || href.replace(/^https?:\/\//, ""), kind: "link", size: "", url: href };
    if (id === "__new__") setNewAttachments((prev) => [...prev, att]);
    else setDrafts((prev) => { const d = prev[id] ?? { body: "", attachments: [] }; return { ...prev, [id]: { ...d, attachments: [...d.attachments, att] } }; });
    setLinkUrl(""); setLinkLabel(""); setLinkForId(null);
  };

  const load = async () => {
    try {
      const res = await fetch(`/api/waiting/${token}${deepLinkTaskId ? `?task=${encodeURIComponent(deepLinkTaskId)}` : ""}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || "This link isn't valid."); return; }
      setClientName(j.clientName ?? null);
      setProjects(Array.isArray(j.projects) ? j.projects : []);
      const list: WaitingTask[] = Array.isArray(j.tasks) ? j.tasks : [];
      setTasks(list);
      // Seed an empty draft per task — only for tasks with no draft yet, so
      // a later refetch (after Send) doesn't clobber a draft someone's
      // mid-typing elsewhere, and doesn't resurrect text that was just sent.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const t of list) {
          if (next[t.id]) continue;
          next[t.id] = { body: "", attachments: [] };
        }
        return next;
      });
    } catch {
      setError("Couldn't load this page — check your connection and try again.");
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  // Nothing pushes to this page in real time (it's public/unauthenticated,
  // not wired into the app's Supabase Realtime channel), so if a client
  // leaves it open, a team reply would otherwise never show up until they
  // manually reload. Poll instead — paused while the tab isn't visible, so
  // a forgotten background tab doesn't hammer the API forever. load()'s own
  // draft-seeding only fills in NEW tasks, so a silent background refresh
  // never clobbers a draft someone's mid-typing.
  useEffect(() => {
    const POLL_MS = 15000;
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);


  // Keep each task's thread pane scrolled to its newest message — runs
  // after every load() (initial, post-send, or the background poll above),
  // not just once, so a reply that arrives via polling is visible without
  // the client having to scroll down themselves.
  const threadRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    for (const el of Object.values(threadRefs.current)) { if (el) el.scrollTop = el.scrollHeight; }
  }, [tasks]);

  const sorted = useMemo(() => {
    if (!tasks) return [];
    const rank = (t: WaitingTask) => (t.status === "done" ? 2 : t.needsResponse ? 0 : 1);
    const scoped = activeProjectId ? tasks.filter((t) => t.projectId === activeProjectId) : tasks;
    return [...scoped].sort((a, b) => rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }, [tasks, activeProjectId]);
  // Split out of the main list entirely — done items are history, not
  // something to scan past on the way to what's still open.
  const openTasks = sorted.filter((t) => t.status !== "done");
  const completedTasks = sorted.filter((t) => t.status === "done");
  // Looked up from the full list, not `sorted` — a task opened via a
  // deep link or an earlier project tab should still open in detail even if
  // the client has since switched to a different list's tab.
  const selectedTask = selectedTaskId ? (tasks ?? []).find((t) => t.id === selectedTaskId) ?? null : null;
  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? null : null);
  const doneCount = sorted.filter((t) => t.status === "done").length;
  const progressPct = sorted.length ? Math.round((doneCount / sorted.length) * 100) : 0;
  // Which list a new request will actually go to: the client's own pick
  // once they've touched the dropdown, else whatever list they're currently
  // viewing, else the first one — never asked at all when there's only one.
  const effectiveNewProjectId = newProjectId ?? activeProjectId ?? projects[0]?.id ?? null;

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

  const sendChatMessage = async (taskId: string) => {
    const draft = drafts[taskId] ?? { body: "", attachments: [] };
    if (!draft.body.trim() && draft.attachments.length === 0) return;
    setSendingIds((s) => new Set(s).add(taskId));
    try {
      const res = await fetch(`/api/waiting/${token}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, body: draft.body, attachments: draft.attachments }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setSendErrors((e) => ({ ...e, [taskId]: j.error || "Couldn't send — try again." })); return; }
      setSendErrors((e) => { const n = { ...e }; delete n[taskId]; return n; });
      // Clear the composer immediately — load()'s draft-seeding only fills
      // in tasks with NO existing entry, so without this the just-sent text
      // would still sit in the box looking unsent.
      setDrafts((prev) => ({ ...prev, [taskId]: { body: "", attachments: [] } }));
      await load();
    } finally {
      setSendingIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
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
        body: JSON.stringify({ body: newBody, attachments: newAttachments, projectId: effectiveNewProjectId }),
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

  // Reused for both the sidebar's vertical tab rail (desktop) and the
  // horizontal one shown inline on mobile — same buttons, different layout.
  // Tailwind border-color utilities (border-highlight, border-accent, …)
  // never win here: globals.css has an unlayered `* { border-color:
  // var(--border) }` that beats any layered Tailwind utility regardless of
  // specificity. Every colored border on this page has to go through
  // inline style instead — the same workaround the pre-chat version of
  // this file already used for the done/waiting card borders.
  const tabPill = (active: boolean) => ({
    className: `rounded-full border px-3 py-1.5 text-[13px] font-medium ${active ? "bg-accent text-white" : "bg-surface text-muted hover:bg-background"}`,
    style: active ? { borderColor: "var(--highlight)" } : undefined,
  });
  const projectTabs = (
    <>
      <button onClick={() => setActiveProjectId(null)} {...tabPill(activeProjectId === null)}>All</button>
      {projects.map((p) => (
        <button key={p.id} onClick={() => setActiveProjectId(p.id)} {...tabPill(activeProjectId === p.id)}>{p.name}</button>
      ))}
    </>
  );
  const privacyNote = <p className="text-[12.5px] text-muted">This is a private link just for you. Please don&apos;t forward it.</p>;
  const isEmpty = tasks && (tasks.length === 0 || openTasks.length === 0);
  const emptyState = (
    <div className="rounded-2xl border border-dashed bg-surface px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-[26px] text-success">✓</div>
      <h2 className="text-[18px] font-bold">You&apos;re all caught up</h2>
      <p className="mt-1 text-[14.5px] text-muted">
        {tasks && tasks.length === 0 ? "Nothing needs your input right now. We'll email you the moment something does." : `Nothing needed from you in ${projectName(activeProjectId)} right now.`}
      </p>
    </div>
  );

  // One lean row — title, status, one-line preview — shared by the open
  // list and the collapsed Completed section below it.
  const renderTaskRow = (t: WaitingTask) => {
    const isDone = t.status === "done";
    // Newest message (either side) as a one-line preview — gives the list
    // some content beyond a bare title/status without pulling the whole
    // thread onto the landing page.
    const lastMsg = t.thread.length > 0 ? t.thread[t.thread.length - 1] : null;
    const preview = lastMsg
      ? `${lastMsg.from === "client" ? "You" : lastMsg.sender?.name ?? "Team"}: ${lastMsg.body || (lastMsg.attachments.length > 0 ? "Sent an attachment" : "")}`
      : t.description;
    return (
      <button
        key={t.id}
        onClick={() => openTask(t.id)}
        className="flex w-full items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left shadow-[var(--shadow-sm)] transition hover:bg-surface-2"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: isDone ? "var(--success)" : t.needsResponse ? "var(--highlight)" : "var(--border)" }} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[15.5px] font-semibold ${isDone ? "text-muted line-through decoration-muted/40" : ""}`}>{t.title}</div>
          {preview && <div className="truncate text-[13px] text-muted">{preview}</div>}
          {!activeProjectId && projects.length > 1 && projectName(t.projectId) && (
            <div className="text-[12px] text-muted">{projectName(t.projectId)}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isDone ? (
            <span className="text-[12px] text-muted">Completed{t.due ? ` ${formatDue(t.due)}` : ""}</span>
          ) : (<>
            <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${t.needsResponse ? "bg-highlight-soft text-highlight" : "bg-accent-soft text-accent"}`}>
              {t.needsResponse ? "Needs your input" : "In progress"}
            </span>
            {t.due && <span className={`text-[12px] ${isOverdue(t.due) ? "font-medium text-danger" : "text-muted"}`}>{formatDue(t.due)}</span>}
          </>)}
        </div>
        <span className="shrink-0 text-muted" aria-hidden>›</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div style={{ background: "linear-gradient(135deg, #12283f, var(--accent))" }} className="px-6 py-3 md:px-10">
        <div className="mx-auto max-w-[1280px] text-center">
          <div className="text-[15px] font-bold tracking-tight text-white">ClickUpLocal</div>
          <div className="text-[11px] text-white/70">What we&apos;re waiting on you for</div>
        </div>
      </div>

      <div className="mx-auto max-w-[1280px] px-6 pb-16 pt-8 md:px-10">
        {error ? (
          <div className="rounded-lg bg-danger-soft px-3 py-2 text-[15px] text-danger">{error}</div>
        ) : !tasks ? (
          <div className="py-8 text-center text-[13px] text-muted">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 gap-10 md:grid-cols-[220px_minmax(0,760px)]">
            {/* Identity + nav rail — desktop only; mobile gets the equivalent
                pieces inline in the main column below instead. */}
            <div className="sticky top-6 hidden self-start md:block">
              {clientName && <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-highlight">{clientName}</div>}
              <h1 className="mb-3 text-[22px] font-extrabold tracking-tight">Your open items</h1>
              {sorted.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1.5 flex justify-between text-[12.5px] text-muted"><span>Progress</span><span className="font-medium text-foreground">{doneCount} of {sorted.length} done</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-success" style={{ width: `${progressPct}%` }} /></div>
                </div>
              )}
              {projects.length > 1 && <div className="mb-5 flex flex-col items-stretch gap-1.5">{projectTabs}</div>}
              <div className="border-t pt-4">{privacyNote}</div>
            </div>

            <div className="min-w-0">
              {selectedTask ? (
                <div>
                  <button onClick={closeTask} className="mb-4 inline-flex items-center gap-1 text-[14px] font-medium text-accent hover:underline">← Back to your tasks</button>
                  <TaskDetailCard
                    task={selectedTask}
                    showProjectName={!activeProjectId && projects.length > 1}
                    projectName={projectName(selectedTask.projectId)}
                    draft={drafts[selectedTask.id] ?? { body: "", attachments: [] }}
                    sending={sendingIds.has(selectedTask.id)}
                    uploading={uploadingIds.has(selectedTask.id)}
                    sendError={sendErrors[selectedTask.id]}
                    linkOpen={linkForId === selectedTask.id}
                    linkUrl={linkUrl}
                    linkLabel={linkLabel}
                    threadRef={(el) => { threadRefs.current[selectedTask.id] = el; }}
                    onBody={(body) => updateBody(selectedTask.id, body)}
                    onFiles={(files) => handleFiles(selectedTask.id, files)}
                    onRemoveAttachment={(attId) => removeAttachment(selectedTask.id, attId)}
                    onToggleLink={() => { setLinkForId((id) => (id === selectedTask.id ? null : selectedTask.id)); setLinkUrl(""); setLinkLabel(""); }}
                    onLinkUrl={setLinkUrl}
                    onLinkLabel={setLinkLabel}
                    onAddLink={() => addLinkAttachment(selectedTask.id)}
                    onSend={() => sendChatMessage(selectedTask.id)}
                  />
                </div>
              ) : (<>
              {projects.length > 1 && <div className="mb-4 flex flex-wrap gap-1.5 md:hidden">{projectTabs}</div>}

              {/* text-[16px] is the floor, not a target — this app never
                  goes below 16px in user-facing copy (readability on a
                  client's own phone, no exceptions for "fine print"), so a
                  lighter/tighter treatment (padding, weight, line-height)
                  is how this reads smaller without crossing that line. */}
              <div className="mb-5 rounded-xl border bg-highlight-soft px-3.5 py-2.5 text-[16px] leading-snug text-foreground" style={{ borderColor: "color-mix(in srgb, var(--highlight) 35%, var(--border))" }}>
                <span className="font-semibold">One request per line, please.</span> If you have more than one thing, give each its own line (or send them one at a time below). It helps us track and finish each one quickly instead of it getting lost inside a combined message.
              </div>

              {addElseOpen ? (
                <div className="mb-5 rounded-xl border bg-surface-2 p-4 shadow-[var(--shadow-sm)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[15px] font-bold">Need something else?</div>
                      <div className="mt-0.5 text-[13px] text-muted">Tell us what you need and we&apos;ll take a look.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {projects.length > 1 && (
                        <select value={effectiveNewProjectId ?? ""} onChange={(e) => setNewProjectId(e.target.value)} title="Which list this goes on"
                          className="rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent">
                          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => setAddElseOpen(false)} title="Close" className="text-muted hover:text-foreground">✕</button>
                    </div>
                  </div>
                  <textarea
                    autoFocus
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    placeholder="What do you need?"
                    rows={3}
                    className="mt-2 w-full rounded-lg border bg-surface px-2.5 py-2 text-[14px] outline-none focus:border-accent"
                  />
                  {newAttachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {newAttachments.map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-[12px]">
                          {a.name} <span className="text-muted">{a.size}</span>
                          <button onClick={() => setNewAttachments((prev) => prev.filter((x) => x.id !== a.id))} title="Remove" className="text-muted hover:text-danger">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {linkForId === "__new__" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-surface p-2">
                      <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLinkAttachment("__new__"); }} placeholder="Paste a link (Drive, website, doc…)" className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
                      <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLinkAttachment("__new__"); }} placeholder="Label (optional)" className="w-32 rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
                      <button onClick={() => addLinkAttachment("__new__")} disabled={!linkUrl.trim()} className="rounded-md bg-accent px-2.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">Add</button>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-accent">
                        + Attach files
                        <input type="file" multiple className="hidden" onChange={(e) => { handleNewFiles(e.target.files); e.target.value = ""; }} />
                      </label>
                      <button onClick={() => { setLinkForId((id) => (id === "__new__" ? null : "__new__")); setLinkUrl(""); setLinkLabel(""); }} className="text-[13px] font-medium text-accent">+ Add link</button>
                    </div>
                    <button
                      onClick={submitNewRequest}
                      disabled={newSaving || newUploading || (!newBody.trim() && newAttachments.length === 0)}
                      className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
                    >
                      {newSaving ? "Sending…" : newUploading ? "Uploading…" : "Send"}
                    </button>
                  </div>
                  {newError && <div className="mt-1.5 text-[13px] text-danger">{newError}</div>}
                  {newSent && <div className="mt-1.5 text-[13px] text-success">Sent, we&apos;ll take a look!</div>}
                </div>
              ) : (
                <button onClick={() => setAddElseOpen(true)}
                  className="mb-5 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-surface-2 py-4 text-[15px] font-bold text-accent transition hover:bg-surface"
                  style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, var(--border))" }}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[13px] font-black leading-none text-white">+</span> Add something else
                </button>
              )}

              {isEmpty ? emptyState : (
                <div className="space-y-2">
                  {openTasks.map((t) => renderTaskRow(t))}
                </div>
              )}

              {completedTasks.length > 0 && (
                <div className={isEmpty ? "" : "mt-5"}>
                  <button onClick={() => setCompletedOpen((o) => !o)} className="flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-foreground">
                    <span className={`inline-block transition-transform ${completedOpen ? "rotate-90" : ""}`} aria-hidden>›</span>
                    Completed · {completedTasks.length}
                  </button>
                  {completedOpen && <div className="mt-2 space-y-2">{completedTasks.map((t) => renderTaskRow(t))}</div>}
                </div>
              )}
              </>)}

              <p className="mt-6 text-[12.5px] text-muted md:hidden">This is a private link just for you. Please don&apos;t forward it.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

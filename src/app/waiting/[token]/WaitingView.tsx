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
// "Here's where you are, what's done, what's next" — see
// /api/waiting/[token]/route.ts's playbook payload. next/total/doneCount
// track the main growth-plan path only (same definition Cockpit.tsx's own
// dashboard uses); phases is the full display breakdown, side quests (A2P,
// email domain) and ongoing retention included, for the "see your full
// plan" accordion below the headline.
type WaitingPlaybookStep = { key: string; label: string; done: boolean };
type WaitingPlaybookPhase = { key: string; label: string; steps: WaitingPlaybookStep[] };
type WaitingPlaybook = { doneCount: number; total: number; pct: number; next: { key: string; label: string } | null; phases: WaitingPlaybookPhase[] };
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
// The shared Attachment type (src/lib/data.ts) has no "video" kind — it's
// used across the whole app, not just this page, so a video still stores
// as kind "doc". Checked by filename here instead, purely for how
// AttachmentGallery renders it (an inline player instead of a file chip).
// Matches the upload route's own allowlist exactly (src/app/api/waiting/
// [token]/upload/route.ts) — no point recognizing an extension here that
// the server would reject before it ever got this far.
const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "m4v"];
const isVideoName = (name: string) => VIDEO_EXTENSIONS.includes(name.split(".").pop()?.toLowerCase() ?? "");
const localId = () => `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// A plain http(s) URL typed into a message (or a task description) should
// still be clickable — same URL-detection idiom the internal app's own
// renderRichText (src/components/cockpit/ui.tsx) uses, duplicated here
// rather than imported since this page deliberately doesn't pull in the
// cockpit component tree.
const URL_RE = /(https?:\/\/[^\s<>"'[\]]+)/g;
const URL_TRAILING_PUNCT_RE = /[).,;:!?\]}'"]+$/;
function linkify(text: string) {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const trailing = part.match(URL_TRAILING_PUNCT_RE)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline">{url}</a>
        {trailing}
      </span>
    );
  });
}

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
        if (isVideoName(a.name)) {
          return (
            <video key={a.id} src={a.url} controls preload="metadata" className="h-40 max-w-full rounded-lg border bg-black" />
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

// Full task detail body — due/status, description, attachments, the
// complete running chat, and a composer. Used only for whichever one task
// is currently selected (see selectedTaskId in WaitingView) — pulled out of
// the list rows entirely so the landing page can stay a lean list instead
// of every row carrying its own thread+composer inline (that's what made
// the old combined view unreadable on mobile with more than a task or two).
// No title/back button here — those live in the shared hero bar above this
// (see WaitingView's return), which becomes this task's header instead of
// a second one nested inside a card.
function TaskDetailBody({
  task: t, showProjectName, projectName, draft, sending, uploading, sendError, linkOpen, linkUrl, linkLabel, threadRef,
  onBody, onFiles, onRemoveAttachment, onToggleLink, onLinkUrl, onLinkLabel, onAddLink, onSend,
  onSetStatus, statusBusy,
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
  // "What do you think?" — lets the client mark a task Needs attention/Needs
  // changes/Approved right from the chat instead of writing a message and
  // waiting on the team to reclassify it (see
  // /api/waiting/[token]/status/route.ts, which allows exactly these three).
  onSetStatus: (status: "changes_requested" | "review" | "done") => void;
  statusBusy: boolean;
}) {
  const isDone = t.status === "done";
  const [dragOver, setDragOver] = useState(false);
  // Shows the jump-to-latest button only while scrolled away from the
  // bottom — starts true since the thread opens already scrolled down
  // (see the auto-scroll effect in WaitingView), and native scroll events
  // fire even for that effect's own programmatic scrollTop assignment, so
  // this stays in sync without any extra wiring.
  const [atBottom, setAtBottom] = useState(true);
  const checkAtBottom = (el: HTMLDivElement | null) => {
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };
  // Backward compat: a response submitted before per-task chat existed
  // lives on the task itself, not in the messages table — shown as the
  // thread's opening message only when there's no real thread yet, so
  // history isn't lost but a task that's since moved to real chat doesn't
  // show it twice.
  const displayThread: WaitingMessage[] = t.thread.length > 0 || !t.response
    ? t.thread
    : [{ id: "legacy_response", from: "client", body: t.response.body, at: t.response.submittedAt, attachments: t.response.attachments }];
  const composer = (
    <>
      {/* text-[16px] isn't a style choice here — any input/textarea under
          16px makes iOS Safari auto-zoom on focus, and the zoom (plus its
          "scroll the focused field into view") is exactly what was shoving
          the whole page sideways when the keyboard opened. */}
      {/* Drag-and-drop straight onto the composer — same upload path as
          "+ Attach files" (onFiles), just fed from the drop event's files
          instead of a picked FileList. Native drag-drop already hands over
          every dropped file at once, images and videos alike, no separate
          multi-file wiring needed beyond what "+ Attach files" already has. */}
      <textarea
        value={draft.body}
        onChange={(e) => onBody(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSend(); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
        placeholder={dragOver ? "Drop to attach…" : "Type a message, we'll email the team…"}
        rows={2}
        className={`w-full resize-none rounded-lg border px-2.5 py-2 text-[16px] outline-none focus:border-accent ${dragOver ? "border-accent bg-accent-soft/30" : "bg-background"}`}
      />
      {draft.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px]">
              {a.name} <span className="text-muted">{a.size}</span>
              <button onClick={() => onRemoveAttachment(a.id)} title="Remove" className="text-muted hover:text-danger">✕</button>
            </span>
          ))}
        </div>
      )}
      {linkOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
          <input autoFocus value={linkUrl} onChange={(e) => onLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddLink(); }} placeholder="Paste a link (Drive, website, doc…)" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
          <input value={linkLabel} onChange={(e) => onLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddLink(); }} placeholder="Label (optional)" className="w-32 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
          <button onClick={onAddLink} disabled={!linkUrl.trim()} className="rounded-md bg-accent px-2.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">Add</button>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
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
      {sendError && <div className="mt-1.5 text-[13px] text-danger">{sendError}</div>}
    </>
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  return (
    <>
      {/* threadRef used to sit on the message list itself, which no longer
          scrolls on its own now that the conversation is full width (it's
          the OUTER div below that scrolls) — auto-scroll-to-newest silently
          stopped working when that changed, since scrollTop/scrollHeight on
          a non-overflowing element does nothing. Fixed by moving the ref
          here, onto the actual scrolling container. */}
      <div ref={(el) => { scrollRef.current = el; threadRef(el); }} onScroll={(e) => checkAtBottom(e.currentTarget)} className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-10">
        {(showProjectName && projectName) || isDone || t.due ? (
          <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5 text-center">
            {showProjectName && projectName && <span className="text-[12px] text-muted">{projectName}</span>}
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
          </div>
        ) : null}
        {t.description && <p className="max-w-[62ch] whitespace-pre-wrap break-words text-[14px] text-muted">{linkify(t.description)}</p>}
        <AttachmentGallery items={t.attachments} />

        {displayThread.length > 0 && (
          <div className="mt-3 space-y-2">
            {displayThread.map((m) => (
              <div key={m.id} className={`flex items-end gap-1.5 ${m.from === "client" ? "justify-end" : "justify-start"}`}>
                {m.from === "team" && <SenderAvatar sender={m.sender} />}
                {/* Bubbles still cap below their full-width container (like
                    the Fox Coach reference) — otherwise a one-line message
                    would stretch edge to edge and be unreadable — but the
                    container itself is the full page width now, not a
                    narrow centered column. */}
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[14px] lg:max-w-[640px] ${m.from === "client" ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm border bg-surface"}`}>
                  {m.body && <p className="whitespace-pre-wrap break-words">{linkify(m.body)}</p>}
                  <AttachmentGallery items={m.attachments} />
                  <div className={`mt-1 text-[11px] ${m.from === "client" ? "text-white/70" : "text-muted"}`}>
                    {m.from === "client" ? "You" : m.sender?.name ?? "Team"} · {timeAgo(m.at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pinned to this scroll viewport's own corner (absolute against
            the `relative` container it's in) rather than placed in the
            document flow — sticky-in-flow put it wherever the thread's
            content happened to end, which could land in the middle of the
            screen on a short thread. Only shown once actually scrolled
            away from the bottom. */}
        {displayThread.length > 0 && !atBottom && (
          <button onClick={scrollToBottom} title="Jump to the latest message"
            className="absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-[var(--shadow-md)] hover:opacity-90 md:right-10">↓</button>
        )}
      </div>

      {!isDone && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-background/40 px-6 py-2.5 md:px-10">
          <span className="text-[13px] font-medium text-muted">What do you think?</span>
          {/* Softest of the three: no specific edit asked for, just "put
              this back in front of someone." Maps to the internal Review
              status, whose amber sits between Changes and Done on the board
              too, so the pressed state borrows the same warm token the
              "Needs your input" chip above already uses. */}
          <button onClick={() => onSetStatus("review")} disabled={statusBusy}
            className={`rounded-full border px-3 py-1 text-[13px] font-semibold transition disabled:opacity-40 ${t.status === "review" ? "border-highlight bg-highlight-soft text-highlight" : "border-border bg-surface text-muted hover:text-foreground"}`}>
            Needs attention
          </button>
          <button onClick={() => onSetStatus("changes_requested")} disabled={statusBusy}
            className={`rounded-full border px-3 py-1 text-[13px] font-semibold transition disabled:opacity-40 ${t.status === "changes_requested" ? "border-danger bg-danger-soft text-danger" : "border-border bg-surface text-muted hover:text-foreground"}`}>
            Needs changes
          </button>
          <button onClick={() => onSetStatus("done")} disabled={statusBusy}
            className="rounded-full border border-success bg-success-soft px-3 py-1 text-[13px] font-semibold text-success transition hover:opacity-90 disabled:opacity-40">
            ✓ Approved
          </button>
        </div>
      )}

      <div className="shrink-0 border-t bg-surface px-6 py-4 md:px-10">{composer}</div>
    </>
  );
}

// "Here's where you are, what's done, and what happens next" — the one
// prominent, always-visible answer to that, right at the top of the page
// (not a second page, not a tab), with the full step-by-step plan one click
// away underneath it rather than hidden anywhere deeper. A phase auto-opens
// the first time this loads if it holds the next required step, so a
// returning client doesn't have to go hunting for where they left off.
function PlaybookProgress({ playbook }: { playbook: WaitingPlaybook }) {
  const [expanded, setExpanded] = useState(false);
  const [openPhases, setOpenPhases] = useState<Set<string>>(() => {
    const withNext = playbook.phases.find((p) => p.steps.some((s) => playbook.next?.key === s.key));
    return new Set(withNext ? [withNext.key] : []);
  });
  const togglePhase = (key: string) => setOpenPhases((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  if (playbook.total === 0) return null; // nothing reconciled yet for this client — never render an empty plan
  return (
    <div className="mb-5 rounded-2xl border bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-bold">Your growth plan</div>
        <div className="text-[13px] font-medium text-muted">{playbook.doneCount} of {playbook.total} done</div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${playbook.pct}%` }} />
      </div>
      {playbook.next ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-highlight-soft px-3 py-2.5">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-highlight">Next up</span>
          <span className="text-[14px] font-medium text-foreground">{playbook.next.label}</span>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-success-soft px-3 py-2.5 text-[14px] font-medium text-success">Every step of your growth plan is done. Nice work.</div>
      )}
      <button onClick={() => setExpanded((e) => !e)} className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-foreground">
        <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden>›</span>
        {expanded ? "Hide your full plan" : "See your full plan"}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t pt-3">
          {playbook.phases.map((phase) => {
            const phaseDone = phase.steps.filter((s) => s.done).length;
            const open = openPhases.has(phase.key);
            return (
              <div key={phase.key} className="rounded-lg border">
                <button onClick={() => togglePhase(phase.key)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                  <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                    <span className={`inline-block text-[11px] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>›</span>
                    {phase.label}
                  </span>
                  <span className="text-[12px] font-medium text-muted">{phaseDone}/{phase.steps.length}</span>
                </button>
                {open && (
                  <div className="space-y-1 border-t px-3 py-2">
                    {phase.steps.map((step) => (
                      <div key={step.key} className="flex items-center gap-2 py-0.5">
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none ${step.done ? "bg-success text-white" : "border border-border"}`}
                          aria-hidden
                        >
                          {step.done && "✓"}
                        </span>
                        <span className={`text-[13.5px] ${step.done ? "text-muted line-through decoration-muted/40" : "text-foreground"}`}>{step.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WaitingView({ token }: { token: string }) {
  const [clientName, setClientName] = useState<string | null>(null);
  // Off until the API says otherwise, so a slow/failed load never flashes an
  // "Add Something" button at a client who isn't allowed to use it.
  const [canRequestNewTasks, setCanRequestNewTasks] = useState(false);
  const [playbook, setPlaybook] = useState<WaitingPlaybook | null>(null);
  const [projects, setProjects] = useState<WaitingProject[]>([]);
  // The list is grouped by project (section headers) rather than filtered
  // by a tab switcher, so there's no "current list" state to hold — but a
  // link copied from a specific project's "Copy list link" (Cockpit.tsx)
  // still carries ?project=<id>, so that section gets scrolled to on load
  // instead of the client having to find it themselves (see the scroll
  // effect near groupRefs below).
  const initialProjectId = useMemo(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("project")), []);
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
  // Keeps ?task=<id> in the URL in sync with the open detail view (no new
  // history entry — this is "what page am I on", not a back-button stop),
  // so refreshing the browser lands back on the same task instead of
  // bouncing to the list — deepLinkTaskId above only reads this once at
  // first load, so without this a reload always lost the current view.
  const openTask = (id: string) => {
    setSelectedTaskId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("task", id);
    window.history.replaceState(null, "", url.toString());
  };
  const closeTask = () => {
    setSelectedTaskId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    window.history.replaceState(null, "", url.toString());
  };
  const [tasks, setTasks] = useState<WaitingTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // Chat is always open for any non-done task (no more "submit once, then
  // click Edit to reopen" toggle) — a running conversation doesn't have an
  // edit mode, just a composer that's always there until the task is done.
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [statusBusyIds, setStatusBusyIds] = useState<Set<string>>(new Set());

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
  const [newDragOver, setNewDragOver] = useState(false);

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

  // Set once the page has successfully rendered real data. After that point
  // a failed refresh (a 429 from the rate limiter, a dropped connection, a
  // blip) must NOT swap the client's whole page out for an error screen —
  // the last good render is far more useful than "This link isn't valid",
  // which reads as "your link is broken" for what is only a transient hiccup.
  // Errors before the first successful load still surface normally.
  const hasLoadedRef = useRef(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/waiting/${token}${deepLinkTaskId ? `?task=${encodeURIComponent(deepLinkTaskId)}` : ""}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { if (!hasLoadedRef.current) setError(j.error || "This link isn't valid."); return; }
      hasLoadedRef.current = true;
      setClientName(j.clientName ?? null);
      setCanRequestNewTasks(j.canRequestNewTasks === true);
      setPlaybook(j.playbook ?? null);
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
      if (!hasLoadedRef.current) setError("Couldn't load this page — check your connection and try again.");
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


  // Keep the open task's thread scrolled to its newest message — runs
  // after every load() (initial, post-send, or the background poll above)
  // AND whenever a task is newly opened, not just once, so a reply that
  // arrives via polling is visible without the client having to scroll
  // down themselves, and opening a task doesn't land mid-conversation.
  const threadRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    for (const el of Object.values(threadRefs.current)) { if (el) el.scrollTop = el.scrollHeight; }
  }, [tasks, selectedTaskId]);

  const rankOpen = (t: WaitingTask) => (t.needsResponse ? 0 : 1);
  const sortFn = (a: WaitingTask, b: WaitingTask) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
  // Open tasks grouped by list — a section per project (needing-response
  // tasks first within each), plus a catch-all for anything whose project
  // got deleted/reassigned out from under it. Skipped when there's only
  // one project total, since a single repeated header would just be noise.
  const openGroups = useMemo(() => {
    if (!tasks) return [];
    const open = tasks.filter((t) => t.status !== "done");
    const groups = projects
      .map((p) => ({ project: p as WaitingProject | null, tasks: open.filter((t) => t.projectId === p.id).sort((a, b) => rankOpen(a) - rankOpen(b) || sortFn(a, b)) }))
      .filter((g) => g.tasks.length > 0);
    const orphan = open.filter((t) => !projects.some((p) => p.id === t.projectId)).sort((a, b) => rankOpen(a) - rankOpen(b) || sortFn(a, b));
    if (orphan.length > 0) groups.push({ project: null, tasks: orphan });
    return groups;
  }, [tasks, projects]);
  const totalOpen = openGroups.reduce((n, g) => n + g.tasks.length, 0);
  // Completed items are their own flat list (not grouped) since there's
  // rarely more than a handful — shown behind the collapsed toggle below.
  const completedTasks = useMemo(() => (tasks ?? []).filter((t) => t.status === "done").sort(sortFn), [tasks]);
  // Looked up from the full list, not a filtered one — a task opened via a
  // deep link should still open in detail regardless of which section it's
  // actually in.
  const selectedTask = selectedTaskId ? (tasks ?? []).find((t) => t.id === selectedTaskId) ?? null : null;
  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? null : null);
  const doneCount = completedTasks.length;
  const totalCount = (tasks ?? []).length;
  // Which list a new request will actually go to: the client's own pick
  // once they've touched the dropdown, else the first one — never asked at
  // all when there's only one.
  const effectiveNewProjectId = newProjectId ?? projects[0]?.id ?? null;
  // Scrolls a project's section into view once, if this page was opened via
  // a "Copy list link" (?project=<id>) — the grouped layout replaced the
  // old filter-by-tab behavior, so this is what "opens straight to this
  // list" means now.
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrolledToProject = useRef(false);
  useEffect(() => {
    if (!initialProjectId || scrolledToProject.current) return;
    const el = groupRefs.current[initialProjectId];
    if (!el) return;
    scrolledToProject.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openGroups, initialProjectId]);

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

  const setTaskStatus = async (taskId: string, status: "changes_requested" | "review" | "done") => {
    setStatusBusyIds((s) => new Set(s).add(taskId));
    try {
      await fetch(`/api/waiting/${token}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status }),
      });
      await load();
    } finally {
      setStatusBusyIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
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

  const isEmpty = tasks && (tasks.length === 0 || totalOpen === 0);
  const emptyState = (
    <div className="rounded-2xl border border-dashed bg-surface px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-[26px] text-success">✓</div>
      <h2 className="text-[18px] font-bold">You&apos;re all caught up</h2>
      <p className="mt-1 text-[14.5px] text-muted">Nothing needs your input right now. We&apos;ll email you the moment something does.</p>
    </div>
  );

  // One lean row — title, status, one-line preview — shared by every
  // project's open section and the collapsed Completed section below them.
  // showProject only makes sense outside a grouped section (the Completed
  // list is flat, not grouped) — a section header already says which list
  // it is for everything above.
  const renderTaskRow = (t: WaitingTask, opts?: { showProject?: boolean }) => {
    const showProject = opts?.showProject ?? false;
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
        className="flex w-full items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left shadow-[var(--shadow-sm)] transition hover:bg-background"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: isDone ? "var(--success)" : t.needsResponse ? "var(--highlight)" : "var(--border)" }} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[15.5px] font-semibold ${isDone ? "text-muted line-through decoration-muted/40" : ""}`}>{t.title}</div>
          {preview && <div className="truncate text-[13px] text-muted">{preview}</div>}
          {showProject && projects.length > 1 && projectName(t.projectId) && (
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
    // Detail mode locks to exactly one viewport height with no page-level
    // scroll at all — the hero becomes this task's header (back + title)
    // and the body below it is the only scrollable region, full width, no
    // card/border/shadow wrapping it. List mode is the normal page: a
    // short hero, then content that scrolls with the page like any other
    // site (see below).
    <div className={selectedTask ? "flex h-[100dvh] flex-col overflow-hidden bg-background" : "min-h-screen bg-background"}>
      {selectedTask ? (
        <div style={{ background: "linear-gradient(135deg, #12283f, var(--accent))" }} className="relative flex shrink-0 items-center justify-center px-14 py-3 md:px-20">
          <button onClick={closeTask} title="Back to your tasks" className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-[22px] text-white hover:bg-white/10">←</button>
          <div className="max-w-[75%] truncate text-center text-[15px] font-bold text-white">{selectedTask.title}</div>
        </div>
      ) : (
        // Everything that used to be the sidebar, compressed into one thin
        // strip instead of its own banner — brand, client, heading, and
        // progress all on a single line, with the privacy note folded in
        // underneath instead of repeated at the bottom of the page.
        <div style={{ background: "linear-gradient(135deg, #12283f, var(--accent))" }} className="px-6 py-3 text-center md:px-10">
          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[14.5px] font-bold tracking-tight text-white">
            {clientName && <span>{clientName}</span>}
            <span className="font-normal">Tasks</span>
            {totalCount > 0 && <span className="font-normal text-white/80">{doneCount} of {totalCount} done</span>}
          </div>
        </div>
      )}

      {selectedTask ? (
        <TaskDetailBody
          task={selectedTask}
          showProjectName={projects.length > 1}
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
          onSetStatus={(status) => setTaskStatus(selectedTask.id, status)}
          statusBusy={statusBusyIds.has(selectedTask.id)}
        />
      ) : (
      <div className="px-6 pb-10 pt-6 md:px-10">
        {error ? (
          <div className="rounded-lg bg-danger-soft px-3 py-2 text-[15px] text-danger">{error}</div>
        ) : !tasks ? (
          <div className="py-8 text-center text-[13px] text-muted">Loading…</div>
        ) : (
            <div className="min-w-0">
              {playbook && <PlaybookProgress playbook={playbook} />}
              {/* Raising a brand-new task is per client and off by default
                  (clients.can_request_new_tasks) — for everyone else this
                  page is reply-only, so the composer and its button aren't
                  offered at all rather than shown and then refused. The
                  request route checks the same flag itself; this is only so
                  nobody is invited to press something that would fail. */}
              {canRequestNewTasks && (addElseOpen ? (
                <div className="mb-5 rounded-xl border bg-surface p-4 shadow-[var(--shadow-sm)]">
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
                    onDragOver={(e) => { e.preventDefault(); setNewDragOver(true); }}
                    onDragLeave={() => setNewDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setNewDragOver(false); handleNewFiles(e.dataTransfer.files); }}
                    placeholder={newDragOver ? "Drop to attach…" : "What do you need?"}
                    rows={3}
                    className={`mt-2 w-full rounded-lg border px-2.5 py-2 text-[16px] outline-none focus:border-accent ${newDragOver ? "border-accent bg-accent-soft/30" : "bg-background"}`}
                  />
                  {newAttachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {newAttachments.map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px]">
                          {a.name} <span className="text-muted">{a.size}</span>
                          <button onClick={() => setNewAttachments((prev) => prev.filter((x) => x.id !== a.id))} title="Remove" className="text-muted hover:text-danger">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {linkForId === "__new__" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
                      <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLinkAttachment("__new__"); }} placeholder="Paste a link (Drive, website, doc…)" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
                      <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLinkAttachment("__new__"); }} placeholder="Label (optional)" className="w-32 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
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
                <div className="mb-3">
                  {/* The explanatory sentence used to be jammed inside the
                      button's own text — the whole clickable target ended
                      up being "Add Something: One request per task,
                      please...", which read oddly and wrapped mid-sentence
                      on narrow screens. Back to a caption underneath: the
                      button says exactly what it does, the reminder sits
                      below it. */}
                  <button onClick={() => setAddElseOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-background py-2.5 text-[14px] font-bold text-accent transition hover:bg-surface"
                    style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, var(--border))" }}>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[11px] font-black leading-none text-white">+</span> Add Something
                  </button>
                  <p className="mt-1 text-center text-[12px] text-muted">One request per task, please. It&apos;s easier for us to track.</p>
                </div>
              ))}

              {isEmpty ? emptyState : (
                <div className="space-y-5">
                  {openGroups.map((g) => (
                    <div key={g.project?.id ?? "__other__"} ref={g.project ? (el) => { groupRefs.current[g.project!.id] = el; } : undefined}>
                      {projects.length > 1 && (
                        <div className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-muted">{g.project?.name ?? "Other"}</div>
                      )}
                      <div className="space-y-2">{g.tasks.map((t) => renderTaskRow(t))}</div>
                    </div>
                  ))}
                </div>
              )}

              {completedTasks.length > 0 && (
                <div className={isEmpty ? "" : "mt-5"}>
                  <button onClick={() => setCompletedOpen((o) => !o)} className="flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-foreground">
                    <span className={`inline-block transition-transform ${completedOpen ? "rotate-90" : ""}`} aria-hidden>›</span>
                    Completed · {completedTasks.length}
                  </button>
                  {completedOpen && <div className="mt-2 space-y-2">{completedTasks.map((t) => renderTaskRow(t, { showProject: true }))}</div>}
                </div>
              )}

              <p className="mt-6 text-center text-[12px] text-muted">This is a private link just for you. Please don&apos;t forward it.</p>
            </div>
        )}
      </div>
      )}
    </div>
  );
}

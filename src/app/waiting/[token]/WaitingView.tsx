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
import { timeAgo, type Attachment } from "@/lib/data";
import { uploadSharedFile } from "@/lib/docFileUpload";

type WaitingAttachment = { id: string; name: string; kind: Attachment["kind"]; size: string; path: string | null; url: string | null };
type WaitingProject = { id: string; name: string };
// One message in a task's running chat — see ./messages/route.ts (client
// sends) and the team's existing task drawer (reads/sends the same
// underlying `messages` row, just via the internal app instead of here).
type WaitingSender = { name: string; avatarUrl: string | null; color: string; initials: string };
type WaitingMessage = { id: string; from: "team" | "client"; body: string; at: string; attachments: WaitingAttachment[]; sender?: WaitingSender | null };
type WaitingTask = {
  id: string; projectId: string | null; title: string; due: string | null; description: string; status: string; needsResponse: boolean;
  /** When it was finished, for "Done Oct 3". */
  doneAt?: string | null;
  /** It has a client document (added with 📝 Doc). */
  hasDoc?: boolean;
  attachments: WaitingAttachment[];
  response: { body: string; submittedAt: string; attachments: WaitingAttachment[] } | null;
  thread: WaitingMessage[];
};
// "Here's where you are, what's done, what's next" — see
// A draft attachment is either a stored file (has `path`, uploaded via
// upload/route.ts) or a plain link (kind "link", has `url` instead) — mirrors
// the real Attachment shape closely enough for sanitizeWaitingAttachments to
// accept either on submit.
type DraftAttachment = { id: string; name: string; kind: Attachment["kind"]; size: string; path?: string; url?: string };
type Draft = { body: string; attachments: DraftAttachment[] };

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
function SenderAvatar({ sender, size = 22 }: { sender?: WaitingSender | null; size?: number }) {
  if (!sender) return <span className="flex shrink-0 items-center justify-center rounded-full bg-accent font-bold text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>CT</span>;
  if (sender.avatarUrl) return (
    // eslint-disable-next-line @next/next/no-img-element -- small inline avatar, not a next/image-friendly static asset.
    <img src={sender.avatarUrl} alt={sender.name} title={sender.name} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  );
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-white" title={sender.name} style={{ width: size, height: size, background: sender.color, fontSize: Math.round(size * 0.42) }}>
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
        if (!a.url) return <span key={a.id} className="rounded-md border bg-background px-2 py-1 text-[16px] text-muted">{a.name}</span>;
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
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[16px] text-accent hover:underline">
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
  onSetStatus, statusBusy, onDoc, docBusy, otherWaiting, onOpenTask, team, doneCount, totalCount,
}: {
  task: WaitingTask;
  /** Their other open tasks that need them, for the side panel. */
  otherWaiting: { id: string; title: string }[];
  onOpenTask: (id: string) => void;
  /** Everyone on our side who has written to them, for "Your team". */
  team: WaitingSender[];
  doneCount: number;
  totalCount: number;
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
  /** 📝 Doc: add one to this task, or open the one it has. */
  onDoc: () => void;
  docBusy: boolean;
}) {
  const isDone = t.status === "done";
  const [dragOver, setDragOver] = useState(false);
  const toolBtn = "inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-[16px] font-semibold text-foreground hover:bg-background";
  // The pages we're asking about ("Homepage: https://…") become cards to tap,
  // not long addresses inside the paragraph (Derek, 2026-10-07).
  const { before, links, after } = splitLabeledLinks(t.description);
  const lastTeam = [...displayThreadOf(t)].reverse().find((m) => m.from === "team")?.sender ?? null;
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
  const displayThread = displayThreadOf(t);
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
        className={`w-full resize-none rounded-xl border px-3 py-2.5 text-[16px] outline-none focus:border-accent ${dragOver ? "border-accent bg-accent-soft/30" : "bg-surface"}`}
      />
      {draft.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[16px]">
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
          <button onClick={onAddLink} disabled={!linkUrl.trim()} className="rounded-md bg-accent px-2.5 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Add</button>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label className={`${toolBtn} cursor-pointer`}>
          📎 Files
          <input type="file" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </label>
        <button onClick={onToggleLink} className={toolBtn}>🔗 Link</button>
        {/* A doc lives on the task, beside files and links (Derek, 2026-10-05). */}
        {!isDone && <button onClick={onDoc} disabled={docBusy} className={`${toolBtn} disabled:opacity-50`}>{docBusy ? "Opening…" : t.hasDoc ? "📝 Open doc" : "📝 Doc"}</button>}
        <span className="flex-1" />
        <button
          onClick={onSend}
          disabled={sending || uploading || (!draft.body.trim() && draft.attachments.length === 0)}
          className="h-10 rounded-lg bg-accent px-5 text-[16px] font-bold text-white disabled:opacity-40"
        >
          {sending ? "Sending…" : uploading ? "Uploading…" : "Send"}
        </button>
      </div>
      {sendError && <div className="mt-1.5 text-[16px] text-danger">{sendError}</div>}
      <div className="mt-2 text-[16px] text-muted">You can drop photos and files right into the box. We get it by email too.</div>
    </>
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  // The client portal's look (Derek, 2026-10-07): a header card, the team's
  // message with its pages as cards, one clear "what do you think", the
  // conversation, and a side panel with what else needs them and who's on it.
  const card = "rounded-xl border bg-surface";
  const cap = "mb-2.5 text-[14px] font-extrabold uppercase tracking-[0.06em] text-muted";
  const choice = (on: boolean, tone: "ok" | "chg" | "q") => `grid gap-0.5 rounded-xl border px-4 py-3 text-left transition disabled:opacity-40 ${
    on ? (tone === "chg" ? "border-danger bg-danger-soft" : tone === "q" ? "border-highlight bg-highlight-soft" : "border-success bg-success-soft")
      : tone === "ok" ? "border-success/50 bg-surface hover:bg-success-soft" : tone === "chg" ? "bg-surface hover:border-danger" : "bg-surface hover:border-highlight"}`;
  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-5 px-4 pb-10 pt-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="grid min-w-0 gap-4">
        <section className={`${card} px-5 py-4`}>
          <div className="mb-2.5 flex flex-wrap gap-2">
            {showProjectName && projectName && <span className="rounded-full bg-accent-soft px-3 py-0.5 text-[16px] font-semibold text-accent">{projectName}</span>}
            {isDone
              ? <span className="rounded-full bg-success-soft px-3 py-0.5 text-[16px] font-semibold text-success">✓ Completed</span>
              : t.needsResponse && <span className="rounded-full bg-highlight-soft px-3 py-0.5 text-[16px] font-semibold text-highlight">● Waiting on you</span>}
            {t.due && !isDone && <span className="rounded-full bg-background px-3 py-0.5 text-[16px] font-semibold text-muted">Due {shortDate(t.due)}</span>}
          </div>
          <h1 className="text-[26px] font-extrabold leading-tight" style={{ textWrap: "balance" }}>{t.title}</h1>
          {lastTeam && (
            <div className="mt-3 flex items-center gap-2.5 text-[16px] text-muted">
              <SenderAvatar sender={lastTeam} size={32} /> <span><b className="text-foreground">{lastTeam.name}</b> is working on this with you</span>
            </div>
          )}
        </section>

        {(t.description || t.attachments.length > 0) && (
          <section className={`${card} px-5 py-4 text-[16px]`}>
            {before && <p className="max-w-[68ch] whitespace-pre-wrap break-words">{linkify(before)}</p>}
            {links.length > 0 && (
              <div className={`my-3 grid gap-3 ${links.length > 1 ? "sm:grid-cols-2" : ""}`}>
                {links.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border bg-surface p-3 hover:border-accent">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-accent text-[24px] text-white" aria-hidden>🖥</span>
                    <span className="min-w-0 flex-1"><b className="block truncate">{l.label}</b><span className="block truncate text-muted">Tap to open it</span></span>
                    <span className="shrink-0 font-bold text-accent">Open ↗</span>
                  </a>
                ))}
              </div>
            )}
            {after && <p className="max-w-[68ch] whitespace-pre-wrap break-words">{linkify(after)}</p>}
            <AttachmentGallery items={t.attachments} />
          </section>
        )}

        {!isDone && (
          <section className="rounded-xl border-2 border-accent bg-surface px-5 py-4">
            <h2 className="text-[20px] font-bold">What do you think?</h2>
            <p className="mb-3 text-[16px] text-muted">Pick one. You can add a note below either way.</p>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <button onClick={() => onSetStatus("done")} disabled={statusBusy} className={choice(false, "ok")}>
                <b className="text-[17px] text-success">✓ Looks good</b><span className="text-[16px] text-muted">Approve it</span>
              </button>
              <button onClick={() => onSetStatus("changes_requested")} disabled={statusBusy} className={choice(t.status === "changes_requested", "chg")}>
                <b className="text-[17px]">✎ Needs changes</b><span className="text-[16px] text-muted">Tell us what to change</span>
              </button>
              <button onClick={() => onSetStatus("review")} disabled={statusBusy} className={choice(t.status === "review", "q")}>
                <b className="text-[17px]">? I have a question</b><span className="text-[16px] text-muted">Someone will get back to you</span>
              </button>
            </div>
          </section>
        )}

        <section className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 border-b px-5 py-3 text-[16px] font-bold">💬 Conversation</div>
          {/* The thread scrolls on its own and opens at its newest message
              (threadRef, see the effect in WaitingView), while the page itself
              opens at the top. */}
          <div className="relative">
            <div ref={(el) => { scrollRef.current = el; threadRef(el); }} onScroll={(e) => checkAtBottom(e.currentTarget)} className="max-h-[480px] overflow-y-auto px-5 py-4">
              {displayThread.length === 0 ? (
                <p className="py-2 text-center text-[16px] text-muted">No messages yet. Write below and we&apos;ll get it by email.</p>
              ) : (
                <div className="space-y-2.5">
                  {displayThread.map((m) => (
                    <div key={m.id} className={`flex items-end gap-2 ${m.from === "client" ? "justify-end" : "justify-start"}`}>
                      {m.from === "team" && <SenderAvatar sender={m.sender} size={30} />}
                      <div className={`max-w-[85%] lg:max-w-[560px] ${m.from === "client" ? "text-right" : ""}`}>
                        <div className={`inline-block rounded-2xl px-3.5 py-2.5 text-left text-[16px] ${m.from === "client" ? "rounded-br-md bg-accent text-white" : "rounded-bl-md bg-background"}`}>
                          {m.body && <p className="whitespace-pre-wrap break-words">{linkify(m.body)}</p>}
                          <AttachmentGallery items={m.attachments} />
                        </div>
                        <div className="mt-1 text-[16px] text-muted">{m.from === "client" ? "You" : m.sender?.name ?? "Team"} · {timeAgo(m.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {displayThread.length > 0 && !atBottom && (
              <button onClick={scrollToBottom} title="Jump to the latest message"
                className="absolute bottom-3 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-[var(--shadow-md)] hover:opacity-90">↓</button>
            )}
          </div>
          <div className="border-t px-5 py-4">{composer}</div>
        </section>
      </div>

      <aside className="grid gap-4">
        {totalCount > 0 && (
          <div className={`${card} p-4`}>
            <div className={cap}>{projectName ?? "Your project"}</div>
            <div className="h-2 overflow-hidden rounded-full bg-border"><i className="block h-full bg-success" style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }} /></div>
            <div className="mt-1.5 text-[16px] text-muted"><b className="text-foreground">{doneCount} of {totalCount}</b> tasks done</div>
          </div>
        )}
        {otherWaiting.length > 0 && (
          <div className={`${card} p-4`}>
            <div className={`${cap} flex items-center`}>Also waiting on you <span className="ml-auto rounded-full bg-highlight-soft px-2.5 text-[14px] tracking-normal text-highlight">{otherWaiting.length}</span></div>
            {otherWaiting.slice(0, 5).map((o, i) => (
              <button key={o.id} onClick={() => onOpenTask(o.id)} className={`flex w-full items-center gap-2.5 py-2.5 text-left text-[16px] ${i ? "border-t" : "pt-0"}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-highlight" />
                <span className="min-w-0 flex-1">{o.title}</span>
                <span className="shrink-0 font-semibold text-accent">Open</span>
              </button>
            ))}
          </div>
        )}
        {team.length > 0 && (
          <div className={`${card} p-4`}>
            <div className={cap}>Your team</div>
            <div className="grid gap-3">
              {team.map((p) => (
                <div key={p.name} className="flex items-center gap-2.5 text-[16px]"><SenderAvatar sender={p} size={36} /><b>{p.name}</b></div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

// "Homepage: https://…" in a task's description: the label and the link, so
// the page can show it as a card. Only labelled links (a few words, then a
// colon); a bare link stays in the text. `before` is the text up to the first
// one, `after` the rest once they're taken out.
function splitLabeledLinks(text: string): { before: string; links: { label: string; url: string }[]; after: string } {
  const re = /(?:^|[\s.])([A-Za-z][^:\n.]{0,40}?):\s*(https?:\/\/[^\s<>"']+)/g;
  const links: { label: string; url: string }[] = [];
  let first = -1, last = 0;
  for (const m of text.matchAll(re)) {
    const label = m[1].trim();
    if (label.split(/\s+/).length > 5) continue;
    const url = m[2].replace(URL_TRAILING_PUNCT_RE, "");
    const at = (m.index ?? 0) + m[0].indexOf(m[1]);
    if (first < 0) first = at;
    last = at + m[0].length - m[0].indexOf(m[1]) - (m[2].length - url.length);
    links.push({ label, url });
  }
  if (!links.length) return { before: text, links, after: "" };
  return { before: text.slice(0, first).trim(), links, after: text.slice(last).replace(/^[\s.,;:!?]+/, "").trim() };
}

// The thread as shown: an old reply from before chat counts as its first message.
function displayThreadOf(t: WaitingTask): WaitingMessage[] {
  return t.thread.length > 0 || !t.response
    ? t.thread
    : [{ id: "legacy_response", from: "client", body: t.response.body, at: t.response.submittedAt, attachments: t.response.attachments }];
}

// "Here's where you are, what's done, and what happens next" — the one
// prominent, always-visible answer to that, right at the top of the page
// (not a second page, not a tab), with the full step-by-step plan one click
// away underneath it rather than hidden anywhere deeper. A phase auto-opens
// the first time this loads if it holds the next required step, so a
// returning client doesn't have to go hunting for where they left off.
const sortFn = (a: WaitingTask, b: WaitingTask) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
// Dates the client sees (Derek, 2026-10-05): "Needed by" on what needs them
// (red once it's late), "Done" on what's finished, nothing on work in
// progress, whose dates move as the team works.
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const shortDate = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
function dateNote(t: WaitingTask): { text: string; late: boolean } | null {
  if (t.status === "done") return t.doneAt ? { text: `Done ${shortDate(t.doneAt)}`, late: false } : null;
  if (t.needsResponse && t.due) return { text: `Needed by ${shortDate(t.due)}`, late: t.due < todayKey() };
  return null;
}
// Groups a flat task list by project — a section per project, plus a
// catch-all for anything whose project got deleted/reassigned out from
// under it. Shared by both top-level sections (needsResponseGroups,
// inProgressGroups) rather than duplicated per section.
function groupByProject(list: WaitingTask[], projects: WaitingProject[]) {
  const groups = projects
    .map((p) => ({ project: p as WaitingProject | null, tasks: list.filter((t) => t.projectId === p.id).sort(sortFn) }))
    .filter((g) => g.tasks.length > 0);
  const orphan = list.filter((t) => !projects.some((p) => p.id === t.projectId)).sort(sortFn);
  if (orphan.length > 0) groups.push({ project: null, tasks: orphan });
  return groups;
}

export default function WaitingView({ token }: { token: string }) {
  const [clientName, setClientName] = useState<string | null>(null);
  // Off until the API says otherwise, so a slow/failed load never flashes an
  // "Add Something" button at a client who isn't allowed to use it.
  const [canRequestNewTasks, setCanRequestNewTasks] = useState(false);
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
  // New task extras (Derek, 2026-10-05): when they need it, and starting a doc with it.
  const [newNeededBy, setNewNeededBy] = useState("");
  const [newWithDoc, setNewWithDoc] = useState(false);
  const [docBusyId, setDocBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("all");
  // What we need from them, or every task (Derek, 2026-10-07: "when they go it
  // only shows what we need from them and if they want they click a toggle to
  // see all tasks"). Unset until they pick: it opens on theirs when there is any.
  const [view, setView] = useState<"theirs" | "all" | null>(null);
  const [doneOpenIds, setDoneOpenIds] = useState<Set<string>>(new Set());
  // "What we're working on" starts open (Derek, 2026-09-16: "default it open",
  // reversing 2026-08-26). A client can still fold it away.
  const [inProgressOpen, setInProgressOpen] = useState(true);
  // Project filter. "" is everything; otherwise one project's id. A
  // project-scoped share link already only carries its own project, so the
  // chips simply don't render in that case.
  // The list tabs replaced the filter chips (2026-10-05); kept at "everything"
  // for the memos below that still read it.
  const [projectFilter] = useState("");

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
      // A first load that failed (weak signal, rate limit) left an error on
      // screen; the 15 second refresh that works must replace it.
      setError(null);
      setClientName(j.clientName ?? null);
      setCanRequestNewTasks(j.canRequestNewTasks === true);
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

  // Split into two top-level sections instead of interleaving within each
  // project: "what we need from you" (needsResponse) always leads, since
  // that's the actionable half of the page, then "what we're working on"
  // (everything else still open) below it — each still broken out by
  // project underneath, same as before.
  // Counts are of OPEN work, not everything: a chip reading "Website · 4" is
  // answering "how much is live over there", which is what someone scanning
  // this page wants to know.
  const inFilter = useMemo(
    () => (t: { projectId: string | null }) => !projectFilter || t.projectId === projectFilter,
    [projectFilter],
  );
  const open = useMemo(() => (tasks ?? []).filter((t) => t.status !== "done").filter(inFilter), [tasks, inFilter]);
  const needsResponseGroups = useMemo(() => groupByProject(open.filter((t) => t.needsResponse), projects), [open, projects]);
  const inProgressGroups = useMemo(() => groupByProject(open.filter((t) => !t.needsResponse), projects), [open, projects]);
  // Completed items are their own flat list (not grouped) since there's
  // rarely more than a handful — shown behind the collapsed toggle below.
  const completedTasks = useMemo(() => (tasks ?? []).filter((t) => t.status === "done").filter(inFilter).sort(sortFn), [tasks, inFilter]);
  // Looked up from the full list, not a filtered one — a task opened via a
  // deep link should still open in detail regardless of which section it's
  // actually in.
  const selectedTask = selectedTaskId ? (tasks ?? []).find((t) => t.id === selectedTaskId) ?? null : null;
  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? null : null);
  const doneCount = completedTasks.length;
  // Everyone on our side who has written to them, newest first, once each.
  const teamSenders = useMemo(() => {
    const seen = new Map<string, WaitingSender>();
    const all = (tasks ?? []).flatMap((x) => x.thread).filter((m) => m.from === "team" && m.sender).sort((a, b) => b.at.localeCompare(a.at));
    for (const m of all) if (!seen.has(m.sender!.name)) seen.set(m.sender!.name, m.sender!);
    return [...seen.values()].slice(0, 5);
  }, [tasks]);
  const totalCount = (tasks ?? []).length;
  // Which list a new request will actually go to: the client's own pick
  // once they've touched the dropdown, else the first one — never asked at
  // all when there's only one.
  const effectiveNewProjectId = newProjectId ?? projects[0]?.id ?? null;
  // Scrolls a project's section into view once, if this page was opened via
  // a "Copy list link" (?project=<id>) — the grouped layout replaced the
  // old filter-by-tab behavior, so this is what "opens straight to this
  // list" means now.
  // A project can now appear in both sections (it has tasks in each), so
  // refs are keyed per section — the scroll target prefers "needs your
  // input" since that's the topmost, most actionable occurrence.
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrolledToProject = useRef(false);
  useEffect(() => {
    if (!initialProjectId || scrolledToProject.current) return;
    const req = groupRefs.current[`req-${initialProjectId}`];
    // Nothing needs them in this project, so the link's target is inside the
    // "What we're working on", which the client may have folded. Open it, or the scroll lands on
    // a display:none element and the page just sits at the top looking empty.
    if (!req && groupRefs.current[`wip-${initialProjectId}`] && !inProgressOpen) {
      setInProgressOpen(true);
      return; // re-runs once the section is actually on screen
    }
    const el = req ?? groupRefs.current[`wip-${initialProjectId}`];
    if (!el) return;
    scrolledToProject.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [needsResponseGroups, inProgressGroups, initialProjectId, inProgressOpen]);

  const updateBody = (taskId: string, body: string) =>
    setDrafts((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] ?? { attachments: [] }), body } }));

  // Files go straight to storage (docFileUpload.ts), so a 25 MB video works, and a
  // file that can't be added says why instead of quietly not appearing.
  const uploadApi = (taskId: string | null) => (payload: Record<string, unknown>) =>
    fetch(`/api/waiting/${token}/upload`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ...(taskId ? { task_id: taskId } : {}) }),
    });

  const handleFiles = async (taskId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingIds((s) => new Set(s).add(taskId));
    setSendErrors((e) => { const n = { ...e }; delete n[taskId]; return n; });
    for (const f of Array.from(files)) {
      // One file failing doesn't stop the rest; the last problem is what shows.
      const r = await uploadSharedFile(f, uploadApi(taskId));
      if (!r.ok) { setSendErrors((e) => ({ ...e, [taskId]: r.error })); continue; }
      setDrafts((prev) => {
        const d = prev[taskId] ?? { body: "", attachments: [] };
        return { ...prev, [taskId]: { ...d, attachments: [...d.attachments, { id: localId(), name: f.name, kind: kindFromName(f.name), size: formatBytes(f.size), path: r.result.path as string }] } };
      });
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
    setNewError(null);
    for (const f of Array.from(files)) {
      const r = await uploadSharedFile(f, uploadApi(null));
      if (!r.ok) { setNewError(r.error); continue; }
      setNewAttachments((prev) => [...prev, { id: localId(), name: f.name, kind: kindFromName(f.name), size: formatBytes(f.size), path: r.result.path as string }]);
    }
    setNewUploading(false);
  };

  // 📝 Doc: the task's document opens in a new tab. The tab opens on the click,
  // so a popup blocker lets it through, then goes to the link.
  const openDoc = async (taskId: string, tabWin?: Window | null) => {
    const win = tabWin ?? window.open("about:blank", "_blank");
    setDocBusyId(taskId);
    try {
      const res = await fetch(`/api/waiting/${token}/doc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) { win?.close(); alert(j.error || "Couldn't open the doc. Try again."); return; }
      if (win) { win.opener = null; win.location.href = j.url; } else window.location.href = j.url;
      setTasks((list) => list?.map((t) => (t.id === taskId ? { ...t, hasDoc: true } : t)) ?? list);
    } finally { setDocBusyId(null); }
  };

  const submitNewRequest = async () => {
    setNewSaving(true);
    const docWin = newWithDoc ? window.open("about:blank", "_blank") : null;
    try {
      const res = await fetch(`/api/waiting/${token}/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newBody, attachments: newAttachments, projectId: effectiveNewProjectId, neededBy: newNeededBy || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { docWin?.close(); setNewError(j.error || "Couldn't send. Try again."); return; }
      if (newWithDoc && j.taskId) await openDoc(j.taskId as string, docWin);
      setNewError(null);
      setNewBody("");
      setNewNeededBy("");
      setNewWithDoc(false);
      setNewAttachments([]);
      setNewSent(true);
      setTimeout(() => setNewSent(false), 3000);
      await load();
    } finally {
      setNewSaving(false);
    }
  };

  const emptyState = (
    <div className="rounded-2xl border border-dashed bg-surface px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-[26px] text-success">✓</div>
      <h2 className="text-[18px] font-bold">You&apos;re all caught up</h2>
      <p className="mt-1 text-[16px] text-muted">Nothing needs your input right now. We&apos;ll email you the moment something does.</p>
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
    const note = dateNote(t);
    const status = isDone ? (
      <span className="text-[16px] text-muted">{note?.text ?? "Completed"}</span>
    ) : (
      <span className={`rounded-full px-2 py-0.5 text-[16px] font-semibold ${t.needsResponse ? "bg-highlight-soft text-highlight" : t.status === "on_hold" ? "bg-background text-muted" : "bg-accent-soft text-accent"}`}>
        {t.needsResponse ? "Needs your input" : t.status === "on_hold" ? "On hold" : "In progress"}
      </span>
    );
    return (
      <button
        key={t.id}
        onClick={() => openTask(t.id)}
        className="flex w-full items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left shadow-[var(--shadow-sm)] transition hover:bg-background"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: isDone ? "var(--success)" : t.needsResponse ? "var(--highlight)" : "var(--border)" }} />
        <div className="min-w-0 flex-1">
          {/* On a phone the status sits under the title and the text wraps: at
              16px, a status beside it cut the title down to "Approve ...". */}
          <div className={`break-words text-[17px] font-semibold sm:truncate ${isDone ? "text-muted line-through decoration-muted/40" : ""}`}>{t.title}</div>
          {preview && <div className="line-clamp-2 text-[16px] text-muted sm:line-clamp-none sm:truncate">{preview}</div>}
          {(t.hasDoc || (!isDone && note)) && (
            <div className="flex flex-wrap gap-x-3 text-[16px]">
              {!isDone && note && <span className={`font-semibold ${note.late ? "text-danger" : "text-highlight"}`}>{note.text}{note.late ? " · late" : ""}</span>}
              {t.hasDoc && <span className="font-semibold text-accent">📝 Has a doc</span>}
            </div>
          )}
          {showProject && projects.length > 1 && projectName(t.projectId) && (
            <div className="text-[16px] text-muted">{projectName(t.projectId)}</div>
          )}
          <div className="mt-1 sm:hidden">{status}</div>
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">{status}</div>
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
    <div className="min-h-screen bg-background">
      {selectedTask ? (
        <div style={{ background: "linear-gradient(135deg, #12283f, var(--accent))" }}>
          <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-3">
            <button onClick={closeTask} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/30 px-3 text-[16px] font-semibold text-white hover:bg-white/10">← All my tasks</button>
            {clientName && <span className="ml-auto truncate text-[16px] font-bold text-white">{clientName}</span>}
          </div>
        </div>
      ) : (
        // Everything that used to be the sidebar, compressed into one thin
        // strip instead of its own banner — brand, client, heading, and
        // progress all on a single line, with the privacy note folded in
        // underneath instead of repeated at the bottom of the page.
        <div style={{ background: "linear-gradient(135deg, #12283f, var(--accent))" }} className="px-6 py-3 text-center md:px-10">
          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[16px] font-bold tracking-tight text-white">
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
          onDoc={() => openDoc(selectedTask.id)}
          docBusy={docBusyId === selectedTask.id}
          otherWaiting={open.filter((o) => o.needsResponse && o.id !== selectedTask.id).map((o) => ({ id: o.id, title: o.title }))}
          onOpenTask={openTask}
          team={teamSenders}
          doneCount={doneCount}
          totalCount={totalCount}
        />
      ) : (
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-10 pt-5">
        {error ? (
          <div className="rounded-lg bg-danger-soft px-3 py-2 text-[16px] text-danger">{error}</div>
        ) : !tasks ? (
          <div className="py-8 text-center text-[16px] text-muted">Loading…</div>
        ) : (
            <div className="min-w-0">
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
                      <div className="text-[16px] font-bold">New task</div>
                      <div className="mt-0.5 text-[16px] text-muted">Tell us what you need and we&apos;ll take a look.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {projects.length > 1 && (
                        <select value={effectiveNewProjectId ?? ""} onChange={(e) => setNewProjectId(e.target.value)} title="Which list this goes on"
                          className="rounded-md border bg-background px-2 py-1 text-[16px] outline-none focus:border-accent">
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
                        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[16px]">
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
                      <button onClick={() => addLinkAttachment("__new__")} disabled={!linkUrl.trim()} className="rounded-md bg-accent px-2.5 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Add</button>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[16px] font-medium text-accent">
                        + Attach files
                        <input type="file" multiple className="hidden" onChange={(e) => { handleNewFiles(e.target.files); e.target.value = ""; }} />
                      </label>
                      <button onClick={() => { setLinkForId((id) => (id === "__new__" ? null : "__new__")); setLinkUrl(""); setLinkLabel(""); }} className="text-[16px] font-medium text-accent">+ Add link</button>
                    </div>
                    <button
                      onClick={submitNewRequest}
                      disabled={newSaving || newUploading || (!newBody.trim() && newAttachments.length === 0)}
                      className="rounded-md bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40"
                    >
                      {newSaving ? "Sending…" : newUploading ? "Uploading…" : "Send"}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-2">
                    <label className="flex items-center gap-2 text-[16px]">
                      <span className="text-muted">Needed by</span>
                      <input type="date" value={newNeededBy} min={todayKey()} onChange={(e) => setNewNeededBy(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-[16px] outline-none focus:border-accent" />
                      {newNeededBy ? <button onClick={() => setNewNeededBy("")} className="text-muted hover:text-foreground">No rush</button> : <span className="text-muted">(optional)</span>}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-[16px]">
                      <input type="checkbox" checked={newWithDoc} onChange={(e) => setNewWithDoc(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                      📝 Start a doc for it
                    </label>
                  </div>
                  {newError && <div className="mt-1.5 text-[16px] text-danger">{newError}</div>}
                  {newSent && <div className="mt-1.5 text-[16px] text-success">Sent, we&apos;ll take a look!</div>}
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-background py-2.5 text-[16px] font-bold text-accent transition hover:bg-surface"
                    style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, var(--border))" }}>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[11px] font-black leading-none text-white">+</span> New task
                  </button>
                  <p className="mt-1 text-center text-[16px] text-muted">One request per task, please. It&apos;s easier for us to track.</p>
                </div>
              ))}

              {/* The overview, then the lists as tabs (Derek, 2026-10-05, mockup
                  https://claude.ai/artifact/1QUx22d65Qwr7n2iSjpHSf): All shows a
                  box per list; a tab shows one. In each, what needs them first,
                  then what we're working on, then what's done, folded away. */}
              {(() => {
                const all = tasks ?? [];
                const needCount = all.filter((t) => t.status !== "done" && t.needsResponse).length;
                const progCount = all.filter((t) => t.status !== "done" && !t.needsResponse).length;
                const doneAll = all.filter((t) => t.status === "done").length;
                const pct = all.length ? Math.round((doneAll / all.length) * 100) : 0;
                const lists = [...projects.map((p) => ({ id: p.id as string | null, name: p.name })), ...(all.some((t) => !projects.some((p) => p.id === t.projectId)) ? [{ id: null, name: "Other" }] : [])];
                const inList = (id: string | null) => (t: WaitingTask) => (id ? t.projectId === id : !projects.some((p) => p.id === t.projectId));
                const shown = tab === "all" ? lists : lists.filter((l) => (l.id ?? "__other__") === tab);
                const box = (l: { id: string | null; name: string }, single: boolean) => {
                  const mine = all.filter(inList(l.id));
                  const need = mine.filter((t) => t.status !== "done" && t.needsResponse).sort(sortFn);
                  const prog = mine.filter((t) => t.status !== "done" && !t.needsResponse).sort(sortFn);
                  const done = mine.filter((t) => t.status === "done").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
                  const key = l.id ?? "__other__";
                  const open = doneOpenIds.has(key);
                  const p2 = mine.length ? Math.round((done.length / mine.length) * 100) : 0;
                  return (
                    <div key={key} ref={l.id ? (el) => { groupRefs.current[`req-${l.id}`] = el; } : undefined} className="overflow-hidden rounded-xl border bg-surface shadow-[var(--shadow-sm)]">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
                        <h2 className="text-[18px] font-bold">{single && lists.length === 1 ? "Your tasks" : l.name}</h2>
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border"><span className="block h-full bg-success" style={{ width: `${p2}%` }} /></span>
                        <span className="ml-auto text-[16px] text-muted">{need.length ? `${need.length} need${need.length === 1 ? "s" : ""} you · ` : ""}{done.length} of {mine.length} done</span>
                      </div>
                      <div className="space-y-2 p-3">
                        {need.length > 0 && <div className="px-1 pt-1 text-[14px] font-extrabold uppercase tracking-wider text-highlight">Needs you</div>}
                        {need.map((t) => renderTaskRow(t))}
                        {prog.length > 0 && <div className="px-1 pt-2 text-[14px] font-extrabold uppercase tracking-wider text-accent">In progress</div>}
                        {prog.map((t) => renderTaskRow(t))}
                        {!need.length && !prog.length && <div className="px-1 py-2 text-[16px] text-muted">Nothing open here right now.</div>}
                        {done.length > 0 && (
                          <button onClick={() => setDoneOpenIds((m) => { const n = new Set(m); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                            className="flex items-center gap-1.5 px-1 pt-1 text-[16px] font-semibold text-success hover:underline">
                            <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>›</span>{open ? "Hide" : "Show"} {done.length} done
                          </button>
                        )}
                        {open && done.map((t) => renderTaskRow(t))}
                      </div>
                    </div>
                  );
                };
                const showing = view ?? (needCount ? "theirs" : "all");
                const theirs = all.filter((t) => t.status !== "done" && t.needsResponse).sort(sortFn);
                const toggle = all.length > 0 && (
                  <div role="tablist" aria-label="Which tasks" className="grid grid-cols-2 gap-1 rounded-xl bg-border/60 p-1">
                    {([["theirs", "What we need from you", needCount], ["all", "All tasks", all.length]] as const).map(([k, label, n]) => (
                      <button key={k} role="tab" aria-selected={showing === k} onClick={() => setView(k)}
                        className={`flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-[16px] font-bold ${showing === k ? "bg-surface text-foreground shadow-[var(--shadow-sm)]" : "text-muted hover:text-foreground"}`}>
                        {label}<span className={`rounded-full px-2 text-[15px] ${k === "theirs" && n ? "bg-highlight text-white" : "bg-background text-muted"}`}>{n}</span>
                      </button>
                    ))}
                  </div>
                );
                if (showing === "theirs") return (
                  <div className="space-y-4">
                    {toggle}
                    <div className="overflow-hidden rounded-xl border bg-surface shadow-[var(--shadow-sm)]">
                      <div className="border-b px-4 py-3">
                        <h2 className="text-[18px] font-bold">{theirs.length ? `We need ${theirs.length === 1 ? "one thing" : `${theirs.length} things`} from you` : "Nothing needed from you right now"}</h2>
                        <p className="text-[16px] text-muted">{theirs.length ? "Open one to answer it or send what it asks for. The soonest is at the top." : "We'll let you know when we need something. Everything we're working on is under All tasks."}</p>
                      </div>
                      {theirs.length > 0 && <div className="space-y-2 p-3">{theirs.map((t) => renderTaskRow(t))}</div>}
                    </div>
                  </div>
                );
                return (
                  <div className="space-y-4">
                    {toggle}
                    <div className="grid gap-3 rounded-xl border bg-surface p-4 shadow-[var(--shadow-sm)]">
                      <div className="flex items-baseline justify-between gap-2"><b className="text-[18px]">{doneAll} of {all.length} done</b><span className="text-[16px] text-muted">{pct}%</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-border"><div className="h-full bg-success" style={{ width: `${pct}%` }} /></div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg bg-background px-3 py-2"><b className="block text-[22px] leading-tight text-highlight">{needCount}</b><span className="text-[16px] text-muted">Need you</span></div>
                        <div className="rounded-lg bg-background px-3 py-2"><b className="block text-[22px] leading-tight">{progCount}</b><span className="text-[16px] text-muted">In progress</span></div>
                        <div className="rounded-lg bg-background px-3 py-2"><b className="block text-[22px] leading-tight text-success">{doneAll}</b><span className="text-[16px] text-muted">Done</span></div>
                      </div>
                    </div>
                    {lists.length > 1 && (
                      <div className="flex gap-1 overflow-x-auto border-b">
                        {[{ key: "all", name: "All", count: all.length }, ...lists.map((l) => ({ key: l.id ?? "__other__", name: l.name, count: all.filter(inList(l.id)).length }))].map((x) => (
                          <button key={x.key} onClick={() => setTab(x.key)}
                            className={`shrink-0 border-b-2 px-3 py-2 text-[16px] font-semibold ${tab === x.key ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`}>
                            {x.name} <span className="font-normal text-muted">{x.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {all.length === 0 ? emptyState : shown.map((l) => box(l, tab !== "all"))}
                  </div>
                );
              })()}

              <p className="mt-6 text-center text-[16px] text-muted">This is a private link just for you. Please don&apos;t forward it.</p>
            </div>
        )}
      </div>
      )}
    </div>
  );
}

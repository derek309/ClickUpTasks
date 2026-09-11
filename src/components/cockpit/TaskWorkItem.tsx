"use client";

// A piece of work on a task with its own space: the client review document and
// the draft email. In the task it is one line, closed until someone opens it:
// Open shows it over the whole screen, the only view it has (Derek, 2026-09-11:
// "remove the show and hide feature and change full to just open we only need one
// screen").
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const quietButton = "rounded-lg border bg-surface px-3 py-1.5 text-[16px] font-medium text-muted transition hover:bg-background hover:text-foreground disabled:opacity-50";

export function WorkItemBadge({ label, chip, dot }: { label: string; chip: string; dot: string }) {
  return <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[16px] font-semibold" style={{ background: chip, color: dot }}>{label}</span>;
}

/** The line in the task. Clicking the name opens it too. */
export function WorkItemRow({ icon, title, badge, meta, actions, onOpen }: {
  icon: string;
  title: string;
  badge?: React.ReactNode;
  meta?: string;
  /** Quiet buttons before Open, like Copy link. */
  actions?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-surface px-4 py-3">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[22px]">{icon}</span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-[17px] font-semibold">{title}</span>
            {badge}
          </span>
          {meta && <span className="block truncate text-[16px] text-muted">{meta}</span>}
        </span>
      </button>
      <span className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
        <button onClick={onOpen} className="rounded-lg bg-accent px-5 py-1.5 text-[16px] font-semibold text-white">Open</button>
      </span>
    </div>
  );
}

/** The full screen window. Esc or Close shuts it; onClose should land any
 *  pending save first. */
export function WorkItemWindow({ icon, title, badge, status, actions, onClose, children }: {
  icon: string;
  /** Usually an input, so the name is edited where it is read. */
  title: React.ReactNode;
  badge?: React.ReactNode;
  status?: React.ReactNode;
  /** Buttons just before Close, like Copy link. */
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    // Capture phase, so Esc closes this window and not the task drawer under it.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; };
  }, []);

  // Portalled to the body so it covers the drawer and the app around it.
  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex flex-col bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-4 py-3 sm:px-8">
        <span aria-hidden className="text-[24px]">{icon}</span>
        <div className="min-w-0 flex-1">{title}</div>
        {badge}
        {status && <span className="text-[16px] text-muted">{status}</span>}
        {actions}
        <button onClick={onClose} className="rounded-lg border px-4 py-2 text-[16px] font-medium hover:bg-background">Close</button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-16 pt-6 sm:px-8">
        {/* 1280px, the width every ClickUpLocal page uses (Derek, 2026-09-11: "open up the full to 1280px"). */}
        <div className="mx-auto w-full max-w-[1280px]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export type ThreadComment = {
  id: string; body: string; authorLabel: string; fromClient: boolean; createdAt: string;
  editedAt?: string | null; completedAt?: string | null; completedBy?: string | null;
};
/** How many of the newest comments show before the rest fold away. */
const LATEST_COMMENTS = 3;

/** The comment thread on a client document, one thread the team and the client
 *  both see (Derek, 2026-09-11: "a chat box for comments"). Shown to the team in
 *  the document and to the client on their review page. Each comment has a tick
 *  box like a task, and its author can edit it ("edit, delete and mark a comment
 *  complete like a task"). */
export function CommentThread({ comments, onPost, when, viewer, buttonStyle, isMine, canDelete, onEdit, onDelete, onToggleDone }: {
  comments: ThreadComment[];
  /** Resolves true once the comment is in, which clears the box. */
  onPost: (body: string) => Promise<boolean>;
  when: (iso: string) => string;
  /** Which side is reading, to say who else sees the thread. */
  viewer: "team" | "client";
  buttonStyle?: React.CSSProperties;
  /** Whether the viewer wrote this comment: shaded, and theirs to edit. */
  isMine: (c: ThreadComment) => boolean;
  canDelete: (c: ThreadComment) => boolean;
  onEdit: (id: string, body: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onToggleDone: (id: string, done: boolean) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const act = async (id: string, work: () => Promise<boolean>) => {
    setBusyId(id);
    const ok = await work();
    setBusyId(null);
    return ok;
  };
  const saveEdit = async () => {
    if (!editing || !editing.text.trim()) return;
    if (await act(editing.id, () => onEdit(editing.id, editing.text.trim()))) setEditing(null);
  };
  const post = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    const ok = await onPost(body);
    setPosting(false);
    if (ok) setDraft("");
  };
  // Newest first, under the box you write in; past the latest few, the older ones
  // fold away behind a toggle (Derek, 2026-09-11: "as the comments get longer can
  // we toggle the older ones ... newest at the top").
  const newestFirst = [...comments].reverse();
  const older = Math.max(0, newestFirst.length - LATEST_COMMENTS);
  const shown = showOlder ? newestFirst : newestFirst.slice(0, LATEST_COMMENTS);
  return (
    <section className="rounded-xl border bg-surface px-4 py-3">
      <h3 className="text-[16px] font-semibold">Comments{comments.length ? ` · ${comments.length}` : ""}</h3>
      <p className="text-[16px] text-muted">{viewer === "team" ? "The client sees these on their review page." : "Your ClickUpLocal team sees these."}</p>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4000}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(); } }}
        placeholder="Write a comment…" aria-label="Write a comment"
        className="mt-2 w-full resize-y rounded-lg border bg-background px-3 py-2 text-[16px] outline-none focus:border-accent" />
      <div className="mt-2 flex items-center justify-end gap-3">
        <span className="hidden text-[16px] text-muted sm:inline">⌘ Enter posts it</span>
        <button onClick={() => void post()} disabled={posting || !draft.trim()} style={buttonStyle}
          className="rounded-lg bg-accent px-4 py-1.5 text-[16px] font-semibold text-white disabled:opacity-50">
          {posting ? "Posting…" : "Post comment"}
        </button>
      </div>
      {shown.length > 0 && (
        <ul className="mt-3 space-y-2">
          {shown.map((c) => {
            const mine = isMine(c);
            const done = !!c.completedAt;
            const busy = busyId === c.id;
            const isEditing = editing?.id === c.id;
            return (
              <li key={c.id} className={`flex gap-3 rounded-lg px-3 py-2 ${mine ? "bg-accent-soft/40" : "bg-background"}`}>
                <button role="checkbox" aria-checked={done} aria-label={done ? "Mark not done" : "Mark done"} title={done ? "Mark not done" : "Mark done"}
                  onClick={() => void act(c.id, () => onToggleDone(c.id, !done))} disabled={busy}
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[16px] leading-none disabled:opacity-50 ${done ? "border-accent bg-accent text-white" : "bg-surface hover:border-accent"}`}>
                  {done ? "✓" : ""}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[16px]">
                    <span className="font-semibold">{c.authorLabel || (c.fromClient ? "Client" : "Team")}</span>
                    <span className="text-muted">{when(c.createdAt)}{c.editedAt ? " · edited" : ""}</span>
                  </div>
                  {isEditing ? (
                    <>
                      <textarea value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} rows={3} maxLength={4000} autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveEdit(); }
                          if (e.key === "Escape") { e.stopPropagation(); setEditing(null); }
                        }}
                        aria-label="Edit comment"
                        className="mt-1 w-full resize-y rounded-lg border bg-surface px-3 py-2 text-[16px] outline-none focus:border-accent" />
                      <div className="mt-1 flex gap-4 text-[16px]">
                        <button onClick={() => void saveEdit()} disabled={busy || !editing.text.trim()} className="font-semibold text-accent hover:underline disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
                        <button onClick={() => setEditing(null)} className="text-muted hover:underline">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <p className={`whitespace-pre-wrap break-words text-[16px] leading-relaxed ${done ? "text-muted line-through" : ""}`}>{c.body}</p>
                  )}
                  {done && c.completedBy && <p className="text-[16px] text-muted">Done by {c.completedBy}</p>}
                  {!isEditing && (mine || canDelete(c)) && (
                    <div className="mt-1 flex gap-4 text-[16px]">
                      {mine && <button onClick={() => setEditing({ id: c.id, text: c.body })} className="text-muted hover:text-foreground hover:underline">Edit</button>}
                      {canDelete(c) && <button onClick={() => void act(c.id, () => onDelete(c.id))} disabled={busy} className="text-muted hover:text-danger hover:underline disabled:opacity-50">Delete</button>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {older > 0 && (
        <button onClick={() => setShowOlder((s) => !s)} aria-expanded={showOlder}
          className="mt-2 text-[16px] font-medium text-accent hover:underline">
          {showOlder ? "Hide older comments" : `Show ${older} older ${older === 1 ? "comment" : "comments"}`}
        </button>
      )}
    </section>
  );
}

export type PreviewImage = { id: string; name: string; url: string; downloadUrl?: string };

/** Image files as thumbnails; clicking one opens the lightbox at it. */
export function ImageThumbGrid({ images, onOpen }: { images: PreviewImage[]; onOpen: (index: number) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((img, i) => (
        <button key={img.id} onClick={() => onOpen(i)} title={img.name} aria-label={`Preview ${img.name}`}
          className="group h-24 w-24 overflow-hidden rounded-lg border bg-background transition hover:border-accent">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
        </button>
      ))}
    </div>
  );
}

/** A full screen preview of one image, with the others a click or an arrow key
 *  away (Derek, 2026-09-11: "show the images if they are added and open in light
 *  box if opened so we can preview"). */
export function ImageLightbox({ images, index, onIndex, onClose }: {
  images: PreviewImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const nav = useRef({ index, count: images.length, onIndex, onClose });
  useEffect(() => { nav.current = { index, count: images.length, onIndex, onClose }; });
  useEffect(() => {
    // On window in the capture phase, so it runs before the full screen window's
    // and the drawer's Esc handlers on document: Esc closes only the preview.
    const onKey = (e: KeyboardEvent) => {
      const n = nav.current;
      if (e.key === "Escape") { e.stopPropagation(); n.onClose(); }
      else if (e.key === "ArrowRight" && n.count > 1) { e.stopPropagation(); n.onIndex((n.index + 1) % n.count); }
      else if (e.key === "ArrowLeft" && n.count > 1) { e.stopPropagation(); n.onIndex((n.index - 1 + n.count) % n.count); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const img = images[index];
  if (!img) return null;
  const step = (delta: number) => (e: React.MouseEvent) => { e.stopPropagation(); onIndex((index + delta + images.length) % images.length); };
  const control = "rounded-lg border border-white/40 px-3 py-1.5 text-[16px] font-medium text-white hover:bg-white/10";
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={img.name} onClick={onClose} className="fixed inset-0 z-[110] flex flex-col bg-black/85">
      <div onClick={(e) => e.stopPropagation()} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-white">
          {img.name}{images.length > 1 ? ` · ${index + 1} of ${images.length}` : ""}
        </span>
        <a href={img.downloadUrl ?? img.url} target="_blank" rel="noopener noreferrer" className={control}>{img.downloadUrl ? "Download" : "Open original"}</a>
        <button onClick={onClose} className={control}>Close</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        {images.length > 1 && <button onClick={step(-1)} aria-label="Previous image" className="absolute left-3 rounded-full bg-white/15 px-4 py-2 text-[28px] text-white hover:bg-white/25">‹</button>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.name} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        {images.length > 1 && <button onClick={step(1)} aria-label="Next image" className="absolute right-3 rounded-full bg-white/15 px-4 py-2 text-[28px] text-white hover:bg-white/25">›</button>}
      </div>
    </div>,
    document.body,
  );
}

/** A small drop target with an Add button, for files. Drops stop here: the
 *  drawer around it would otherwise take them as task attachments, and React
 *  events cross the full window's portal. */
export function FileDropLine({ label, count, busy, disabled, onFiles, children }: {
  label: string;
  count: number;
  busy: boolean;
  disabled?: boolean;
  onFiles: (files: FileList) => void;
  /** The list of files, shown under the line when there are any. */
  children?: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) e.stopPropagation(); }}
      onDragOver={(e) => { if (!disabled && e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); e.currentTarget.dataset.drop = "1"; } }}
      onDragLeave={(e) => { delete e.currentTarget.dataset.drop; }}
      onDrop={(e) => {
        delete e.currentTarget.dataset.drop;
        if (!e.dataTransfer.files.length) return;
        e.preventDefault(); e.stopPropagation();
        if (!disabled) onFiles(e.dataTransfer.files);
      }}
      className="rounded-xl border border-dashed bg-surface px-4 py-2.5 data-[drop]:border-2 data-[drop]:border-accent data-[drop]:bg-accent-soft/30">
      <div className="flex flex-wrap items-center gap-2 text-[16px]">
        <span className="font-semibold">{label}{count ? ` · ${count}` : ""}</span>
        {!disabled && (
          <span className="ml-auto flex items-center gap-2 text-muted">
            {busy ? "Adding…" : <span className="hidden sm:inline">Drop files here or</span>}
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
            <button onClick={() => input.current?.click()} disabled={busy} className="rounded-lg border px-2.5 py-0.5 font-medium hover:bg-background hover:text-foreground disabled:opacity-50">+ Add</button>
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

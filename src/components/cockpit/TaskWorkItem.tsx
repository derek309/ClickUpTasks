"use client";

// A piece of work on a task with its own space: the client review document, the
// image review and the draft email. In the task it is one line, closed until
// someone opens it: Open shows it over the whole screen, the only view it has
// (Derek, 2026-09-11: "remove the show and hide feature and change full to just
// open we only need one screen").
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const quietButton = "rounded-lg border bg-surface px-3 py-1.5 text-[16px] font-medium text-muted transition hover:bg-background hover:text-foreground disabled:opacity-50";

export function WorkItemBadge({ label, chip, dot }: { label: string; chip: string; dot: string }) {
  return <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[16px] font-semibold" style={{ background: chip, color: dot }}>{label}</span>;
}

/** The line in the task. Clicking the name opens it too. */
// Each kind of line item has its own color so they read apart at a glance
// (Derek, 2026-09-11: "can we make them different colors").
const ROW_TONE = {
  doc: { box: "border-highlight/40 border-l-highlight bg-highlight-soft/60", tile: "bg-highlight-soft" },
  image: { box: "border-success/30 border-l-success bg-success-soft/60", tile: "bg-success-soft" },
  // Every soft color pair is taken, so the web page line is a neutral dark stripe.
  page: { box: "border-foreground/20 border-l-foreground bg-surface", tile: "bg-background" },
  email: { box: "border-accent/30 border-l-accent bg-accent-soft/60", tile: "bg-accent-soft" },
} as const;

export function WorkItemRow({ icon, title, badge, meta, actions, onOpen, tone }: {
  icon: string;
  title: string;
  badge?: React.ReactNode;
  meta?: string;
  /** Quiet buttons before Open, like Copy link. */
  actions?: React.ReactNode;
  onOpen: () => void;
  tone: keyof typeof ROW_TONE;
}) {
  const colors = ROW_TONE[tone];
  return (
    <div className={`mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-l-[6px] px-4 py-3 ${colors.box}`}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[22px] ${colors.tile}`}>{icon}</span>
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
  /** The words in the document this comment is about. */
  quote?: string | null;
  /** The numbered pin on an image or page version this comment is about; on a page,
   *  the element it sits on. */
  pin?: { fileId: string; x: number; y: number; number: number; anchor?: { node: number; nx: number; ny: number; width: number } | null } | null;
  /** A file added with the comment. */
  attachmentFileId?: string | null;
};
/** How many of the newest comments show before the rest fold away. */
const LATEST_COMMENTS = 3;

/** A pin's number in a circle, the same in the thread as on the image. */
function PinNumber({ number, color }: { number: number; color?: string }) {
  return (
    <span className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-accent px-2 text-[16px] font-bold leading-none text-white"
      style={color ? { background: color } : undefined}>{number}</span>
  );
}

/** The comment thread on a client document, one thread the team and the client
 *  both see (Derek, 2026-09-11: "a chat box for comments"). Shown to the team in
 *  the document and to the client on their review page. Each comment has a tick
 *  box like a task, and its author can edit it ("edit, delete and mark a comment
 *  complete like a task"). A comment can carry a file, and on an image review it
 *  can sit on a numbered pin (Derek, 2026-09-12). */
export function CommentThread({ comments, onPost, when, viewer, buttonStyle, isMine, canDelete, onEdit, onDelete, onToggleDone, quote, onClearQuote, focusedId, onQuoteClick, pinDraft, placeholder, onAttach, renderAttachment }: {
  comments: ThreadComment[];
  /** Resolves true once the comment is in, which clears the box. quote: the words
   *  it is about; attachmentFileId: a file added with it. */
  onPost: (body: string, quote?: string | null, attachmentFileId?: string | null) => Promise<boolean>;
  /** Words selected in the document for the next comment, shown above the box
   *  (Derek, 2026-09-12: comments on a specific sentence). */
  quote?: string | null;
  /** The number of a pin just dropped on the image for the next comment. */
  pinDraft?: number | null;
  /** Takes the words or the pin off the next comment. */
  onClearQuote?: () => void;
  /** A comment picked from its highlight or pin: shown and scrolled to. */
  focusedId?: string | null;
  /** Clicking a comment's quote or pin shows it in the document or on the image. */
  onQuoteClick?: (id: string) => void;
  /** What the empty box says. */
  placeholder?: string;
  /** Uploads a file for the next comment (Derek, 2026-09-12: "add a comment or upload a file"). */
  onAttach?: (file: File) => Promise<{ id: string; name: string } | null>;
  /** How a comment's file shows: something to click to open it. */
  renderAttachment?: (fileId: string) => React.ReactNode;
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
  const [attached, setAttached] = useState<{ id: string; name: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [showDone, setShowDone] = useState(false);
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
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  // Picking words in the document or a spot on the image puts the cursor in the box, ready to write.
  useEffect(() => { if (quote || pinDraft) boxRef.current?.focus(); }, [quote, pinDraft]);
  const post = async () => {
    const body = draft.trim();
    if ((!body && !attached) || posting) return;
    setPosting(true);
    const ok = await onPost(body, quote ?? null, attached?.id ?? null);
    setPosting(false);
    if (ok) { setDraft(""); setAttached(null); }
  };
  const attach = async (file: File | undefined) => {
    if (!file || !onAttach) return;
    setAttaching(true);
    const added = await onAttach(file);
    setAttaching(false);
    if (added) { setAttached(added); boxRef.current?.focus(); }
  };
  // Newest first, under the box you write in; past the latest few, the older ones
  // fold away behind a toggle (Derek, 2026-09-11: "as the comments get longer can
  // we toggle the older ones ... newest at the top").
  const newestFirst = [...comments].reverse();
  // Done comments fold away on their own, behind their own toggle (Derek,
  // 2026-09-11: "hide done comments?"); the latest few rule counts open ones.
  const openOnes = newestFirst.filter((c) => !c.completedAt);
  const doneOnes = newestFirst.filter((c) => !!c.completedAt);
  const older = Math.max(0, openOnes.length - LATEST_COMMENTS);
  const shown = [...(showOlder ? openOnes : openOnes.slice(0, LATEST_COMMENTS)), ...(showDone ? doneOnes : [])];
  // A highlight or pin clicked opens its comment wherever it is folded away.
  useEffect(() => {
    if (!focusedId) return;
    const target = comments.find((c) => c.id === focusedId);
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (target.completedAt) setShowDone(true);
    else if (openOnes.findIndex((c) => c.id === focusedId) >= LATEST_COMMENTS) setShowOlder(true);
    requestAnimationFrame(() => itemRefs.current.get(focusedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [focusedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinColor = buttonStyle?.background as string | undefined;
  return (
    <section className="rounded-xl border bg-surface px-4 py-3">
      <h3 className="text-[16px] font-semibold">Comments{comments.length ? ` · ${comments.length}` : ""}</h3>
      {viewer === "team" && <p className="text-[16px] text-muted">The client sees these on their review page.</p>}
      {(quote || pinDraft) && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border-l-4 border-highlight bg-highlight-soft/60 px-3 py-2 text-[16px]">
          <span className="flex min-w-0 flex-1 items-center gap-2 break-words">
            {pinDraft
              ? <><PinNumber number={pinDraft} color={pinColor} /><span className="text-muted">On this spot</span></>
              : <span><span className="text-muted">On </span>“{(quote ?? "").replace(/\n/g, " … ")}”</span>}
          </span>
          {onClearQuote && (
            <button onClick={onClearQuote} title={pinDraft ? "Take the pin off" : "Comment on the whole document instead"}
              aria-label={pinDraft ? "Take the pin off" : "Comment on the whole document instead"}
              className="shrink-0 px-1 text-[18px] leading-none text-muted hover:text-foreground">×</button>
          )}
        </div>
      )}
      <textarea ref={boxRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4000}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(); } }}
        placeholder={pinDraft ? "Write a comment on this spot…" : quote ? "Write a comment on these words…" : placeholder ?? "Write a comment, or select words in the document to comment on them…"}
        aria-label="Write a comment"
        className="mt-2 w-full resize-y rounded-lg border bg-background px-3 py-2 text-[16px] outline-none focus:border-accent" />
      {attached && (
        <div className="mt-1 flex items-center gap-2 text-[16px]">
          <span className="min-w-0 flex-1 truncate">📎 {attached.name}</span>
          <button onClick={() => setAttached(null)} title="Leave the file off this comment" aria-label="Leave the file off this comment"
            className="shrink-0 px-1 text-[18px] leading-none text-muted hover:text-foreground">×</button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
        {onAttach && (
          <>
            <input ref={fileInput} type="file" className="hidden" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
            <button onClick={() => fileInput.current?.click()} disabled={attaching || posting}
              className="mr-auto text-[16px] font-medium text-muted hover:text-foreground hover:underline disabled:opacity-50">
              {attaching ? "Adding the file…" : "📎 Attach a file"}
            </button>
          </>
        )}
        <span className="hidden text-[16px] text-muted sm:inline">⌘ Enter posts it</span>
        <button onClick={() => void post()} disabled={posting || attaching || (!draft.trim() && !attached)} style={buttonStyle}
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
              <li key={c.id} ref={(el) => { if (el) itemRefs.current.set(c.id, el); else itemRefs.current.delete(c.id); }}
                className={`flex gap-3 rounded-lg px-3 py-2 ${mine ? "bg-accent-soft/40" : "bg-background"} ${focusedId === c.id ? "ring-2 ring-highlight" : ""}`}>
                <button role="checkbox" aria-checked={done} aria-label={done ? "Mark not done" : "Mark done"} title={done ? "Mark not done" : "Mark done"}
                  onClick={() => void act(c.id, () => onToggleDone(c.id, !done))} disabled={busy}
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[16px] leading-none disabled:opacity-50 ${done ? "border-accent bg-accent text-white" : "bg-surface hover:border-accent"}`}>
                  {done ? "✓" : ""}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[16px]">
                    {c.pin && (
                      <button onClick={() => onQuoteClick?.(c.id)} disabled={!onQuoteClick} title={`Show pin ${c.pin.number} on the image`}
                        aria-label={`Show pin ${c.pin.number} on the image`} className={done ? "opacity-50" : ""}>
                        <PinNumber number={c.pin.number} color={pinColor} />
                      </button>
                    )}
                    <span className="font-semibold">{c.authorLabel || (c.fromClient ? "Client" : "Team")}</span>
                    <span className="text-muted">{when(c.createdAt)}{c.editedAt ? " · edited" : ""}</span>
                  </div>
                  {c.quote && (
                    <button onClick={() => onQuoteClick?.(c.id)} disabled={!onQuoteClick} title="Show these words in the document"
                      className="mt-1 block w-full rounded border-l-4 border-highlight bg-highlight-soft/50 px-2 py-1 text-left text-[16px] text-muted hover:text-foreground disabled:hover:text-muted">
                      “{c.quote.replace(/\n/g, " … ")}”
                    </button>
                  )}
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
                  ) : c.body && (
                    <p className={`whitespace-pre-wrap break-words text-[16px] leading-relaxed ${done ? "text-muted line-through" : ""}`}>{c.body}</p>
                  )}
                  {c.attachmentFileId && renderAttachment && <div className="mt-1 text-[16px]">{renderAttachment(c.attachmentFileId)}</div>}
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
      {(older > 0 || doneOnes.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {older > 0 && (
            <button onClick={() => setShowOlder((s) => !s)} aria-expanded={showOlder}
              className="text-[16px] font-medium text-accent hover:underline">
              {showOlder ? "Hide older comments" : `Show ${older} older ${older === 1 ? "comment" : "comments"}`}
            </button>
          )}
          {doneOnes.length > 0 && (
            <button onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}
              className="text-[16px] font-medium text-accent hover:underline">
              {showDone ? "Hide done" : `Show ${doneOnes.length} done`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Image review (Derek, 2026-09-12: "click on a spot ... to add a number then add
// a comment or upload a file"). Shared by the team's window and the client's page.

/** The comments to list beside an image: the general ones, and the pins on the image shown. */
export const commentsFor = <C extends ThreadComment>(comments: C[], fileId: string | null): C[] =>
  comments.filter((c) => !c.pin || c.pin.fileId === fileId);

/** The number the next pin on this image gets, as the server will give it. */
export const nextPin = (comments: ThreadComment[], fileId: string | null): number =>
  Math.max(0, ...comments.filter((c) => c.pin && c.pin.fileId === fileId).map((c) => c.pin!.number)) + 1;

/** One button per version of the image. Nothing when there is only one. */
export function ImageVersionPicker({ options, value, onChange }: {
  options: { fileId: string; label: string }[];
  value: string | null;
  onChange: (fileId: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div role="tablist" aria-label="Versions of the image" className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.fileId} role="tab" aria-selected={o.fileId === value} onClick={() => onChange(o.fileId)}
          className={`rounded-full border px-3 py-1 text-[16px] font-medium transition ${o.fileId === value ? "border-foreground bg-foreground text-background" : "bg-surface text-muted hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The image with its numbered pins. Clicking the image drops the next pin there
 *  when onPlace is given; clicking a pin picks its comment. Pins sit at a share of
 *  the image's width and height, so they stay put at any size. */
export function ImagePinBoard({ src, alt, comments, fileId, pending, activeId, onPlace, onPinClick, color }: {
  src: string;
  alt: string;
  comments: ThreadComment[];
  /** The image shown; only its pins are drawn. */
  fileId: string | null;
  /** The pin dropped for the comment being written. */
  pending?: { fileId: string; x: number; y: number; number: number } | null;
  activeId?: string | null;
  onPlace?: (spot: { x: number; y: number }) => void;
  onPinClick: (commentId: string) => void;
  /** The pin color: the client page's navy, else the app's accent. */
  color?: string;
}) {
  const place = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!onPlace) return;
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onPlace({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) });
  };
  const marker = "absolute flex h-9 min-w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white px-1 text-[16px] font-bold leading-none text-white shadow-lg";
  const pins = comments.filter((c) => c.pin && c.pin.fileId === fileId);
  return (
    <div className="relative mx-auto w-fit max-w-full select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onClick={place} draggable={false}
        className={`block h-auto max-w-full rounded-lg ${onPlace ? "cursor-crosshair" : ""}`} />
      {pins.map((c) => (
        <button key={c.id} onClick={() => onPinClick(c.id)} title={`Pin ${c.pin!.number}`} aria-label={`Pin ${c.pin!.number}`}
          className={`${marker} transition hover:scale-110 ${activeId === c.id ? "z-10 ring-4 ring-highlight" : ""} ${c.completedAt ? "opacity-60" : ""}`}
          style={{ left: `${c.pin!.x * 100}%`, top: `${c.pin!.y * 100}%`, background: c.completedAt ? "#6b7280" : color ?? "var(--accent)" }}>
          {c.pin!.number}
        </button>
      ))}
      {pending && pending.fileId === fileId && (
        <span aria-hidden className={`${marker} z-10 ring-4 ring-highlight`}
          style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%`, background: color ?? "var(--accent)" }}>
          {pending.number}
        </span>
      )}
    </div>
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

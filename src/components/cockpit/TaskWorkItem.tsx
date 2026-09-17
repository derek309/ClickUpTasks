"use client";

// A piece of work on a task with its own space: the client review document, the
// image review and the draft email. In the task it is one line, closed until
// someone opens it: Open shows it over the whole screen, the only view it has
// (Derek, 2026-09-11: "remove the show and hide feature and change full to just
// open we only need one screen").
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "./ui";
import { ActionMenu } from "./ActionMenu";
import { useEscapeToClose } from "./useEscapeToClose";

export const quietButton = "rounded-lg border bg-surface px-3 py-1.5 text-[16px] font-medium text-muted transition hover:bg-background hover:text-foreground disabled:opacity-50";

export function WorkItemBadge({ label, chip, dot }: { label: string; chip: string; dot: string }) {
  return <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[16px] font-semibold" style={{ background: chip, color: dot }}>{label}</span>;
}

/** The line in the task. Clicking the name opens it too. */
// Each kind of line item has its own color so they read apart at a glance
// (Derek, 2026-09-11: "can we make them different colors").
// The colour is the stripe and the icon tile; the line itself stays white, so a
// task with three of them reads as a list rather than a stack of coloured
// cards (2026-09-14 drawer redesign).
const ROW_TONE = {
  doc: { box: "border-l-highlight", tile: "bg-highlight-soft" },
  image: { box: "border-l-success", tile: "bg-success-soft" },
  // Every soft color pair is taken, so the web page line is a neutral dark stripe
  // and the video line the same neutral tile under a lighter grey one.
  page: { box: "border-l-foreground", tile: "bg-background" },
  video: { box: "border-l-muted", tile: "bg-background" },
  email: { box: "border-l-accent", tile: "bg-accent-soft" },
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
    <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-l-4 bg-surface px-4 py-3 ${colors.box}`}>
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
        {/* Quiet like its neighbours: the task's one filled button is Mark done on its next step. */}
        <button onClick={onOpen} className="rounded-lg border bg-surface px-5 py-1.5 text-[16px] font-semibold text-foreground transition hover:bg-background">Open</button>
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
  // Opened after the drawer, so Escape closes this window and leaves it be.
  useEscapeToClose(onClose);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
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
export function CommentThread({ comments, onPost, when, viewer, buttonStyle, isMine, canDelete, onEdit, onDelete, onToggleDone, quote, onClearQuote, focusedId, onQuoteClick, pinDraft, pinDraftLabel, pinLabel, pinGroups, alignGroup, pinTone, hoverId, onHover, placeholder, onAttach, renderAttachment }: {
  comments: ThreadComment[];
  /** Resolves true once the comment is in, which clears the box. quote: the words
   *  it is about; attachmentFileId: a file added with it. */
  onPost: (body: string, quote?: string | null, attachmentFileId?: string | null) => Promise<boolean>;
  /** Words selected in the document for the next comment, shown above the box
   *  (Derek, 2026-09-12: comments on a specific sentence). */
  quote?: string | null;
  /** The number of a pin just dropped on the image for the next comment. */
  pinDraft?: number | null;
  /** Which image that pin is on ("Back"), when the version shows several. */
  pinDraftLabel?: string | null;
  /** Which image a pin is on, when the version shows several (imageSet.ts); null for one. */
  pinLabel?: (fileId: string) => string | null;
  /** The images' names in order, to group the comments by image when there are several. */
  pinGroups?: string[];
  /** Where an image sits on the page, so its comments line up beside it (Derek,
   *  2026-09-14: "move the back comments down to align with that image"). */
  alignGroup?: (label: string) => HTMLElement | null;
  /** The pins' colour when it isn't the button colour (an image review's orange pins). */
  pinTone?: string;
  /** The comment whose pin the pointer is over, lit here too; onHover reports this side's. */
  hoverId?: string | null;
  onHover?: (id: string | null) => void;
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
  // A comment on the whole of a version with several images opens from a link.
  const [wholeOpen, setWholeOpen] = useState(false);
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
    if (ok) {
      setDraft("");
      setAttached(null);
      if (boxRef.current) boxRef.current.style.height = "auto";
    }
  };
  // The box is one line until the comment needs more.
  const fit = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };
  const initials = (c: ThreadComment) => (c.authorLabel || (c.fromClient ? "Client" : "Team"))
    .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
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
  // Grouped by image, every open comment shows in its image's box: folding the
  // older ones across boxes hid pin 1 on the Front (Derek, 2026-09-14).
  const grouping = !!pinGroups && pinGroups.length > 1;
  const older = grouping ? 0 : Math.max(0, openOnes.length - LATEST_COMMENTS);
  const shown = [...(showOlder || grouping ? openOnes : openOnes.slice(0, LATEST_COMMENTS)), ...(showDone ? doneOnes : [])];
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
  const pinColor = pinTone ?? (buttonStyle?.background as string | undefined);
  // On a version with several images, each image's comments sit in their own box
  // titled with its name, in the images' order and by pin number, then a box for
  // the ones on the whole version (Derek, 2026-09-14: "group the changes by image",
  // then "separate groups ... so it's clean and clear").
  const groupOf = (c: ThreadComment) => (c.pin && pinLabel ? pinLabel(c.pin.fileId) : null);
  const byPin = (a: ThreadComment, b: ThreadComment) => Number(!!a.completedAt) - Number(!!b.completedAt) || (a.pin?.number ?? 0) - (b.pin?.number ?? 0);
  const groups = grouping
    ? pinGroups!.map((label) => ({ label, items: shown.filter((c) => groupOf(c) === label).sort(byPin) }))
    : null;
  const wholeVersion = grouping ? shown.filter((c) => !groupOf(c)) : [];
  // The box for writing moves into an image's own box once a pin is dropped on it.
  const writeIn = grouping && pinDraft && pinDraftLabel ? pinDraftLabel : null;
  // Esc takes a dropped pin off before anything else hears it (the review window
  // closes on Esc from the document, so this listens on the window, first).
  useEscapeToClose(() => onClearQuote?.(), !!pinDraft && !!onClearQuote);

  // Each image's box starts level with its image when the two sit side by side (on a
  // phone the comments stack under the images, so nothing moves). Measured after
  // every render and whenever something on the page changes size, like an image loading.
  const groupBoxes = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!alignGroup || !groups?.length) return;
    const run = () => {
      const pairs = groups.map((g) => ({ box: groupBoxes.current.get(g.label), anchor: alignGroup(g.label) }));
      for (const { box } of pairs) if (box) box.style.marginTop = "";
      for (const { box, anchor } of pairs) {
        if (!box || !anchor) continue;
        const a = anchor.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (a.right > b.left + 1) continue;
        const gap = Math.round(a.top - b.top);
        // Stacked margins overlap rather than add, so the space already above the box
        // is the larger of its own top margin and the box before it's bottom margin.
        const prev = box.previousElementSibling;
        const above = Math.max(parseFloat(getComputedStyle(box).marginTop) || 0, prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0);
        if (gap > 0) box.style.marginTop = `${gap + above}px`;
      }
    };
    run();
    const watch = new ResizeObserver(run);
    watch.observe(document.body);
    for (const g of groups) { const a = alignGroup(g.label); if (a) watch.observe(a); }
    window.addEventListener("resize", run);
    return () => { watch.disconnect(); window.removeEventListener("resize", run); };
  });

  const canPost = !posting && !attaching && (!!draft.trim() || !!attached);
  const item = (c: ThreadComment, grouped: boolean) => {
    const mine = isMine(c);
    const done = !!c.completedAt;
    const busy = busyId === c.id;
    const isEditing = editing?.id === c.id;
    const place = c.pin && pinLabel ? pinLabel(c.pin.fileId) : null;
    const chip = place && !grouped;
    return (
      <li key={c.id} ref={(el) => { if (el) itemRefs.current.set(c.id, el); else itemRefs.current.delete(c.id); }}
        onMouseEnter={onHover && c.pin ? () => onHover(c.id) : undefined} onMouseLeave={onHover && c.pin ? () => onHover(null) : undefined}
        className={`-mx-2 flex gap-3 rounded-lg px-2 py-3 transition-colors ${focusedId === c.id ? "ring-2 ring-highlight" : ""} ${hoverId === c.id ? "bg-highlight-soft/60" : ""}`}>
        {c.pin ? (
          <button onClick={() => onQuoteClick?.(c.id)} disabled={!onQuoteClick} title={`Show pin ${c.pin.number}${place ? ` on ${place}` : ""}`}
            aria-label={`Show pin ${c.pin.number}${place ? ` on ${place}` : ""}`} className={`h-8 shrink-0 ${done ? "opacity-50" : ""}`}>
            <PinNumber number={c.pin.number} color={pinColor} />
          </button>
        ) : (
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-[16px] font-semibold text-muted">{initials(c)}</span>
        )}
        <div className="min-w-0 flex-1">
          {/* The name in full, then the comment, then a small time stamp (Derek,
              2026-09-14: the name was cut to "D…" beside the time). */}
          <div className="flex items-center gap-2 text-[16px]">
            <span className="min-w-0 break-words font-semibold">{c.authorLabel || (c.fromClient ? "Client" : "Team")}</span>
            {chip && <span className="shrink-0 rounded-full bg-background px-2 text-[16px] text-muted">{place}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {/* Said in words, so what it does is plain (Derek, 2026-09-14 redesign). */}
              <button aria-pressed={done} title={done ? "Open it again" : "Mark it resolved"}
                onClick={() => void act(c.id, () => onToggleDone(c.id, !done))} disabled={busy}
                className={`whitespace-nowrap rounded-full px-3 py-0.5 text-[16px] transition disabled:opacity-50 ${done ? "bg-success-soft font-semibold text-success" : "border text-muted hover:border-success hover:text-success"}`}>
                {done ? "Resolved ✓" : "Resolve"}
              </button>
              {!isEditing && (mine || canDelete(c)) && (
                <ActionMenu label={<I.dots />} title="More actions"
                  triggerClassName="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
                  items={[
                    mine && { label: "Edit", onClick: () => setEditing({ id: c.id, text: c.body }) },
                    canDelete(c) && { label: busy ? "Deleting…" : "Delete", danger: true, disabled: busy, onClick: () => void act(c.id, () => onDelete(c.id)) },
                  ]} />
              )}
            </span>
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
          {/* Very small on purpose (Derek, 2026-09-14), an exception to the 16px rule. */}
          <p className="mt-0.5 text-[13px] text-muted">{when(c.createdAt)}{c.editedAt ? " · edited" : ""}</p>
          {done && c.completedBy && <p className="text-[16px] text-muted">Done by {c.completedBy}</p>}
        </div>
      </li>
    );
  };
  // A quiet list: each comment's name with its check and a ⋯ menu
  // at the end of that line (Derek, 2026-09-13: "make the clean and more
  // professional looking"). Done ones fold away behind the header's toggle.
  const header = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[16px] font-semibold">Comments</h3>
        {comments.length > 0 && (
          <span className="rounded-full bg-background px-2.5 py-0.5 text-[16px] text-muted">{openOnes.length ? `${openOnes.length} open` : "All done"}</span>
        )}
        {viewer === "team" && (
          <span title="The client sees these on their review page" aria-label="The client sees these on their review page" className="inline-flex text-muted">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
          </span>
        )}
        {doneOnes.length > 0 && (
          <button onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}
            className="ml-auto text-[16px] font-medium text-muted hover:text-foreground hover:underline">
            {showDone ? "Hide done" : `Show done · ${doneOnes.length}`}
          </button>
        )}
      </div>
    </>
  );
  const composer = (
    <>
      {(quote || pinDraft) && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border-l-4 border-highlight bg-highlight-soft/60 px-3 py-2 text-[16px]">
          <span className="flex min-w-0 flex-1 items-center gap-2 break-words">
            {pinDraft
              ? <><PinNumber number={pinDraft} color={pinColor} /><span className="text-muted">On this spot{pinDraftLabel ? `, ${pinDraftLabel}` : ""}</span></>
              : <span><span className="text-muted">On </span>“{(quote ?? "").replace(/\n/g, " … ")}”</span>}
          </span>
          {onClearQuote && (
            <button onClick={onClearQuote} title={pinDraft ? "Take the pin off" : "Comment on the whole document instead"}
              aria-label={pinDraft ? "Take the pin off" : "Comment on the whole document instead"}
              className="shrink-0 px-1 text-[18px] leading-none text-muted hover:text-foreground">×</button>
          )}
        </div>
      )}
      <div className="mt-2 flex items-end gap-1 rounded-lg border bg-background py-1 pl-3 pr-1 focus-within:border-accent">
        <textarea ref={boxRef} value={draft} rows={2} maxLength={4000} data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
          onChange={(e) => { setDraft(e.target.value); fit(e.currentTarget); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(); } }}
          placeholder={pinDraft ? "Write a comment on this spot…" : quote ? "Write a comment on these words…" : placeholder ?? "Write a comment, or select words in the document to comment on them…"}
          aria-label="Write a comment" style={{ outline: "none" }}
          className="max-h-60 min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1.5 text-[16px] leading-snug outline-none" />
        {onAttach && (
          <>
            <input ref={fileInput} type="file" className="hidden" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
            <button onClick={() => fileInput.current?.click()} disabled={attaching || posting} title={attaching ? "Adding the file…" : "Attach a file"} aria-label="Attach a file"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground disabled:opacity-50">
              {attaching ? <span className="text-[16px]">…</span> : <I.clip />}
            </button>
          </>
        )}
        <button onClick={() => void post()} disabled={!canPost} title="Post comment (⌘ Enter)" aria-label="Post comment"
          style={canPost ? buttonStyle : undefined}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[18px] font-semibold transition ${canPost ? "bg-accent text-white" : "bg-surface text-muted"}`}>
          {posting ? "…" : "↑"}
        </button>
      </div>
      {attached && (
        <div className="mt-1 flex items-center gap-2 text-[16px]">
          <span className="min-w-0 flex-1 truncate">📎 {attached.name}</span>
          <button onClick={() => setAttached(null)} title="Leave the file off this comment" aria-label="Leave the file off this comment"
            className="shrink-0 px-1 text-[18px] leading-none text-muted hover:text-foreground">×</button>
        </div>
      )}
    </>
  );

  // The box for a pin just dropped on an image: roomy, with Post and Cancel said in
  // words, and Grammarly kept off it (its button sat on top of the old box).
  const writeBox = (
    <div className="overflow-hidden rounded-xl border border-highlight bg-surface shadow-[0_0_0_4px_var(--highlight-soft)] focus-within:shadow-[0_0_0_4px_var(--highlight-soft),0_0_0_5px_var(--highlight)]">
      <div className="flex items-center gap-2 px-3 pt-2.5 text-[16px] text-muted">
        {pinDraft && <PinNumber number={pinDraft} color={pinColor} />}
        <span className="min-w-0 flex-1">New comment on this spot</span>
      </div>
      <textarea ref={boxRef} value={draft} rows={3} maxLength={4000} data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(); } }}
        placeholder="What should change here?" aria-label="Write a comment on this spot" style={{ outline: "none" }}
        className="block w-full resize-y bg-transparent px-3 py-2 text-[16px] leading-snug" />
      {attached && (
        <div className="flex items-center gap-2 px-3 pb-1 text-[16px]">
          <span className="min-w-0 flex-1 truncate">📎 {attached.name}</span>
          <button onClick={() => setAttached(null)} title="Leave the file off this comment" aria-label="Leave the file off this comment"
            className="shrink-0 px-1 text-[18px] leading-none text-muted hover:text-foreground">×</button>
        </div>
      )}
      <div className="flex items-center gap-2 border-t px-2 py-2">
        {onAttach && (
          <>
            <input ref={fileInput} type="file" className="hidden" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
            <button onClick={() => fileInput.current?.click()} disabled={attaching || posting} title={attaching ? "Adding the file…" : "Attach a file"} aria-label="Attach a file"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-background hover:text-foreground disabled:opacity-50">
              {attaching ? <span className="text-[16px]">…</span> : <I.clip />}
            </button>
          </>
        )}
        {/* The ⌘ Enter hint lives in Post's tooltip: as text it wrapped onto two lines in a narrow card. */}
        {onClearQuote && <button onClick={onClearQuote} className="ml-auto rounded-lg px-3 py-1.5 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>}
        <button onClick={() => void post()} disabled={!canPost} style={canPost ? buttonStyle : undefined} title="Post (⌘ Enter)"
          className="rounded-lg bg-accent px-4 py-1.5 text-[16px] font-semibold text-white transition disabled:opacity-40">
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );

  if (groups) {
    // One card per image, level with it when side by side, joined by a rail so the
    // space between them reads as meant. The first card carries the thread's header
    // and the comments on the whole version (Derek, 2026-09-14 redesign).
    const railed = !!alignGroup;
    return (
      <div className={`relative space-y-3 ${railed ? "lg:pl-6" : ""}`}>
        {railed && <span aria-hidden className="absolute bottom-8 left-[5px] top-8 hidden w-0.5 rounded-full bg-border lg:block" />}
        {groups.map((g, gi) => {
          const open = g.items.filter((c) => !c.completedAt).length;
          return (
            <section key={g.label} aria-label={`Comments on ${g.label}`} className="relative rounded-xl border bg-surface shadow-sm"
              ref={(el) => { if (el) groupBoxes.current.set(g.label, el); else groupBoxes.current.delete(g.label); }}>
              {railed && <span aria-hidden className="absolute -left-6 top-5 hidden h-3 w-3 rounded-full border-2 border-border bg-background lg:block" />}
              {gi === 0 && (
                <div className="border-b px-4 py-3">
                  {header}
                  <p className="mt-1 text-[16px] text-muted">Click a spot on an image to comment on it.</p>
                  {wholeVersion.length > 0 && (
                    <div className="mt-2">
                      <h4 className="text-[16px] font-semibold text-muted">On the whole version</h4>
                      <ul className="divide-y">{wholeVersion.map((c) => item(c, true))}</ul>
                    </div>
                  )}
                  {!writeIn && (wholeOpen
                    ? composer
                    : <button onClick={() => setWholeOpen(true)} className="mt-1 text-[16px] font-medium text-accent hover:underline">Comment on the whole version</button>)}
                </div>
              )}
              <div className="flex items-center gap-2 px-4 pb-2 pt-3">
                <h4 className="min-w-0 break-words text-[16px] font-semibold">{g.label}</h4>
                {g.items.length > 0 && (
                  <span className={`ml-auto shrink-0 rounded-full px-2.5 text-[16px] tabular-nums ${open ? "bg-highlight-soft text-foreground" : "bg-success-soft text-success"}`}>
                    {open ? `${open} open` : "All resolved"}
                  </span>
                )}
              </div>
              {writeIn === g.label && <div className="px-4 pb-3">{writeBox}</div>}
              {g.items.length > 0
                ? <ul className="divide-y border-t px-4">{g.items.map((c) => item(c, true))}</ul>
                : writeIn !== g.label && <p className="border-t px-4 py-3 text-[16px] text-muted">No comments yet. Click the image to add one.</p>}
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <section className="rounded-xl border bg-surface px-4 py-3">
      {header}
      {composer}
      {shown.length > 0 && <ul className="mt-3 divide-y border-t">{shown.map((c) => item(c, false))}</ul>}
      {older > 0 && (
        <button onClick={() => setShowOlder((s) => !s)} aria-expanded={showOlder}
          className="mt-1 text-[16px] font-medium text-muted hover:text-foreground hover:underline">
          {showOlder ? "Hide older comments" : `Show ${older} older ${older === 1 ? "comment" : "comments"}`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Image review (Derek, 2026-09-12: "click on a spot ... to add a number then add
// a comment or upload a file"). Shared by the team's window and the client's page.

/** The comments to list beside an image: the general ones, and the pins on the image
 *  or images shown (a version can hold several, imageSet.ts). */
export const commentsFor = <C extends ThreadComment>(comments: C[], fileIds: string | string[] | null): C[] => {
  const ids = Array.isArray(fileIds) ? fileIds : fileIds ? [fileIds] : [];
  return comments.filter((c) => !c.pin || ids.includes(c.pin.fileId));
};

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
export function ImagePinBoard({ src, alt, comments, fileId, pending, activeId, hoverId, onPinHover, onPlace, onPinClick, color = "var(--highlight)" }: {
  src: string;
  alt: string;
  comments: ThreadComment[];
  /** The image shown; only its pins are drawn. */
  fileId: string | null;
  /** The pin dropped for the comment being written. */
  pending?: { fileId: string; x: number; y: number; number: number } | null;
  activeId?: string | null;
  /** The comment the pointer is over in the thread; its pin lights up. */
  hoverId?: string | null;
  onPinHover?: (commentId: string | null) => void;
  onPlace?: (spot: { x: number; y: number }) => void;
  onPinClick: (commentId: string) => void;
  /** The pin colour: the app's orange, which holds on dark artwork where navy vanished. */
  color?: string;
}) {
  const place = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!onPlace) return;
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onPlace({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) });
  };
  const marker = "absolute flex h-9 min-w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white px-1 text-[16px] font-bold leading-none text-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]";
  const pins = comments.filter((c) => c.pin && c.pin.fileId === fileId);
  return (
    <div className="relative mx-auto w-fit max-w-full select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onClick={place} draggable={false}
        className={`block h-auto max-w-full rounded-xl shadow-[0_1px_2px_rgba(20,24,40,0.06),0_10px_28px_rgba(20,24,40,0.14)] ${onPlace ? "cursor-crosshair" : ""}`} />
      {pins.map((c) => (
        <button key={c.id} onClick={() => onPinClick(c.id)} title={`Pin ${c.pin!.number}`} aria-label={`Pin ${c.pin!.number}`}
          onMouseEnter={onPinHover ? () => onPinHover(c.id) : undefined} onMouseLeave={onPinHover ? () => onPinHover(null) : undefined}
          className={`${marker} transition hover:scale-110 ${activeId === c.id || hoverId === c.id ? "z-10 scale-110 ring-4 ring-highlight/50" : ""} ${c.completedAt ? "opacity-60" : ""}`}
          style={{ left: `${c.pin!.x * 100}%`, top: `${c.pin!.y * 100}%`, background: c.completedAt ? "#6b7280" : color }}>
          {c.pin!.number}
        </button>
      ))}
      {pending && pending.fileId === fileId && (
        <span aria-hidden className={`${marker} z-10 bg-surface ring-4 ring-highlight/40`}
          style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%`, borderColor: color, color }}>
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
  // Escape goes through the shared stack (this preview is the last thing
  // opened, so it is the first thing closed); the arrows are its own.
  useEscapeToClose(() => nav.current.onClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = nav.current;
      if (e.key === "ArrowRight" && n.count > 1) { e.stopPropagation(); n.onIndex((n.index + 1) % n.count); }
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
export function FileDropLine({ label, count, busy, busyLabel, disabled, onFiles, children }: {
  label: string;
  count: number;
  busy: boolean;
  /** What to say while busy. A video upload puts how far it has got in here, so a
   *  file that takes minutes never reads as a hang. Default "Adding…". */
  busyLabel?: string;
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
            {busy ? busyLabel ?? "Adding…" : <span className="hidden sm:inline">Drop files here or</span>}
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
            <button onClick={() => input.current?.click()} disabled={busy} className="rounded-lg border px-2.5 py-0.5 font-medium hover:bg-background hover:text-foreground disabled:opacity-50">+ Add</button>
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

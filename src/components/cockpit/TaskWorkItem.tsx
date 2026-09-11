"use client";

// A piece of work on a task with its own space: the client review document and
// the draft email. In the task it is one line, closed until someone opens it:
// Show opens it in place, Open full opens it over the whole screen (Derek,
// 2026-09-11: "toggle this close by default ... Make it a line item with buttons
// to toggle open or full window open", then "I like the show and hide just add
// open full").
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export const quietButton = "rounded-lg border bg-surface px-3 py-1.5 text-[16px] font-medium text-muted transition hover:bg-background hover:text-foreground disabled:opacity-50";

export function WorkItemBadge({ label, chip, dot }: { label: string; chip: string; dot: string }) {
  return <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[16px] font-semibold" style={{ background: chip, color: dot }}>{label}</span>;
}

/** The line in the task. Clicking the name toggles it like Show and Hide. */
export function WorkItemRow({ icon, title, badge, meta, actions, shown, onToggle, onOpenFull }: {
  icon: string;
  title: string;
  badge?: React.ReactNode;
  meta?: string;
  /** Quiet buttons before Show, like Copy link. */
  actions?: React.ReactNode;
  shown: boolean;
  onToggle: () => void;
  onOpenFull: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-surface px-4 py-3">
      <button onClick={onToggle} aria-expanded={shown} className="flex min-w-0 flex-1 items-center gap-3 text-left">
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
        <button onClick={onToggle} aria-expanded={shown} className={quietButton}>{shown ? "Hide" : "Show"}</button>
        <button onClick={onOpenFull} className="rounded-lg bg-accent px-4 py-1.5 text-[16px] font-semibold text-white">Open full</button>
      </span>
    </div>
  );
}

/** The work shown in place, under its line. */
export function WorkItemInline({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 rounded-xl border bg-surface p-4 sm:p-6">{children}</div>;
}

/** The full screen window. Esc or Close shuts it; onClose should land any
 *  pending save first. */
export function WorkItemWindow({ icon, title, badge, status, onClose, children }: {
  icon: string;
  /** Usually an input, so the name is edited where it is read. */
  title: React.ReactNode;
  badge?: React.ReactNode;
  status?: React.ReactNode;
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

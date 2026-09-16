"use client";

// An HTML review version's pages under one toolbar, one tab per page, each in its
// own sandboxed frame with its own pins and rewording. Shared by the team's window
// and the client's review page, like PageReviewFrame.
//
// Derek, 2026-09-16: "one Deliverable for HTML and then inside there two separate
// HTML blocks, for example two different emails, and be able to comment and copy
// code", then "use tabs": two emails read as two emails, not one long page. A
// version with one page has no tabs, so every HTML review goes through here and
// there is one way pages are shown.
//
// Only the page on show has a frame. Each page's frame address is short lived and
// fetched when its tab is first opened, again when it expires or the page navigates
// itself somewhere. A pin to bring into view opens the tab that holds it.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FrameMode, FramePin, PageEdit } from "@/lib/pageFrameProtocol";
import { PageReviewFrame, PageReviewToolbar, type PageDevice, type PagePlace } from "./PageReviewFrame";

export type StackPage = { fileId: string; label: string };

export function PageReviewStack({
  pages, loadFrame, onLoadError, reloadKey, mode, onMode, device, onDevice, canEdit, canComment, pinsFor, pending, focus, edits,
  onPlace, onPinClick, onEdit, header, actions, color,
}: {
  pages: StackPage[];
  /** A fresh frame address for one page, or null when it could not be had. */
  loadFrame: (fileId: string) => Promise<string | null>;
  /** Said once when a page could not be shown. */
  onLoadError?: () => void;
  /** Changes to load every page again, like after undoing rewording. */
  reloadKey?: number;
  mode: FrameMode;
  onMode: (mode: FrameMode) => void;
  device: PageDevice;
  onDevice: (device: PageDevice) => void;
  canEdit: boolean;
  canComment: boolean;
  /** The pins that belong on one page. */
  pinsFor: (fileId: string) => FramePin[];
  /** The pin dropped for the next comment, on whichever page it was dropped. */
  pending: (PagePlace & { fileId: string; number: number }) | null;
  /** A pin to bring into view; n changes to ask again for the same pin. */
  focus: { id: string; n: number } | null;
  /** Rewording not saved yet, page by page. */
  edits: Record<string, PageEdit[]>;
  onPlace: (fileId: string, place: PagePlace) => void;
  onPinClick: (id: string) => void;
  onEdit: (fileId: string, edit: PageEdit) => void;
  /** What sits above the page on show: on the team's side its name and menu. */
  header?: (page: StackPage, index: number) => ReactNode;
  /** Buttons at the right end of the toolbar. */
  actions?: ReactNode;
  /** The client page's navy for the chosen toolbar buttons and tab. */
  color?: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // The tab by place, so replacing or rewording a page (a new file) keeps it open.
  const [picked, setPicked] = useState(0);
  const index = Math.min(picked, Math.max(0, pages.length - 1));
  const page = pages[index] as StackPage | undefined;
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Every page loads again when asked.
  const seenReload = useRef(reloadKey);
  useEffect(() => {
    if (seenReload.current === reloadKey) return;
    seenReload.current = reloadKey;
    setUrls({});
  }, [reloadKey]);

  // The page on show gets an address when it has none. A page asked to reload drops
  // its address first, which brings it back through here.
  const shownId = page?.fileId;
  useEffect(() => {
    if (!shownId || urls[shownId]) return;
    let cancelled = false;
    void loadFrame(shownId).then((url) => {
      if (cancelled) return;
      if (url) setUrls((u) => ({ ...u, [shownId]: url }));
      else onLoadError?.();
    });
    return () => { cancelled = true; };
  }, [shownId, urls]); // eslint-disable-line react-hooks/exhaustive-deps

  // A pin picked in the thread opens the tab it is on.
  useEffect(() => {
    if (!focus) return;
    const at = pages.findIndex((p) => pinsFor(p.fileId).some((pin) => pin.id === focus.id));
    if (at >= 0 && at !== index) setPicked(at); // eslint-disable-line react-hooks/set-state-in-effect
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = (fileId: string) => setUrls((u) => {
    const next = { ...u };
    delete next[fileId];
    return next;
  });

  // Arrow keys move between tabs, the way a tab list works everywhere else.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? pages.length - 1 : by ? (index + by + pages.length) % pages.length : -1;
    if (to < 0) return;
    e.preventDefault();
    setPicked(to);
    tabs.current[to]?.focus();
  };

  if (!page) return null;
  const pins = pinsFor(page.fileId);
  const several = pages.length > 1;
  return (
    <div className="w-full">
      <PageReviewToolbar mode={mode} onMode={onMode} device={device} onDevice={onDevice}
        canEdit={canEdit} canComment={canComment} actions={actions} color={color} />
      {several && (
        // Scrolls sideways on a phone instead of wrapping into a pile of names.
        <div role="tablist" aria-label="Pages" className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
          {pages.map((p, i) => {
            const selected = i === index;
            const open = pinsFor(p.fileId).filter((pin) => !pin.done).length;
            const unsaved = (edits[p.fileId]?.length ?? 0) > 0;
            return (
              <button key={p.fileId} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`page-tab-${p.fileId}`}
                aria-selected={selected} aria-controls={`page-panel-${p.fileId}`} tabIndex={selected ? 0 : -1}
                onClick={() => setPicked(i)} onKeyDown={onTabKey}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[16px] font-semibold transition ${selected ? "text-white shadow-sm" : "bg-surface text-foreground ring-1 ring-border hover:bg-background"}`}
                style={selected ? { background: color ?? "var(--accent)" } : undefined}>
                {p.label}
                {open > 0 && (
                  <span className={`rounded-full px-1.5 text-[16px] leading-6 ${selected ? "bg-white/20" : "bg-background text-muted"}`}
                    aria-label={`${open} open ${open === 1 ? "pin" : "pins"}`}>{open}</span>
                )}
                {unsaved && <span aria-label="Text changes not saved" title="Text changes not saved" className="h-2 w-2 rounded-full bg-highlight" />}
              </button>
            );
          })}
        </div>
      )}
      <section key={page.fileId} {...(several ? { role: "tabpanel", id: `page-panel-${page.fileId}`, "aria-labelledby": `page-tab-${page.fileId}` } : { "aria-label": page.label })}
        data-page-anchor={page.fileId} className="group">
        {header?.(page, index)}
        <PageReviewFrame
          title={several ? page.label : undefined}
          frameUrl={urls[page.fileId] ?? null}
          onReload={() => reload(page.fileId)}
          mode={mode} device={device} canEdit={canEdit} canComment={canComment}
          pins={pins}
          pending={pending && pending.fileId === page.fileId ? pending : null}
          focus={focus && pins.some((p) => p.id === focus.id) ? focus : null}
          edits={edits[page.fileId] ?? []}
          onPlace={(place) => onPlace(page.fileId, place)}
          onPinClick={onPinClick}
          onEdit={(edit) => onEdit(page.fileId, edit)} />
      </section>
    </div>
  );
}

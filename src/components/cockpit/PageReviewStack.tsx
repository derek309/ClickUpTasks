"use client";

// An HTML review version's pages, stacked under one toolbar, each in its own
// sandboxed frame with its own pins and rewording. Shared by the team's window and
// the client's review page, like PageReviewFrame.
//
// Derek, 2026-09-16: "one Deliverable for HTML and then inside there two separate
// HTML blocks, for example two different emails, and be able to comment and copy
// code". Stacked, not tabs (Derek, 2026-09-16: tabs hid the second email, "the
// client will not see them"). A version with one page is a stack of one, so every HTML review goes
// through here and there is one way pages are shown.
//
// Each page's frame address is short lived and fetched here, one per page, again
// when it expires or the page navigates itself somewhere. A pin to bring into view
// goes only to the frame that holds it.
import { useEffect, useState, type ReactNode } from "react";
import type { FrameMode, FramePin, PageEdit } from "@/lib/pageFrameProtocol";
import { PageReviewFrame, PageReviewToolbar, type PageDevice, type PagePlace } from "./PageReviewFrame";

export type StackPage = { fileId: string; label: string };

export function PageReviewStack({
  pages, loadFrame, onLoadError, mode, onMode, device, onDevice, canEdit, canComment, pinsFor, pending, focus, edits,
  onPlace, onPinClick, onEdit, header, actions, color,
}: {
  pages: StackPage[];
  /** A fresh frame address for one page, or null when it could not be had. */
  loadFrame: (fileId: string) => Promise<string | null>;
  /** Said once when a page could not be shown. */
  onLoadError?: () => void;
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
  /** What sits above one page: its name, and on the team's side its menu. Without it
   *  the name shows as a heading when there are several pages. */
  header?: (page: StackPage, index: number) => ReactNode;
  /** Buttons at the right end of the toolbar. */
  actions?: ReactNode;
  /** The client page's navy for the chosen toolbar buttons. */
  color?: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const ids = pages.map((p) => p.fileId).join("|");

  // Fetch an address for every page that has none. A page asked to reload drops its
  // address first, which brings it back through here.
  useEffect(() => {
    const missing = pages.map((p) => p.fileId).filter((id) => !urls[id]);
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async (id) => [id, await loadFrame(id)] as const)).then((pairs) => {
      if (cancelled) return;
      const got = pairs.filter((pair): pair is readonly [string, string] => !!pair[1]);
      if (got.length) setUrls((u) => ({ ...u, ...Object.fromEntries(got) }));
      if (got.length < pairs.length) onLoadError?.();
    });
    return () => { cancelled = true; };
  }, [ids, urls]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = (fileId: string) => setUrls((u) => {
    const next = { ...u };
    delete next[fileId];
    return next;
  });

  return (
    <div className="w-full">
      <PageReviewToolbar mode={mode} onMode={onMode} device={device} onDevice={onDevice}
        canEdit={canEdit} canComment={canComment} actions={actions} color={color} />
      <div className="space-y-8">
        {pages.map((page, i) => {
          const pins = pinsFor(page.fileId);
          return (
            <section key={page.fileId} aria-label={page.label} data-page-anchor={page.fileId} className="group">
              {header ? header(page, i) : pages.length > 1 && <h2 className="mb-2 text-[18px] font-semibold">{page.label}</h2>}
              <PageReviewFrame
                title={pages.length > 1 ? page.label : undefined}
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
          );
        })}
      </div>
    </div>
  );
}

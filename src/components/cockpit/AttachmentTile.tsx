"use client";

// Shared gallery grid-cell — one square tile per attachment, used by both
// the task drawer's Attachments panel and the Vault. Images render an eager
// thumbnail (caller resolves+passes the signed URL); every other kind falls
// back to a centered FileBadge icon, so a grid of tiles reads consistently
// regardless of mixed file types instead of image-only sections having a
// gallery and everything else staying a plain row list.
import { type ReactNode } from "react";
import { type Attachment } from "@/lib/data";
import { FileBadge } from "./ui";

export function AttachmentTile({ item, url, href, onOpen, small, overlayCaption, actions, drag }: {
  item: Attachment;
  /** Resolved thumbnail URL for kind==="image"; omit to show the FileBadge fallback. */
  url?: string;
  /** If set, the tile renders as a real <a> (link kind) instead of a <button> — preserves right-click/cmd-click "open in new tab". */
  href?: string;
  /** Click handler when not rendered as a link (e.g. open preview, download). */
  onOpen?: () => void;
  small?: boolean;
  /** Bottom gradient caption shown on hover, images only. */
  overlayCaption?: string;
  /** Hover-revealed action buttons, top-right corner. */
  actions?: ReactNode;
  /** Drag-to-reorder wiring — same splice-before-target idiom as FolderRail/ClientLinks. Omit to disable dragging on this tile. */
  drag?: { dragging: boolean; onDragStart: () => void; onDrop: () => void };
}) {
  const isImage = item.kind === "image" && !!url;
  const body = (
    <>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed-URL thumbnail, not a next/image-friendly static asset.
        <img src={url} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
      ) : (
        <span className="flex h-full w-full items-center justify-center"><FileBadge kind={item.kind} /></span>
      )}
      {isImage && !small && overlayCaption && (
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[12px] text-white opacity-0 transition group-hover:opacity-100">{overlayCaption}</span>
      )}
    </>
  );
  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-lg border bg-surface ${small ? "opacity-80 hover:opacity-100" : ""} ${drag?.dragging ? "opacity-40" : ""}`}
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
      onDrop={drag ? (e) => { e.preventDefault(); e.stopPropagation(); drag.onDrop(); } : undefined}
    >
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={item.name} className="block h-full w-full">{body}</a>
      ) : (
        <button onClick={onOpen} title={item.name} className="block h-full w-full" disabled={!onOpen}>{body}</button>
      )}
      {actions && (
        <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">{actions}</div>
      )}
    </div>
  );
}

"use client";

// Small attachment chip row, shared by Chat messages and task comments —
// used both for the staging area above a composer (with a remove button)
// and for attachments already on a sent message/comment (click to open).
// Storage is a private bucket (signed URLs only), so these render as
// FileBadge + name chips rather than eager <img> thumbnails, matching the
// existing task-attachments list's click-to-open pattern.
import { type Attachment } from "@/lib/data";
import { I, FileBadge } from "./ui";

export function AttachmentThumbs({ items, onRemove, onOpen }: {
  items: Attachment[];
  onRemove?: (id: string) => void;
  onOpen?: (path: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1">
          <FileBadge kind={a.kind} />
          {onOpen && a.path ? (
            <button onClick={() => onOpen(a.path!)} className="max-w-[140px] truncate text-[13px] text-accent hover:underline">{a.name}</button>
          ) : a.url ? (
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="max-w-[140px] truncate text-[13px] text-accent hover:underline">{a.name}</a>
          ) : (
            <span className="max-w-[140px] truncate text-[13px]">{a.name}</span>
          )}
          {onRemove && (
            <button onClick={() => onRemove(a.id)} title="Remove" className="text-muted hover:text-danger"><I.close className="h-3 w-3" /></button>
          )}
        </span>
      ))}
    </div>
  );
}

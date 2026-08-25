"use client";

// Small attachment chip row, shared by Chat messages and task comments —
// used both for the staging area above a composer (with a remove button)
// and for attachments already on a sent message/comment (click to open).
// Storage is a private bucket (signed URLs only), so these render as
// FileBadge + name chips rather than eager <img> thumbnails, matching the
// existing task-attachments list's click-to-open pattern.
import { useState } from "react";
import { type Attachment, type VaultFolder } from "@/lib/data";
import { I, FileBadge } from "./ui";

export function AttachmentThumbs({ items, onRemove, onOpen, folders, onSetFolder }: {
  items: Attachment[];
  onRemove?: (id: string) => void;
  onOpen?: (path: string) => void;
  /** Vault→Journal merge: pass both to let each chip be filed into a folder. */
  folders?: VaultFolder[];
  onSetFolder?: (attachmentId: string, folderId: string | null) => void;
}) {
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
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
          {folders && onSetFolder && (
            <span className="relative">
              <button onClick={() => setOpenFolderMenuId((id) => (id === a.id ? null : a.id))} title="File into a folder" className="text-muted hover:text-foreground"><I.folder className="h-3 w-3" /></button>
              {openFolderMenuId === a.id && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setOpenFolderMenuId(null)} />
                  <div className="absolute left-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border bg-surface py-1 shadow-lg">
                    <button onClick={() => { onSetFolder(a.id, null); setOpenFolderMenuId(null); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-background ${!a.folderId ? "text-accent" : ""}`}>{!a.folderId && <I.check className="h-3 w-3" />} Unfiled</button>
                    {folders.length > 0 && <div className="my-1 border-t" />}
                    {folders.map((f) => (
                      <button key={f.id} onClick={() => { onSetFolder(a.id, f.id); setOpenFolderMenuId(null); }} className={`flex w-full items-center gap-2 truncate px-3 py-1.5 text-left text-[13px] hover:bg-background ${a.folderId === f.id ? "text-accent" : ""}`}>{a.folderId === f.id && <I.check className="h-3 w-3 shrink-0" />} <span className="truncate">{f.name}</span></button>
                    ))}
                  </div>
                </>
              )}
            </span>
          )}
          {onRemove && (
            <button onClick={() => onRemove(a.id)} title="Remove" className="text-muted hover:text-danger"><I.close className="h-3 w-3" /></button>
          )}
        </span>
      ))}
    </div>
  );
}

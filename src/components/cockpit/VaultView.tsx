"use client";

// The Vault tab on a client or project — every attachment from anywhere in
// scope (task attachments, task comment images, Chat message images)
// collected into one place. Images render as an actual photo gallery
// (Derek's ask: "kind of turn it into a gallery") split into two tiers —
// real photos shown large and prominent, screenshots shown small and
// collapsed by default since they're the "lowest quality" of the bunch.
// Everything else (PDFs/docs/sheets/links) stays the plain row list below.
// Folders are a pure organizational overlay — filing an item into a folder
// never moves the underlying file, just tags it (see Attachment.folderId).
import { useEffect, useState } from "react";
import { type Attachment, type VaultFolder } from "@/lib/data";
import { I, FileBadge } from "./ui";

export type VaultItem = Attachment & { sourceLabel: string; onOpenSource: () => void; onSetFolder: (folderId: string | null) => void };

const OTHER_KIND_ORDER: Attachment["kind"][] = ["pdf", "doc", "sheet", "link"];
const KIND_LABEL: Record<Attachment["kind"], string> = { image: "Images", pdf: "PDFs", doc: "Docs", sheet: "Sheets", link: "Links" };

// The Attachment type carries no dimensions/EXIF/upload-source — filename
// is the only signal available to tell a screenshot from a real photo.
// Matches the default names macOS/Windows screenshot tools produce.
const SCREENSHOT_RE = /^(screenshot|screen shot|cleanshot|snip)/i;

export function VaultView({ items, folders, onDownloadFile, onGetSignedUrl, onCopyLink, onCopyFolderLink, onCreateFolder, onRenameFolder, onDeleteFolder, initialFolderId }: {
  items: VaultItem[];
  folders: VaultFolder[];
  onDownloadFile: (path: string) => void;
  onGetSignedUrl: (path: string) => Promise<string | null>;
  onCopyLink: (path: string) => void;
  onCopyFolderLink: (folderId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  /** From a deep link's ?folder= param — read once as the initial selection
   * only, not a live-controlled prop (this component owns folder browsing
   * after that). */
  initialFolderId?: string | null;
}) {
  const [selectedFolder, setSelectedFolder] = useState<string | "unfiled" | null>(initialFolderId ?? null);
  const displayed = selectedFolder === null ? items : selectedFolder === "unfiled" ? items.filter((a) => !a.folderId) : items.filter((a) => a.folderId === selectedFolder);

  const images = displayed.filter((a) => a.kind === "image");
  const photos = images.filter((a) => !SCREENSHOT_RE.test(a.name));
  const screenshots = images.filter((a) => SCREENSHOT_RE.test(a.name));
  const otherGroups = OTHER_KIND_ORDER.map((k) => ({ kind: k, label: KIND_LABEL[k], items: displayed.filter((a) => a.kind === k) })).filter((g) => g.items.length > 0);

  // Signed URLs are private-bucket, short-lived, and normally fetched one at
  // a time on click (TaskDrawer's preview, downloadFile) — a gallery grid
  // needs many at once, so batch-fetch every visible image's URL in
  // parallel on mount/whenever the item set changes. 1hr expiry (matching
  // the existing "durable enough to browse a while" precedent at
  // Cockpit.tsx's message-attachment forwarding) so it doesn't expire
  // mid-scroll.
  const imagePaths = images.map((a) => a.path).filter((p): p is string => !!p).join(",");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const paths = imagePaths ? imagePaths.split(",") : [];
    if (paths.length === 0) return;
    Promise.all(paths.map(async (p) => [p, await onGetSignedUrl(p)] as const)).then((pairs) => {
      if (cancelled) return;
      setUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(([, u]) => u).map(([p, u]) => [p, u as string])) }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePaths]);

  const [screenshotsOpen, setScreenshotsOpen] = useState(false);
  const [preview, setPreview] = useState<VaultItem | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const submitNewFolder = () => {
    if (newFolderName.trim()) onCreateFolder(newFolderName.trim());
    setNewFolderName("");
    setAddingFolder(false);
  };
  const submitRename = (folderId: string) => {
    if (renameValue.trim()) onRenameFolder(folderId, renameValue.trim());
    setRenamingFolder(null);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background px-4 py-4 sm:px-5">
      <div className="mx-auto w-full max-w-5xl">
        {/* Folder rail */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setSelectedFolder(null)} className={`rounded-full border px-3 py-1 text-[13px] font-medium ${selectedFolder === null ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-surface"}`}>All · {items.length}</button>
          {folders.map((f) => {
            const count = items.filter((a) => a.folderId === f.id).length;
            const active = selectedFolder === f.id;
            return renamingFolder === f.id ? (
              <input key={f.id} autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitRename(f.id); if (e.key === "Escape") setRenamingFolder(null); }}
                onBlur={() => submitRename(f.id)}
                className="w-32 rounded-full border border-accent bg-surface px-3 py-1 text-[13px] outline-none" />
            ) : (
              <div key={f.id} className={`group/folder inline-flex items-center gap-1 rounded-full border pl-3 pr-1.5 py-1 text-[13px] font-medium ${active ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-surface"}`}>
                <button onClick={() => setSelectedFolder(f.id)} title={f.name}>{f.name} · {count}</button>
                <span className="hidden items-center gap-0.5 group-hover/folder:inline-flex">
                  <button onClick={() => onCopyFolderLink(f.id)} title="Copy link to this folder" className="rounded p-0.5 hover:bg-background hover:text-foreground"><I.link className="h-2.5 w-2.5" /></button>
                  <button onClick={() => { setRenamingFolder(f.id); setRenameValue(f.name); }} title="Rename folder" className="rounded p-0.5 hover:bg-background hover:text-foreground"><I.pencil className="h-2.5 w-2.5" /></button>
                  <button onClick={() => { if (selectedFolder === f.id) setSelectedFolder(null); onDeleteFolder(f.id); }} title="Delete folder" className="rounded p-0.5 hover:bg-background hover:text-danger"><I.trash className="h-2.5 w-2.5" /></button>
                </span>
              </div>
            );
          })}
          {items.some((a) => !a.folderId) && (
            <button onClick={() => setSelectedFolder("unfiled")} className={`rounded-full border px-3 py-1 text-[13px] font-medium ${selectedFolder === "unfiled" ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-surface"}`}>Unfiled · {items.filter((a) => !a.folderId).length}</button>
          )}
          {addingFolder ? (
            <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitNewFolder(); if (e.key === "Escape") setAddingFolder(false); }}
              onBlur={submitNewFolder} placeholder="Folder name…"
              className="w-32 rounded-full border border-accent bg-surface px-3 py-1 text-[13px] outline-none" />
          ) : (
            <button onClick={() => setAddingFolder(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-[13px] font-medium text-muted hover:bg-surface"><I.plus className="h-3 w-3" /> New folder</button>
          )}
        </div>

        <div className="space-y-8">
        {displayed.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.clipboard /></span>
            <span className="text-[15px] font-medium">{selectedFolder === null ? "Nothing in the vault yet" : "Nothing filed here yet"}</span>
            <span className="max-w-[280px] text-[13px] leading-relaxed">{selectedFolder === null ? "Every image, doc, sheet, and link attached to a task or posted in Chat shows up here automatically." : "Move an item here from its ‹⋯› menu."}</span>
          </div>
        )}

        {photos.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Photos · {photos.length}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((a) => (
                <ImageTile key={a.id} item={a} url={a.path ? urls[a.path] : undefined} onClick={() => setPreview(a)} onCopyLink={onCopyLink} folders={folders} />
              ))}
            </div>
          </div>
        )}

        {screenshots.length > 0 && (
          <div>
            <button onClick={() => setScreenshotsOpen((o) => !o)} className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-foreground">
              <I.chevron className={`h-3 w-3 shrink-0 transition-transform ${screenshotsOpen ? "rotate-90" : "rotate-180"}`} /> Screenshots · {screenshots.length}
            </button>
            {screenshotsOpen && (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                {screenshots.map((a) => (
                  <ImageTile key={a.id} item={a} url={a.path ? urls[a.path] : undefined} onClick={() => setPreview(a)} onCopyLink={onCopyLink} folders={folders} small />
                ))}
              </div>
            )}
          </div>
        )}

        {otherGroups.map((g) => (
          <div key={g.kind}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label} · {g.items.length}</div>
            <div className="space-y-1.5">
              {g.items.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2">
                  <FileBadge kind={a.kind} />
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[15px] text-accent hover:underline" title={a.url}>{a.name}</a>
                  ) : a.path ? (
                    <button onClick={() => onDownloadFile(a.path!)} className="min-w-0 flex-1 truncate text-left text-[15px] text-accent hover:underline">{a.name}</button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[15px]">{a.name}</span>
                  )}
                  <FolderMenu item={a} folders={folders} />
                  <button onClick={a.onOpenSource} className="shrink-0 truncate text-[13px] text-muted hover:text-foreground hover:underline">{a.sourceLabel}</button>
                  {a.size && <span className="shrink-0 text-[13px] text-muted">{a.size}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6" onClick={() => setPreview(null)}>
          {preview.path && urls[preview.path] ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed-URL preview, not a next/image-friendly static asset.
            <img src={urls[preview.path]} alt={preview.name} className="max-h-[85vh] max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => preview.onOpenSource()} className="text-[13px] text-white/80 hover:text-white hover:underline">{preview.sourceLabel}</button>
            {preview.path && (
              <button onClick={() => onCopyLink(preview.path!)} className="inline-flex items-center gap-1 text-[13px] text-white/80 hover:text-white hover:underline"><I.link className="h-3 w-3" /> Copy link</button>
            )}
          </div>
          <button onClick={() => setPreview(null)} className="absolute right-4 top-4 text-white/80 hover:text-white"><I.close /></button>
        </div>
      )}
    </div>
  );
}

// Small "move to folder" popover — reused by both the row list and (as a
// hover overlay) the image grid. Lists existing folders + a "Unfiled"
// clear option; matches item.folderId to show the current one checked.
function FolderMenu({ item, folders, triggerClassName }: { item: VaultItem; folders: VaultFolder[]; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)} title="Move to folder" className={triggerClassName ?? "rounded-md p-1 text-muted hover:bg-background hover:text-foreground"}><I.folder /></button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-lg border bg-surface py-1 shadow-lg">
          <button onClick={() => { item.onSetFolder(null); setOpen(false); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-background ${!item.folderId ? "text-accent" : ""}`}>{!item.folderId && <I.check className="h-3 w-3" />} Unfiled</button>
          {folders.length > 0 && <div className="my-1 border-t" />}
          {folders.map((f) => (
            <button key={f.id} onClick={() => { item.onSetFolder(f.id); setOpen(false); }} className={`flex w-full items-center gap-2 truncate px-3 py-1.5 text-left text-[13px] hover:bg-background ${item.folderId === f.id ? "text-accent" : ""}`}>{item.folderId === f.id && <I.check className="h-3 w-3 shrink-0" />} <span className="truncate">{f.name}</span></button>
          ))}
        </div>
      </>)}
    </div>
  );
}

function ImageTile({ item, url, onClick, onCopyLink, folders, small }: { item: VaultItem; url?: string; onClick: () => void; onCopyLink: (path: string) => void; folders: VaultFolder[]; small?: boolean }) {
  return (
    <div className={`group relative aspect-square overflow-hidden rounded-lg border bg-surface ${small ? "opacity-80 hover:opacity-100" : ""}`}>
      <button onClick={onClick} title={item.name} className="block h-full w-full">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed-URL thumbnail, not a next/image-friendly static asset.
          <img src={url} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <span className="flex h-full w-full items-center justify-center"><FileBadge kind="image" /></span>
        )}
        {!small && <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[12px] text-white opacity-0 transition group-hover:opacity-100">{item.sourceLabel}</span>}
      </button>
      <div className={`absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100`}>
        {!small && (
          <FolderMenu item={item} folders={folders} triggerClassName="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80" />
        )}
        {item.path && (
          <button onClick={(e) => { e.stopPropagation(); onCopyLink(item.path!); }} title="Copy link" className={`flex items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80 ${small ? "h-5 w-5" : "h-7 w-7"}`}>
            <I.link className={small ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
          </button>
        )}
      </div>
    </div>
  );
}

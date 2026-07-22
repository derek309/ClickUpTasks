"use client";

// The Vault tab on a client or project — every attachment from anywhere in
// scope (task attachments, task comment images, Chat message images)
// collected into one place. Everything renders as a tile grid via the
// shared AttachmentTile (Derek's ask: "kind of turn it into a gallery") —
// images split into two tiers, real photos shown large and prominent,
// screenshots shown small and collapsed by default since they're the
// "lowest quality" of the bunch; PDFs/docs/sheets/links get the same grid
// with an icon tile in place of a thumbnail.
// Folders are a pure organizational overlay — filing an item into a folder
// never moves the underlying file, just tags it (see Attachment.folderId).
import { useEffect, useRef, useState } from "react";
import { type Attachment, type VaultFolder } from "@/lib/data";
import { I } from "./ui";
import { AttachmentTile } from "./AttachmentTile";

export type VaultItem = Attachment & { sourceLabel: string; onOpenSource: () => void; onSetFolder: (folderId: string | null) => void };

const OTHER_KIND_ORDER: Attachment["kind"][] = ["pdf", "doc", "sheet", "link"];
const KIND_LABEL: Record<Attachment["kind"], string> = { image: "Images", pdf: "PDFs", doc: "Docs", sheet: "Sheets", link: "Links" };

// The Attachment type carries no dimensions/EXIF/upload-source — filename
// is the only signal available to tell a screenshot from a real photo.
// Matches the default names macOS/Windows screenshot tools produce.
const SCREENSHOT_RE = /^(screenshot|screen shot|cleanshot|snip)/i;

// Manual drag order first (unset = end, stable in original/added order for
// ties) — same "position, fallback to stored order" idiom used everywhere
// else drag-sort exists in this app (folders/lists).
const sortByPosition = (list: VaultItem[]) => [...list].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

export function VaultView({ items, folders, onDownloadFile, onGetSignedUrl, onCopyLink, onCopyFolderLink, onCreateFolder, onRenameFolder, onDeleteFolder, onAddFiles, onReorder, initialFolderId }: {
  items: VaultItem[];
  folders: VaultFolder[];
  onDownloadFile: (path: string) => void;
  onGetSignedUrl: (path: string) => Promise<string | null>;
  onCopyLink: (path: string) => void;
  onCopyFolderLink: (folderId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  /** Drop files anywhere on the Vault (or click "+ Add files") to upload —
   * no owning task, filed as a bodyless Journal note under the hood. */
  onAddFiles: (files: FileList) => void;
  /** Persist a full kind-group's new order in one shot: the caller batches the
   * writes per owning row (task/comment/note), so attachments that share an
   * owner don't clobber each other's position. */
  onReorder: (orderedIds: string[]) => void;
  /** From a deep link's ?folder= param — read once as the initial selection
   * only, not a live-controlled prop (this component owns folder browsing
   * after that). */
  initialFolderId?: string | null;
}) {
  const [selectedFolder, setSelectedFolder] = useState<string | "unfiled" | null>(initialFolderId ?? null);
  const displayed = selectedFolder === null ? items : selectedFolder === "unfiled" ? items.filter((a) => !a.folderId) : items.filter((a) => a.folderId === selectedFolder);

  const images = displayed.filter((a) => a.kind === "image");
  const photos = sortByPosition(images.filter((a) => !SCREENSHOT_RE.test(a.name)));
  const screenshots = sortByPosition(images.filter((a) => SCREENSHOT_RE.test(a.name)));
  const otherGroups = OTHER_KIND_ORDER.map((k) => ({ kind: k, label: KIND_LABEL[k], items: sortByPosition(displayed.filter((a) => a.kind === k)) })).filter((g) => g.items.length > 0);

  // Drag-to-reorder within one kind-group — same splice-before-target idiom
  // as FolderRail/ClientLinks. Vault items are a merge of three
  // independently-ordered owning rows (task/comment/note); we hand the whole
  // new group order to onReorder, which batches the position writes per owner
  // so two attachments on the same task can't overwrite each other's index.
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const reorderGroup = (groupItems: VaultItem[], targetId: string) => {
    if (!dragItemId || dragItemId === targetId) { setDragItemId(null); return; }
    const ids = groupItems.map((a) => a.id).filter((id) => id !== dragItemId);
    const at = ids.indexOf(targetId);
    // The dragged tile isn't in this group (a cross-group drop) — ignore it
    // rather than splicing a foreign id in and renumbering around a phantom.
    if (at < 0 || !groupItems.some((a) => a.id === dragItemId)) { setDragItemId(null); return; }
    ids.splice(at, 0, dragItemId);
    onReorder(ids);
    setDragItemId(null);
  };

  // Drag files from the desktop straight onto the Vault to attach them.
  const [fileDragOver, setFileDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    <div
      className="relative flex-1 overflow-y-auto bg-background px-4 py-4 sm:px-5"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setFileDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setFileDragOver(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setFileDragOver(false); onAddFiles(e.dataTransfer.files); } }}
    >
      {fileDragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent/10">
          <div className="rounded-xl border-2 border-dashed border-accent bg-surface px-6 py-4 text-[15px] font-medium text-accent shadow-lg">Drop to attach to the Vault</div>
        </div>
      )}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) onAddFiles(e.target.files); e.target.value = ""; }} />
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
          <button onClick={() => fileInputRef.current?.click()} className="ml-auto inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-[13px] font-medium text-muted hover:bg-surface"><I.plus className="h-3 w-3" /> Add files</button>
        </div>

        <div className="space-y-8">
        {displayed.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.clipboard /></span>
            <span className="text-[15px] font-medium">{selectedFolder === null ? "Nothing in the vault yet" : "Nothing filed here yet"}</span>
            <span className="max-w-[280px] text-[13px] leading-relaxed">{selectedFolder === null ? "Every image, doc, sheet, and link attached to a task or posted in Chat shows up here automatically — or drag files in, or click Add files." : "Move an item here from its ‹⋯› menu."}</span>
          </div>
        )}

        {photos.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Photos · {photos.length}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((a) => (
                <AttachmentTile key={a.id} item={a} url={a.path ? urls[a.path] : undefined} onOpen={() => setPreview(a)} overlayCaption={a.sourceLabel}
                  drag={{ dragging: dragItemId === a.id, onDragStart: () => setDragItemId(a.id), onDrop: () => reorderGroup(photos, a.id) }}
                  actions={
                    <>
                      <FolderMenu item={a} folders={folders} triggerClassName="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80" />
                      {a.path && (
                        <button onClick={(e) => { e.stopPropagation(); onCopyLink(a.path!); }} title="Copy link" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.link className="h-3.5 w-3.5" /></button>
                      )}
                    </>
                  }
                />
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
                  <AttachmentTile key={a.id} item={a} url={a.path ? urls[a.path] : undefined} onOpen={() => setPreview(a)} small
                    drag={{ dragging: dragItemId === a.id, onDragStart: () => setDragItemId(a.id), onDrop: () => reorderGroup(screenshots, a.id) }}
                    actions={a.path && (
                      <button onClick={(e) => { e.stopPropagation(); onCopyLink(a.path!); }} title="Copy link" className="flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.link className="h-2.5 w-2.5" /></button>
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {otherGroups.map((g) => (
          <div key={g.kind}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label} · {g.items.length}</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {g.items.map((a) => (
                <div key={a.id} className="flex flex-col gap-1">
                  <AttachmentTile
                    item={a}
                    href={a.url || undefined}
                    onOpen={!a.url && a.path ? () => onDownloadFile(a.path!) : undefined}
                    drag={{ dragging: dragItemId === a.id, onDragStart: () => setDragItemId(a.id), onDrop: () => reorderGroup(g.items, a.id) }}
                    actions={
                      <>
                        <FolderMenu item={a} folders={folders} triggerClassName="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80" />
                        {a.path && (
                          <button onClick={(e) => { e.stopPropagation(); onCopyLink(a.path!); }} title="Copy link" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.link className="h-3.5 w-3.5" /></button>
                        )}
                      </>
                    }
                  />
                  <div className="truncate text-center text-[12px]" title={a.name}>{a.name}</div>
                  <button onClick={a.onOpenSource} className="truncate text-center text-[11px] text-muted hover:text-foreground hover:underline">{a.sourceLabel}</button>
                  {a.size && <div className="text-center text-[11px] text-muted">{a.size}</div>}
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

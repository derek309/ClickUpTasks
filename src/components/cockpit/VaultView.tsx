"use client";

// The Vault tab on a client or project — every attachment from anywhere in
// scope (task attachments, task comment images, Chat message images)
// collected into one place. Images render as an actual photo gallery
// (Derek's ask: "kind of turn it into a gallery") split into two tiers —
// real photos shown large and prominent, screenshots shown small and
// collapsed by default since they're the "lowest quality" of the bunch.
// Everything else (PDFs/docs/sheets/links) stays the plain row list below.
import { useEffect, useState } from "react";
import { type Attachment } from "@/lib/data";
import { I, FileBadge } from "./ui";

export type VaultItem = Attachment & { sourceLabel: string; onOpenSource: () => void };

const OTHER_KIND_ORDER: Attachment["kind"][] = ["pdf", "doc", "sheet", "link"];
const KIND_LABEL: Record<Attachment["kind"], string> = { image: "Images", pdf: "PDFs", doc: "Docs", sheet: "Sheets", link: "Links" };

// The Attachment type carries no dimensions/EXIF/upload-source — filename
// is the only signal available to tell a screenshot from a real photo.
// Matches the default names macOS/Windows screenshot tools produce.
const SCREENSHOT_RE = /^(screenshot|screen shot|cleanshot|snip)/i;

export function VaultView({ items, onDownloadFile, onGetSignedUrl }: {
  items: VaultItem[];
  onDownloadFile: (path: string) => void;
  onGetSignedUrl: (path: string) => Promise<string | null>;
}) {
  const images = items.filter((a) => a.kind === "image");
  const photos = images.filter((a) => !SCREENSHOT_RE.test(a.name));
  const screenshots = images.filter((a) => SCREENSHOT_RE.test(a.name));
  const otherGroups = OTHER_KIND_ORDER.map((k) => ({ kind: k, label: KIND_LABEL[k], items: items.filter((a) => a.kind === k) })).filter((g) => g.items.length > 0);

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

  return (
    <div className="flex-1 overflow-y-auto bg-background px-4 py-4 sm:px-5">
      <div className="mx-auto max-w-5xl space-y-8">
        {items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.clipboard /></span>
            <span className="text-[15px] font-medium">Nothing in the vault yet</span>
            <span className="max-w-[280px] text-[13px] leading-relaxed">Every image, doc, sheet, and link attached to a task or posted in Chat shows up here automatically.</span>
          </div>
        )}

        {photos.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Photos · {photos.length}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((a) => (
                <ImageTile key={a.id} item={a} url={a.path ? urls[a.path] : undefined} onClick={() => setPreview(a)} />
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
                  <ImageTile key={a.id} item={a} url={a.path ? urls[a.path] : undefined} onClick={() => setPreview(a)} small />
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
                  <button onClick={a.onOpenSource} className="shrink-0 truncate text-[13px] text-muted hover:text-foreground hover:underline">{a.sourceLabel}</button>
                  {a.size && <span className="shrink-0 text-[13px] text-muted">{a.size}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6" onClick={() => setPreview(null)}>
          {preview.path && urls[preview.path] ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed-URL preview, not a next/image-friendly static asset.
            <img src={urls[preview.path]} alt={preview.name} className="max-h-[85vh] max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          <button onClick={() => preview.onOpenSource()} className="text-[13px] text-white/80 hover:text-white hover:underline" onClickCapture={(e) => e.stopPropagation()}>{preview.sourceLabel}</button>
          <button onClick={() => setPreview(null)} className="absolute right-4 top-4 text-white/80 hover:text-white"><I.close /></button>
        </div>
      )}
    </div>
  );
}

function ImageTile({ item, url, onClick, small }: { item: VaultItem; url?: string; onClick: () => void; small?: boolean }) {
  return (
    <button onClick={onClick} title={item.name} className={`group relative aspect-square overflow-hidden rounded-lg border bg-surface ${small ? "opacity-80 hover:opacity-100" : ""}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed-URL thumbnail, not a next/image-friendly static asset.
        <img src={url} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
      ) : (
        <span className="flex h-full w-full items-center justify-center"><FileBadge kind="image" /></span>
      )}
      {!small && <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[12px] text-white opacity-0 transition group-hover:opacity-100">{item.sourceLabel}</span>}
    </button>
  );
}

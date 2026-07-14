"use client";

// The Vault tab on a client or project — every attachment from anywhere in
// scope (task attachments, task comment images, Chat message images)
// collected into one place, grouped by type, so nobody has to remember
// which task a file was dropped into.
import { type Attachment } from "@/lib/data";
import { I, FileBadge } from "./ui";

export type VaultItem = Attachment & { sourceLabel: string; onOpenSource: () => void };

const KIND_ORDER: Attachment["kind"][] = ["image", "pdf", "doc", "sheet", "link"];
const KIND_LABEL: Record<Attachment["kind"], string> = { image: "Images", pdf: "PDFs", doc: "Docs", sheet: "Sheets", link: "Links" };

export function VaultView({ items, onDownloadFile }: {
  items: VaultItem[];
  onDownloadFile: (path: string) => void;
}) {
  const groups = KIND_ORDER.map((k) => ({ kind: k, label: KIND_LABEL[k], items: items.filter((a) => a.kind === k) })).filter((g) => g.items.length > 0);

  return (
    <div className="flex-1 overflow-y-auto bg-background px-4 py-4 sm:px-5">
      <div className="mx-auto max-w-3xl space-y-6">
        {items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.clipboard /></span>
            <span className="text-[15px] font-medium">Nothing in the vault yet</span>
            <span className="max-w-[280px] text-[13px] leading-relaxed">Every image, doc, sheet, and link attached to a task or posted in Chat shows up here automatically.</span>
          </div>
        )}
        {groups.map((g) => (
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
    </div>
  );
}

"use client";

// Quick-access links bar on a client's page — grouped, orderable buttons to
// the live site, WP admin, GHL contact, etc. Ported from the "Dispatch" app's
// client-hub concept.
import { useState } from "react";
import { type ClientLink, prettyLinkName } from "@/lib/data";
import { I } from "./ui";

// The site's own icon, so the right link is spotted without reading it
// (Derek, 2026-10-08); the plain link icon when the site has none.
function SiteIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a full address */ }
  if (!host || failed) return <span className="text-muted"><I.link /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`} alt="" width={16} height={16} className="h-4 w-4 shrink-0 rounded-sm" onError={() => setFailed(true)} />;
}

function groupLinks(links: ClientLink[]) {
  const order: string[] = [];
  const map = new Map<string, ClientLink[]>();
  for (const l of links) {
    const key = l.groupLabel || "";
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(l);
  }
  return order.map((key) => ({ key, links: map.get(key)! }));
}

export function QuickLinksBar({ links, canEdit, onEdit, onDelete, onReorder, onAdd, inline = false }: {
  links: ClientLink[];
  /** Paste a link to add it, named from the site; the + at the end of the row. */
  onAdd?: (v: { label: string; url: string }) => void;
  /** In the client's name row instead of a row of its own (Derek, 2026-10-06, header G). */
  inline?: boolean;
  canEdit: boolean;
  onEdit: (link: ClientLink) => void;
  onDelete: (link: ClientLink) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addLink = () => {
    const raw = draft.trim();
    if (!raw || !onAdd) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    onAdd({ label: prettyLinkName(url).slice(0, 40), url });
    setDraft(""); setAdding(false);
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const ids = links.map((l) => l.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    onReorder(ids);
    setDragId(null);
  };

  // Adding a link now lives in the header (an always-available icon button),
  // so this bar is purely optional — no reason to reserve a permanent row of
  // chrome for a client that hasn't added any quick links yet.
  const canAdd = canEdit && !!onAdd;
  if (links.length === 0 && !canAdd) return null;

  return (
    <div className={inline ? "inline-flex flex-wrap items-center gap-2 text-[16px] font-normal" : "no-scrollbar flex flex-nowrap items-center gap-2 overflow-x-auto border-b bg-background/40 px-4 py-2 sm:flex-wrap sm:overflow-visible sm:px-5"}>
      {groupLinks(links).map((g) => (
        <span key={g.key || "_"} className="inline-flex items-center gap-2">
          {g.key && <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{g.key}</span>}
          {g.links.map((l) => (
            <span key={l.id} className={`group/link relative inline-flex items-center ${dragId === l.id ? "opacity-40" : ""}`}
              draggable={canEdit} onDragStart={() => setDragId(l.id)} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(l.id); }}>
              {/* One even chip each: the site's icon and its name. The ⋯ for
                  editing floats over the corner, so it takes no room. */}
              <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}
                className="inline-flex h-8 items-center gap-2 rounded-[5px] bg-surface px-2.5 text-[16px] font-medium text-foreground ring-1 ring-[var(--border)] hover:bg-background">
                <SiteIcon url={l.url} /> {l.label}
              </a>
              {canEdit && (
                <div className="absolute -right-2 -top-2">
                  <button onClick={(e) => { e.stopPropagation(); setMenuId(menuId === l.id ? null : l.id); }} title="Edit or delete" aria-label={`Edit ${l.label}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-surface text-muted opacity-0 shadow ring-1 ring-[var(--border)] hover:text-foreground focus:opacity-100 group-hover/link:opacity-100">
                    <I.dots />
                  </button>
                  {menuId === l.id && (<>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuId(null)} />
                    <div className="absolute left-0 top-full z-40 mt-1 w-32 rounded-lg border border-white/10 bg-background p-1 shadow-xl">
                      <button onClick={() => { setMenuId(null); onEdit(l); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10"><I.pencil /> Edit</button>
                      <button onClick={() => { setMenuId(null); onDelete(l); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-red-500 hover:bg-white/10"><I.trash /> Delete</button>
                    </div>
                  </>)}
                </div>
              )}
            </span>
          ))}
        </span>
      ))}
      {canAdd && (
        <span className="relative inline-flex">
          <button onClick={() => setAdding((v) => !v)} title="Add a quick link" aria-label="Add a quick link"
            className="flex h-8 w-8 items-center justify-center rounded-[5px] text-[18px] font-bold text-muted ring-1 ring-dashed ring-[var(--border)] hover:bg-background hover:text-foreground">+</button>
          {adding && (<>
            <div className="fixed inset-0 z-30" onClick={() => setAdding(false)} />
            <form onSubmit={(e) => { e.preventDefault(); addLink(); }} className="absolute left-0 top-10 z-40 flex w-80 gap-2 rounded-[5px] bg-surface p-2 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}
                placeholder="Paste the link" aria-label="Link to add" className="min-w-0 flex-1 rounded-[5px] border bg-background px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
              <button type="submit" disabled={!draft.trim()} className="rounded-[5px] bg-accent px-3 text-[16px] font-semibold text-white disabled:opacity-40">Add</button>
            </form>
          </>)}
        </span>
      )}
    </div>
  );
}

"use client";

// Quick-access links bar on a client's page — grouped, orderable buttons to
// the live site, WP admin, GHL contact, etc. Ported from the "Dispatch" app's
// client-hub concept.
import { useState } from "react";
import { type ClientLink } from "@/lib/data";
import { I } from "./ui";

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

export function QuickLinksBar({ links, canEdit, onEdit, onDelete, onReorder }: {
  links: ClientLink[];
  canEdit: boolean;
  onEdit: (link: ClientLink) => void;
  onDelete: (link: ClientLink) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

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
  if (links.length === 0) return null;

  return (
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b bg-background/40 px-4 py-2 sm:flex-wrap sm:overflow-visible sm:px-5">
      {groupLinks(links).map((g) => (
        <span key={g.key || "_"} className="inline-flex items-center gap-1.5">
          {g.key && <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{g.key}</span>}
          {g.links.map((l) => (
            <span key={l.id} className={`group/link relative inline-flex items-center ${dragId === l.id ? "opacity-40" : ""}`}
              draggable={canEdit} onDragStart={() => setDragId(l.id)} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(l.id); }}>
              <a href={l.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border-l-[3px] border-y border-r px-2.5 py-1 text-[13px] font-medium text-foreground hover:bg-background"
                style={{ borderLeftColor: l.color }}>
                <span style={{ color: l.color }}><I.link /></span> {l.label}
              </a>
              {canEdit && (
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setMenuId(menuId === l.id ? null : l.id); }} title="More"
                    className="rounded p-0.5 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover/link:opacity-100">
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
    </div>
  );
}

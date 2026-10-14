"use client";

// Quick-access links bar on a client's page — grouped, orderable buttons to
// the live site, WP admin, GHL contact, etc. Ported from the "Dispatch" app's
// client-hub concept.
import { useLayoutEffect, useRef, useState } from "react";
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

export function QuickLinksBar({ links: all, canEdit, onEdit, onDelete, onReorder, onAdd, inline = false, fit = false, lead, onOpenFile }: {
  links: ClientLink[];
  /** One line, never wrapping: the chips that fit, the rest under "+ More"
   *  (Derek, 2026-10-14, client header). */
  fit?: boolean;
  /** A chip before the links that is not one of them (their SaaS account). */
  lead?: { label: string; url: string; title?: string } | null;
  /** Opens a saved file (Saved files and links); without it files are left out. */
  onOpenFile?: (link: ClientLink) => void;
  /** Paste a link to add it, named from the site; the + at the end of the row. */
  onAdd?: (v: { label: string; url: string }) => void;
  /** In the client's name row instead of a row of its own (Derek, 2026-10-06, header G). */
  inline?: boolean;
  canEdit: boolean;
  onEdit: (link: ClientLink) => void;
  onDelete: (link: ClientLink) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const links = onOpenFile ? all : all.filter((l) => !l.path);
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
  if (fit) return <FitLinks links={links} lead={lead ?? null} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} onAdd={canAdd ? onAdd! : null} onOpenFile={onOpenFile} />;
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
              {l.path ? (
                // A saved file: opens the stored file itself.
                <button onClick={() => onOpenFile?.(l)} title={`Open ${l.label}`}
                  className="inline-flex h-8 items-center gap-2 rounded-[5px] bg-surface px-2.5 text-[16px] font-medium text-foreground ring-1 ring-[var(--border)] hover:bg-background">
                  <span className="text-muted"><I.clip /></span> {l.label}
                </button>
              ) : (
                <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}
                  className="inline-flex h-8 items-center gap-2 rounded-[5px] bg-surface px-2.5 text-[16px] font-medium text-foreground ring-1 ring-[var(--border)] hover:bg-background">
                  <SiteIcon url={l.url} /> {l.label}
                </a>
              )}
              {canEdit && (
                <div className="absolute -right-2 -top-2">
                  <button onClick={(e) => { e.stopPropagation(); setMenuId(menuId === l.id ? null : l.id); }} title="Edit or delete" aria-label={`Edit ${l.label}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-surface text-muted opacity-0 shadow ring-1 ring-[var(--border)] hover:text-foreground focus:opacity-100 group-hover/link:opacity-100">
                    <I.dots />
                  </button>
                  {menuId === l.id && (<>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuId(null)} />
                    <div className="absolute left-0 top-full z-40 mt-1 w-32 rounded-lg border border-white/10 bg-background p-1 shadow-xl">
                      {!l.path && <button onClick={() => { setMenuId(null); onEdit(l); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10"><I.pencil /> Edit</button>}
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

// The client header's links on one line (Derek, 2026-10-14): as many chips as
// the row has room for, then "+ More" with the rest. The row's width comes
// from the header, never from the chips (flex-1, min-w-0), so hiding a chip
// can't change the room it is measured against: no resize loop.
function FitLinks({ links, lead, canEdit, onEdit, onDelete, onAdd, onOpenFile }: {
  links: ClientLink[];
  /** A saved file opens the stored file itself (Saved files and links). */
  onOpenFile?: (link: ClientLink) => void;
  lead: { label: string; url: string; title?: string } | null;
  canEdit: boolean;
  onEdit: (link: ClientLink) => void;
  onDelete: (link: ClientLink) => void;
  onAdd: ((v: { label: string; url: string }) => void) | null;
}) {
  const items: { id: string; label: string; url: string; title: string; link: ClientLink | null }[] = [
    ...(lead ? [{ id: "lead", label: lead.label, url: lead.url, title: lead.title ?? lead.url, link: null }] : []),
    ...links.map((l) => ({ id: l.id, label: l.label, url: l.url, title: l.url, link: l })),
  ];
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(items.length);
  // How wide + More is: the row never gets narrower than + More and +, so
  // the name beside it gives way instead of the row running under the bell.
  const [moreW, setMoreW] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const key = items.map((i) => `${i.id}:${i.label}`).join("|");
  useLayoutEffect(() => {
    const r = row.current, m = measure.current;
    if (!r || !m) return;
    const calc = () => {
      const kids = [...m.children] as HTMLElement[];
      const more = kids.pop()?.offsetWidth ?? 90;
      setMoreW(more);
      const add = onAdd ? 40 : 0;
      const widths = kids.map((k) => k.offsetWidth);
      const gap = 8;
      const avail = r.clientWidth - add;
      const total = widths.reduce((a, w, i) => a + w + (i ? gap : 0), 0);
      if (total <= avail) { setShown(widths.length); return; }
      let used = more, n = 0;
      for (const w of widths) { if (used + gap + w > avail) break; used += gap + w; n++; }
      setShown(n);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(r);
    return () => ro.disconnect();
  }, [key, !!onAdd]); // eslint-disable-line react-hooks/exhaustive-deps
  const addLink = () => {
    const raw = draft.trim();
    if (!raw || !onAdd) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    onAdd({ label: prettyLinkName(url).slice(0, 40), url });
    setDraft(""); setAdding(false);
  };
  const chip = (i: (typeof items)[number]) => i.link
    ? "inline-flex h-8 max-w-[200px] items-center gap-2 rounded-[5px] bg-surface px-2.5 text-[16px] font-medium text-foreground ring-1 ring-[var(--border)] hover:bg-background"
    : "inline-flex h-8 max-w-[200px] items-center gap-2 rounded-[5px] bg-accent-soft px-2.5 text-[16px] font-bold text-accent ring-1 ring-accent/30 hover:ring-accent";
  const hidden = items.slice(shown);
  // A saved file has no address: a click opens the stored file.
  const fileOpen = (i: (typeof items)[number]) => (i.link?.path ? {
    href: undefined, role: "button", tabIndex: 0, title: `Open ${i.label}`,
    onClick: (e: React.MouseEvent) => { e.preventDefault(); onOpenFile?.(i.link!); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") onOpenFile?.(i.link!); },
  } : {});
  const icon = (i: (typeof items)[number]) => (i.link?.path ? <span className="text-muted"><I.clip /></span> : i.link ? <SiteIcon url={i.url} /> : null);
  return (
    <div ref={row} style={{ minWidth: (shown < items.length ? moreW + 8 : 0) + (onAdd ? 40 : 0) }} className="relative flex min-w-0 flex-1 flex-nowrap items-center gap-2 text-[16px] font-normal">
      {/* The same chips, unseen, to know how wide each is. */}
      <div ref={measure} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max gap-2 overflow-hidden">
        {items.map((i) => <span key={i.id} className={chip(i)}>{i.link && <SiteIcon url={i.url} />}<span className="truncate">{i.label}</span></span>)}
        <span className="inline-flex h-8 items-center rounded-[5px] px-2.5 text-[16px] font-semibold ring-1 ring-[var(--border)]">+ More ({items.length})</span>
      </div>
      {items.slice(0, shown).map((i) => (
        <span key={i.id} className="group/link relative inline-flex min-w-0 shrink-0 items-center">
          <a href={i.url} target="_blank" rel="noopener noreferrer" title={i.title} className={`${chip(i)} cursor-pointer`} {...fileOpen(i)}>
            {icon(i)}<span className="truncate">{i.label}</span>
          </a>
          {canEdit && i.link && (
            <div className="absolute -right-2 -top-2">
              <button onClick={(e) => { e.stopPropagation(); setMenuId(menuId === i.id ? null : i.id); }} title="Edit or delete" aria-label={`Edit ${i.label}`}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-surface text-muted opacity-0 shadow ring-1 ring-[var(--border)] hover:text-foreground focus:opacity-100 group-hover/link:opacity-100">
                <I.dots />
              </button>
              {menuId === i.id && (<>
                <div className="fixed inset-0 z-30" onClick={() => setMenuId(null)} />
                <div className="absolute left-0 top-full z-40 mt-1 w-36 rounded-[5px] border bg-surface p-1 shadow-xl">
                  {!i.link?.path && <button onClick={() => { setMenuId(null); onEdit(i.link!); }} className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[16px] hover:bg-background"><I.pencil /> Edit</button>}
                  <button onClick={() => { setMenuId(null); onDelete(i.link!); }} className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[16px] text-danger hover:bg-background"><I.trash /> Delete</button>
                </div>
              </>)}
            </div>
          )}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="relative inline-flex shrink-0">
          <button onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} title="The rest of their links"
            className="inline-flex h-8 items-center rounded-[5px] bg-surface px-2.5 text-[16px] font-semibold text-foreground ring-1 ring-[var(--border)] hover:bg-background">+ More ({hidden.length})</button>
          {moreOpen && (<>
            <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
            <div className="absolute left-0 top-10 z-40 max-h-[60vh] w-72 overflow-y-auto rounded-[5px] bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              {hidden.map((i) => (
                <span key={i.id} className="flex items-center gap-1">
                  <a href={i.url} target="_blank" rel="noopener noreferrer" title={i.title}
                    className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[5px] px-2.5 py-2 text-[16px] hover:bg-background ${i.link ? "" : "font-bold text-accent"}`}
                    {...(i.link?.path ? { ...fileOpen(i), onClick: (e: React.MouseEvent) => { e.preventDefault(); setMoreOpen(false); onOpenFile?.(i.link!); } } : { onClick: () => setMoreOpen(false) })}>
                    {icon(i)}<span className="truncate">{i.label}</span>
                  </a>
                  {canEdit && i.link && !i.link.path && <button onClick={() => { setMoreOpen(false); onEdit(i.link!); }} title="Edit" aria-label={`Edit ${i.label}`} className="rounded-[5px] p-2 text-muted hover:bg-background hover:text-foreground"><I.pencil /></button>}
                </span>
              ))}
            </div>
          </>)}
        </span>
      )}
      {onAdd && (
        <span className="relative inline-flex shrink-0">
          <button onClick={() => setAdding((v) => !v)} title="Add a quick link" aria-label="Add a quick link"
            className="flex h-8 w-8 items-center justify-center rounded-[5px] text-[18px] font-bold text-muted ring-1 ring-dashed ring-[var(--border)] hover:bg-background hover:text-foreground">+</button>
          {adding && (<>
            <div className="fixed inset-0 z-30" onClick={() => setAdding(false)} />
            <form onSubmit={(e) => { e.preventDefault(); addLink(); }} className="absolute right-0 top-10 z-40 flex w-80 max-w-[80vw] gap-2 rounded-[5px] bg-surface p-2 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
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

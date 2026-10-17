"use client";

// A client's lists, at the top of their page (Derek, 2026-10-17, mockup:
// CUL Tasks/lists-finish-repeat-mockup.html). It replaces the row of list
// tabs: the page opens here, a list opens from its row, and All tasks shows
// every task across the lists the way the All tab did.
//
// Each row says its kind (☰ holds work, ◎ finishes, ↻ repeats), its name and
// where it stands in one line, with the sidebar's red (late) and orange
// (today) counts. Sorted the way the sidebar sorts clients: late first, then
// today, then what's coming, then quiet (faded). A finishing list that is
// done leaves the list and waits under Finished. + New list asks one thing:
// which kind.
//
// Also here: ListMenu, a list's "…" (rename, kind, queue, private, pin, copy
// for Claude, move to a folder, delete), used on an opened list's header.

import * as React from "react";
import { createPortal } from "react-dom";
import { type Folder, type Project, type Task } from "@/lib/data";
import { clientListRows, type ListRow } from "@/lib/listKinds";
import { KINDS, KIND_HINT, KIND_ICON, KIND_LABEL, listPlan, type ListKind } from "../../../mcp/listKinds.mjs";
import { isPlainLeftClick, listHref } from "@/lib/navState";
import { MenuSheet } from "./ActionMenu";
import { useEscapeToClose } from "./useEscapeToClose";

const RED = "#ef4444";
const ORANGE = "#f59e0b";

/** A menu under its button from sm up, a sheet at the bottom on a phone. */
export function PopMenu({ label, button, children, buttonClass, width = 300 }: { label: string; button: React.ReactNode; children: (close: () => void) => React.ReactNode; buttonClass: string; width?: number }) {
  const [open, setOpen] = React.useState(false);
  const [at, setAt] = React.useState({ top: 0, left: 0 });
  const close = () => setOpen(false);
  useEscapeToClose(close, open);
  return (
    <>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} className={buttonClass}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
          setOpen((v) => !v);
        }}>{button}</button>
      {open && createPortal(<>
        <div className="fixed inset-0 z-30 hidden sm:block" onClick={close} />
        <div role="menu" aria-label={label} style={{ position: "fixed", top: at.top, left: at.left, width }}
          className="z-40 hidden max-h-[70vh] overflow-y-auto rounded-[5px] border bg-surface p-1.5 shadow-soft-md sm:block">{children(close)}</div>
        <MenuSheet label={label} onClose={close}>{children(close)}</MenuSheet>
      </>, document.body)}
    </>
  );
}

const menuItem = "flex w-full items-start gap-2 rounded-[5px] px-3 py-2 text-left text-[16px] hover:bg-background disabled:opacity-40";

/** Holds work, Finishes or Repeats, each with its one line hint. */
function KindChoices({ current, onPick }: { current?: ListKind; onPick: (k: ListKind) => void }) {
  return (<>
    {KINDS.map((k) => (
      <button key={k} type="button" role="menuitemradio" aria-checked={current === k} onClick={() => onPick(k)}
        className={`${menuItem} ${current === k ? "bg-accent-soft" : ""}`}>
        <span aria-hidden className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-accent-soft text-[16px] text-accent">{KIND_ICON[k]}</span>
        <span className="min-w-0"><b className="block">{KIND_LABEL[k]}</b><span className="block text-muted">{KIND_HINT[k]}</span></span>
      </button>
    ))}
  </>);
}

export function ClientLists({ lists, tasksFor, clientFirst, today, canAdmin, kindsReady, onOpen, onNew, onAllTasks, allOpen, onCopyAllForClaude }: {
  /** The client's lists. */
  lists: Project[];
  /** Every task on a list, done ones too. */
  tasksFor: (projectId: string) => Task[];
  clientFirst: string;
  today: string;
  canAdmin: boolean;
  /** The database has projects.plan (supabase/list-kinds.sql): kinds can be picked. */
  kindsReady: boolean;
  onOpen: (projectId: string) => void;
  onNew: (kind: ListKind) => void;
  onAllTasks: () => void;
  /** Open tasks across every list, for the All tasks button. */
  allOpen: number;
  onCopyAllForClaude?: () => void;
}) {
  const { going, finished } = React.useMemo(() => clientListRows(lists, tasksFor, { clientFirst, today }), [lists, tasksFor, clientFirst, today]);
  const [showFinished, setShowFinished] = React.useState(false);
  const btn = "inline-flex h-11 items-center gap-1.5 rounded-[5px] px-4 text-[16px] font-semibold";

  const row = (r: ListRow) => (
    <a key={r.project.id} href={listHref(r.project.clientId, r.project.id)}
      onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); onOpen(r.project.id); }}
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-background ${r.quiet || r.finished ? "opacity-60" : ""}`}>
      <span aria-label={KIND_LABEL[r.kind]} title={KIND_LABEL[r.kind]} className="inline-flex h-9 w-9 items-center justify-center rounded-[5px] bg-accent-soft text-[18px] text-accent">{r.icon}</span>
      <span className="min-w-0">
        <b className="flex min-w-0 items-center gap-1.5 text-[16px]">
          {r.project.hiddenFromClient && <span title="Private: the client doesn't see this list" aria-label="Private to the team">🔒</span>}
          <span className="min-w-0 break-words">{r.project.name}</span>
        </b>
        <span className="block text-[16px] text-muted">{r.status}{r.miss && <span className="font-semibold text-red-700 dark:text-red-400"> · {r.miss}</span>}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {r.late > 0 && <span title={`${r.late} late`} className="inline-flex h-7 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-[16px] font-bold text-white" style={{ background: RED }}>{r.late}</span>}
        {r.today > 0 && <span title={`${r.today} due today`} className="inline-flex h-7 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-[16px] font-bold text-white" style={{ background: ORANGE }}>{r.today}</span>}
      </span>
    </a>
  );

  return (
    <div className="bg-background p-4 sm:p-5">
      <section className="mx-auto max-w-[1280px] overflow-hidden rounded-[5px] border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-[20px] font-semibold">Lists</h2>
          <div className="flex flex-wrap items-center gap-2">
            {onCopyAllForClaude && (
              <button type="button" onClick={onCopyAllForClaude} title="Copy every list for Claude" aria-label="Copy every list for Claude"
                className={`${btn} border bg-surface px-3 text-muted hover:text-foreground`}><span aria-hidden>✳</span></button>
            )}
            <button type="button" onClick={onAllTasks} title="Every task across this client's lists" className={`${btn} border bg-surface text-foreground hover:bg-accent-soft`}>
              All tasks{allOpen > 0 && <span className="font-normal text-muted">{allOpen}</span>}
            </button>
            {canAdmin && (kindsReady ? (
              <PopMenu label="New list" buttonClass={`${btn} bg-accent text-white hover:opacity-90`} button={<>+ New list</>}>
                {(close) => (<>
                  <div className="px-3 pb-1 pt-1.5 text-[16px] font-semibold text-muted">What kind?</div>
                  <KindChoices onPick={(k) => { close(); onNew(k); }} />
                </>)}
              </PopMenu>
            ) : (
              <button type="button" onClick={() => onNew("holds")} className={`${btn} bg-accent text-white hover:opacity-90`}>+ New list</button>
            ))}
          </div>
        </div>
        {going.map(row)}
        {!going.length && !finished.length && <p className="px-4 py-4 text-[16px] text-muted">No lists yet.</p>}
        {!going.length && finished.length > 0 && <p className="px-4 py-4 text-[16px] text-muted">Every list is finished.</p>}
        {finished.length > 0 && (<>
          <button type="button" onClick={() => setShowFinished((v) => !v)} aria-expanded={showFinished}
            className="flex w-full items-center gap-2 border-t bg-background px-4 py-3 text-left text-[16px] font-semibold text-muted hover:text-foreground">
            <span aria-hidden>{showFinished ? "▾" : "▸"}</span> Finished <span className="font-normal">{finished.length}</span>
          </button>
          {showFinished && finished.map(row)}
        </>)}
      </section>
    </div>
  );
}

/** A list's "…": everything the old tab's ⋮ held, plus its kind. */
export function ListMenu({ list, folders, canAdmin, starred, kindsReady, onRename, onKind, onToggleQueue, onToggleHidden, onTogglePin, onCopyForClaude, onMoveToFolder, onDelete }: {
  list: Project;
  folders: Folder[];
  canAdmin: boolean;
  starred: boolean;
  kindsReady: boolean;
  onRename: () => void;
  onKind: (k: ListKind) => void;
  onToggleQueue?: () => void;
  onToggleHidden: () => void;
  onTogglePin: () => void;
  onCopyForClaude?: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const kind = listPlan(list.plan).kind;
  const item = (label: React.ReactNode, run: () => void, close: () => void, danger = false) => (
    <button type="button" role="menuitem" onClick={() => { close(); run(); }} className={`${menuItem} ${danger ? "text-danger" : ""}`}>{label}</button>
  );
  return (
    <PopMenu label="List actions" width={320} button={<span aria-hidden className="text-[20px] leading-none">…</span>}
      buttonClass="inline-flex h-11 w-11 items-center justify-center rounded-[5px] border bg-surface text-muted hover:text-foreground">
      {(close) => (<>
        {canAdmin && kindsReady && (<>
          <div className="px-3 pb-1 pt-1.5 text-[16px] font-semibold text-muted">Kind</div>
          <KindChoices current={kind} onPick={(k) => { close(); if (k !== kind) onKind(k); }} />
          <div className="my-1 border-t" />
        </>)}
        {canAdmin && onToggleQueue && list.queue !== undefined && (
          <button type="button" role="switch" aria-checked={!!list.queue} onClick={() => { close(); onToggleQueue(); }}
            title={list.queue ? "Turn the queue off: every date it saved comes back" : "One at a time: the rest wait in line with no date"} className={menuItem}>
            <span aria-hidden className={`relative mt-1 inline-block h-4 w-7 shrink-0 rounded-full ${list.queue ? "bg-accent" : "bg-border"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white ${list.queue ? "left-3.5" : "left-0.5"}`} />
            </span>
            Queue
          </button>
        )}
        {item(starred ? "☆ Unpin from sidebar" : "★ Pin to sidebar", onTogglePin, close)}
        {onCopyForClaude && item(<><span aria-hidden>✳</span> Copy for Claude</>, onCopyForClaude, close)}
        {canAdmin && item("Rename list", onRename, close)}
        {canAdmin && item(list.hiddenFromClient ? "👁 Show in client portal" : "🔒 Private to the team (hide from client)", onToggleHidden, close)}
        {canAdmin && folders.length > 0 && (<>
          <div className="my-1 border-t" />
          <div className="px-3 pb-0.5 pt-1.5 text-[16px] font-semibold text-muted">Move to</div>
          {list.folderId && item("No folder", () => onMoveToFolder(null), close)}
          {folders.filter((f) => f.id !== list.folderId).map((f) => <React.Fragment key={f.id}>{item(f.name, () => onMoveToFolder(f.id), close)}</React.Fragment>)}
        </>)}
        {canAdmin && (<><div className="my-1 border-t" />{item("Delete list", onDelete, close, true)}</>)}
      </>)}
    </PopMenu>
  );
}

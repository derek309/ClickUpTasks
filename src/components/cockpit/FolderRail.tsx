"use client";

// The container rail at the top of a client's Tasks view: [All] · folders ·
// standalone lists · (admin) +Folder/+List. Selecting a folder scopes the task
// list to that folder's lists (grouped by list); selecting a standalone list
// scopes to just it. Admin chips carry a ⋮ menu (rename/delete/move).
import { useState } from "react";
import { type Folder, type Project } from "@/lib/data";
import { I } from "./ui";

// Folders are off (Derek, 2026-10-06: "no one has used folders"; there were
// none). Only the New folder button goes: folders that exist still show, so
// turning this back on is this one line.
const FOLDERS_ON = false;

export function FolderRail({
  folders, lists, activeFolder, activeProject, canAdmin, starredLists, onToggleStarList,
  onSelectAll, onCopyAllForClaude, onSelectFolder, onSelectList,
  onCreateFolder, onCreateList, onRenameFolder, onDeleteFolder, onRenameList, onDeleteList, onMoveList,
  onReorderFolders, onReorderLists, onAddTask, trailing, onCopyListForClaude }: {
  folders: Folder[];           // this client's folders, in order
  lists: Project[];            // this client's lists (projects), all of them
  activeFolder: string | null;
  activeProject: string | null;
  canAdmin: boolean;
  starredLists: Set<string>;   // per-user pinned list ids (sidebar quick access)
  onToggleStarList: (id: string) => void;
  onSelectAll: () => void;
  onSelectFolder: (id: string) => void;
  onSelectList: (id: string) => void;
  onCreateFolder: () => void;
  onCreateList: (folderId: string | null) => void;
  onRenameFolder: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameList: (id: string) => void;
  onDeleteList: (id: string) => void;
  onMoveList: (id: string, folderId: string | null) => void;
  onReorderFolders: (orderedIds: string[]) => void;      // drag-sort folders (B5)
  onReorderLists: (folderId: string | null, orderedIds: string[]) => void; // drag-sort a bucket
  // The one Add task for the whole list view. It used to sit on every group
  // header, which meant half a dozen identical buttons down a single screen
  // (Derek, 2026-09-08: "remove add tasks to each group title and put one on"
  // the right of this rail). Optional, because the personal list has no rail
  // and keeps its own per-group buttons.
  onAddTask?: () => void;
  /** Sits at the right end in place of Add task: the client page's View button (Derek, 2026-10-05). */
  trailing?: React.ReactNode;
  /** Copy one list's open tasks as a brief for Claude (Derek, 2026-10-06). */
  onCopyListForClaude?: (id: string) => void;
  /** ✳ on All: every list of this client for Claude. */
  onCopyAllForClaude?: () => void;
}) {
  const [menu, setMenu] = useState<string | null>(null); // "folder:<id>" | "list:<id>"
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [dragList, setDragList] = useState<string | null>(null);
  // A to Z (Derek, 2026-10-08), and one line: past VISIBLE the rest sit under
  // More, with the open list always kept in view.
  const standalone = lists.filter((l) => !l.folderId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const VISIBLE = 7;
  const activeIdx = standalone.findIndex((l) => l.id === activeProject);
  const shownLists = standalone.length <= VISIBLE + 1 ? standalone
    : activeIdx >= VISIBLE ? [...standalone.slice(0, VISIBLE - 1), standalone[activeIdx]] : standalone.slice(0, VISIBLE);
  const moreLists = standalone.filter((l) => !shownLists.includes(l));
  const [moreOpen, setMoreOpen] = useState(false);
  const allActive = !activeFolder && !activeProject;

  // Drag-sort helpers — same splice-before-target idiom as QuickLinksBar.
  const dropFolder = (targetId: string) => {
    if (!dragFolder || dragFolder === targetId) { setDragFolder(null); return; }
    const ids = folders.map((f) => f.id).filter((id) => id !== dragFolder);
    ids.splice(ids.indexOf(targetId), 0, dragFolder);
    onReorderFolders(ids); setDragFolder(null);
  };
  const dropList = (targetId: string) => {
    if (!dragList || dragList === targetId) { setDragList(null); return; }
    const ids = standalone.map((l) => l.id).filter((id) => id !== dragList);
    ids.splice(ids.indexOf(targetId), 0, dragList);
    onReorderLists(null, ids); setDragList(null);
  };

  const chip = (label: React.ReactNode, active: boolean, onClick: () => void, menuKey?: string, menuBody?: React.ReactNode, drag?: { dim: boolean; onDragStart: () => void; onDrop: () => void }) => (
    <span key={menuKey} className={`relative inline-flex shrink-0 ${drag?.dim ? "opacity-40" : ""}`}
      draggable={canAdmin && !!drag} onDragStart={drag?.onDragStart}
      onDragOver={(e) => { if (canAdmin && drag) e.preventDefault(); }} onDrop={(e) => { if (drag) { e.preventDefault(); drag.onDrop(); } }}>
      <button onClick={onClick}
        className={`group/chip inline-flex items-center gap-1.5 rounded-[5px] border px-3 py-1 text-[16px] font-medium ${active ? "is-active border-accent bg-accent-soft text-accent" : "bg-surface text-muted hover:text-foreground"}`}>
        {label}
        {canAdmin && menuKey && (
          <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setMenu((m) => (m === menuKey ? null : menuKey)); }}
            className="-mr-1 hidden rounded p-0.5 opacity-60 hover:opacity-100 sm:group-hover/chip:inline-block sm:group-[.is-active]/chip:inline-block"><I.dots className="h-3.5 w-3.5" /></span>
        )}
      </button>
      {menu === menuKey && menuKey && (<>
        <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />
        <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border bg-surface p-1 shadow-soft-md">{menuBody}</div>
      </>)}
    </span>
  );

  const item = (label: string, onClick: () => void, danger?: boolean, key?: string) => (
    <button key={key} onClick={() => { setMenu(null); onClick(); }} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-background ${danger ? "text-danger" : ""}`}>{label}</button>
  );

  return (
    <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b bg-background/40 px-4 py-2 lg:overflow-visible">
      {chip(
        <>All{onCopyAllForClaude && (
          // The whole client for Claude, like ✳ on each list (Derek, 2026-10-07).
          <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onCopyAllForClaude(); }}
            title="Copy every list for Claude" aria-label="Copy every list for Claude"
            className="-mr-0.5 hidden rounded px-0.5 text-[14px] leading-none opacity-60 hover:opacity-100 group-hover/chip:inline group-[.is-active]/chip:inline"><span aria-hidden>✳</span></span>
        )}</>,
        allActive, onSelectAll)}
      {folders.map((f) => chip(
        <><I.folder className="h-3.5 w-3.5" /> {f.name}</>,
        activeFolder === f.id,
        () => onSelectFolder(f.id),
        `folder:${f.id}`,
        <>
          {item("+ Add list", () => onCreateList(f.id))}
          {item("Rename folder", () => onRenameFolder(f.id))}
          {item("Delete folder", () => onDeleteFolder(f.id), true)}
        </>,
        { dim: dragFolder === f.id, onDragStart: () => setDragFolder(f.id), onDrop: () => dropFolder(f.id) },
      ))}
      {shownLists.map((l) => chip(
        <>
          {l.name}
          {/* Copy for Claude on the tab, Pin under ⋮ (Derek, 2026-10-07: "flip
              it"). Without the ⋮ menu the star stays here so it can still pin. */}
          {onCopyListForClaude && (
            <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onCopyListForClaude(l.id); }}
              title="Copy for Claude" aria-label={`Copy ${l.name} for Claude`}
              className="-mr-0.5 hidden rounded px-0.5 text-[14px] leading-none opacity-60 hover:opacity-100 group-hover/chip:inline group-[.is-active]/chip:inline"><span aria-hidden>✳</span></span>
          )}
          {!canAdmin && (
            <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onToggleStarList(l.id); }}
              title={starredLists.has(l.id) ? "Unpin from sidebar" : "Pin to sidebar"}
              className={`-mr-0.5 rounded p-0.5 ${starredLists.has(l.id) ? "text-amber-400" : "opacity-50 hover:opacity-100"}`}><I.star filled={starredLists.has(l.id)} /></span>
          )}
        </>,
        activeProject === l.id,
        () => onSelectList(l.id),
        `list:${l.id}`,
        <>
          {folders.length > 0 && <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Move to</div>}
          {folders.map((f) => item(f.name, () => onMoveList(l.id, f.id), false, f.id))}
          <div className="my-0.5 border-t" />
          {item(starredLists.has(l.id) ? "☆ Unpin from sidebar" : "★ Pin to sidebar", () => onToggleStarList(l.id))}
          {item("Rename list", () => onRenameList(l.id))}
          {item("Delete list", () => onDeleteList(l.id), true)}
        </>,
        { dim: dragList === l.id, onDragStart: () => setDragList(l.id), onDrop: () => dropList(l.id) },
      ))}
      {moreLists.length > 0 && (
        <span className="relative inline-flex shrink-0">
          <button onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}
            className="inline-flex items-center gap-1 rounded-[5px] border bg-surface px-3 py-1 text-[16px] font-medium text-muted hover:text-foreground">More {moreLists.length} ▾</button>
          {moreOpen && (<>
            <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
            <div className="absolute left-0 top-full z-40 mt-1 max-h-[60vh] w-56 overflow-y-auto rounded-lg border bg-surface p-1 shadow-soft-md">
              {moreLists.map((l) => (
                <button key={l.id} onClick={() => { setMoreOpen(false); onSelectList(l.id); }} className="block w-full rounded px-2 py-1.5 text-left text-[16px] hover:bg-background">{l.name}</button>
              ))}
            </div>
          </>)}
        </span>
      )}
      {canAdmin && (
        <span className="ml-1 inline-flex shrink-0 gap-1">
          {FOLDERS_ON && <button onClick={onCreateFolder} title="New folder" className="inline-flex items-center gap-1 rounded-[5px] border border-dashed px-2.5 py-1 text-[13px] text-muted hover:text-foreground"><I.folder className="h-3.5 w-3.5" /> +</button>}
          <button onClick={() => onCreateList(activeFolder)} title={activeFolder ? "New list in this folder" : "New list"} className="inline-flex items-center gap-1 rounded-[5px] border border-dashed px-2.5 py-1 text-[13px] text-muted hover:text-foreground"><I.plus className="h-3.5 w-3.5" /> List</button>
        </span>
      )}
      {/* ml-auto pushes it to the right edge once the row has room. Below lg
          the rail scrolls horizontally, where there is no free space to
          consume, so it trails the last pill instead of vanishing. */}
      {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      {onAddTask && !trailing && (
        <button onClick={onAddTask} title="Add a task to this list"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-[5px] border bg-surface px-2.5 py-1 text-[13px] font-semibold text-accent shadow-sm hover:bg-accent hover:text-white">
          <I.plus className="h-3.5 w-3.5" /> Add task
        </button>
      )}
    </div>
  );
}

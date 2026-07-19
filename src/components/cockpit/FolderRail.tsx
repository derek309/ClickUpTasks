"use client";

// The container rail at the top of a client's Tasks view: [All] · folders ·
// standalone lists · (admin) +Folder/+List. Selecting a folder scopes the task
// list to that folder's lists (grouped by list); selecting a standalone list
// scopes to just it. Admin chips carry a ⋮ menu (rename/delete/move).
import { useState } from "react";
import { type Folder, type Project } from "@/lib/data";
import { I } from "./ui";

export function FolderRail({
  folders, lists, activeFolder, activeProject, canAdmin, starredLists, onToggleStarList,
  onSelectAll, onSelectFolder, onSelectList,
  onCreateFolder, onCreateList, onRenameFolder, onDeleteFolder, onRenameList, onDeleteList, onMoveList,
  onReorderFolders, onReorderLists,
}: {
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
}) {
  const [menu, setMenu] = useState<string | null>(null); // "folder:<id>" | "list:<id>"
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [dragList, setDragList] = useState<string | null>(null);
  const standalone = lists.filter((l) => !l.folderId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
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
    <span className={`relative inline-flex shrink-0 ${drag?.dim ? "opacity-40" : ""}`}
      draggable={canAdmin && !!drag} onDragStart={drag?.onDragStart}
      onDragOver={(e) => { if (canAdmin && drag) e.preventDefault(); }} onDrop={(e) => { if (drag) { e.preventDefault(); drag.onDrop(); } }}>
      <button onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium ${active ? "border-accent bg-accent-soft text-accent" : "bg-surface text-muted hover:text-foreground"}`}>
        {label}
        {canAdmin && menuKey && (
          <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setMenu((m) => (m === menuKey ? null : menuKey)); }}
            className="-mr-1 hidden rounded p-0.5 opacity-60 hover:opacity-100 sm:inline-block"><I.dots className="h-3.5 w-3.5" /></span>
        )}
      </button>
      {menu === menuKey && menuKey && (<>
        <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />
        <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border bg-surface p-1 shadow-soft-md">{menuBody}</div>
      </>)}
    </span>
  );

  const item = (label: string, onClick: () => void, danger?: boolean) => (
    <button onClick={() => { setMenu(null); onClick(); }} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-background ${danger ? "text-danger" : ""}`}>{label}</button>
  );

  return (
    <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b bg-background/40 px-4 py-2 sm:flex-wrap sm:overflow-visible">
      {chip("All", allActive, onSelectAll)}
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
      {standalone.map((l) => chip(
        <>
          {l.name}
          <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onToggleStarList(l.id); }}
            title={starredLists.has(l.id) ? "Unpin from sidebar" : "Pin to sidebar"}
            className={`-mr-0.5 rounded p-0.5 ${starredLists.has(l.id) ? "text-amber-400" : "opacity-50 hover:opacity-100"}`}><I.star filled={starredLists.has(l.id)} /></span>
        </>,
        activeProject === l.id,
        () => onSelectList(l.id),
        `list:${l.id}`,
        <>
          {folders.length > 0 && <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Move to</div>}
          {folders.map((f) => item(f.name, () => onMoveList(l.id, f.id)))}
          <div className="my-0.5 border-t" />
          {item("Rename list", () => onRenameList(l.id))}
          {item("Delete list", () => onDeleteList(l.id), true)}
        </>,
        { dim: dragList === l.id, onDragStart: () => setDragList(l.id), onDrop: () => dropList(l.id) },
      ))}
      {canAdmin && (
        <span className="ml-1 inline-flex shrink-0 gap-1">
          <button onClick={onCreateFolder} title="New folder" className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[13px] text-muted hover:text-foreground"><I.folder className="h-3.5 w-3.5" /> +</button>
          <button onClick={() => onCreateList(activeFolder)} title={activeFolder ? "New list in this folder" : "New list"} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[13px] text-muted hover:text-foreground"><I.plus className="h-3.5 w-3.5" /> List</button>
        </span>
      )}
    </div>
  );
}

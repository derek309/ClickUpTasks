"use client";

// Full-page Projects directory — the "Projects" nav destination. Lists the
// workspace-level project lists (Administration, Idea board, etc. — the
// shared/internal lists not tied to a client), with search and an Add button.
// Clicking a row opens that project's task list.
//
// Read the way the task lists are now (Derek, 2026-10-14): 16px, 5px
// corners, a queue list says so under its name, and a list with tasks
// waiting on you says how many in red, the Needs you of the main list.
import { useState } from "react";
import { type Project } from "@/lib/data";
import { I, DIR_ROW } from "./ui";

export function ProjectsDirectory({
  projects, openCount, needsYouCount, onOpen, canAdmin, onAddProject, onRename, onDelete, starredLists, onToggleStarList,
}: {
  projects: Project[]; // workspace projects — sorted A-Z below regardless of caller order
  openCount: (id: string) => number;
  /** Tasks on the list whose current step needs you (data.ts needsYou). */
  needsYouCount?: (id: string) => number;
  onOpen: (id: string) => void;
  canAdmin: boolean;
  onAddProject: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  starredLists: Set<string>;              // per-user sidebar pins
  onToggleStarList: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const shown = query ? sorted.filter((p) => p.name.toLowerCase().includes(query)) : sorted;

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <I.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects"
            className="h-10 w-full rounded-[5px] border bg-surface pl-8 pr-3 text-[16px] outline-none focus:border-accent" />
        </div>
        {canAdmin && <button onClick={onAddProject} className="inline-flex h-10 items-center gap-1.5 rounded-[5px] bg-accent px-3 text-[16px] font-semibold text-white hover:opacity-90"><I.plus /> Add project</button>}
      </div>

      {/* Same flat, column-aligned list surface as the task lists. */}
      <div className="overflow-hidden rounded-[5px] border bg-surface shadow-soft">
        <div className="flex items-center gap-3 border-b bg-background/40 px-4 py-2 text-[16px] font-semibold text-muted">
          <span className="flex-1">Project</span>
          <span className="w-12 text-right">Open</span>
        </div>
        {shown.map((p) => {
          const needs = needsYouCount?.(p.id) ?? 0;
          return (
            <div key={p.id} onClick={() => onOpen(p.id)} className={`${DIR_ROW} min-h-[48px] py-2`}>
              <I.folder className="shrink-0 text-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[16px] font-medium">{p.name}</span>
                {(p.queue || needs > 0) && (
                  <span className="flex flex-wrap items-center gap-x-3 text-[16px] leading-snug">
                    {needs > 0 && <span className="font-semibold text-red-700">{needs} {needs === 1 ? "needs" : "need"} you</span>}
                    {p.queue && <span className="text-muted">Queue, {p.queue.now} at a time</span>}
                  </span>
                )}
              </span>
              <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onToggleStarList(p.id); }} title={starredLists.has(p.id) ? "Unpin from sidebar" : "Pin to sidebar"}
                className={`shrink-0 rounded-[5px] p-1 hover:bg-background ${starredLists.has(p.id) ? "text-amber-400" : "text-muted opacity-0 group-hover:opacity-100"}`}><I.star filled={starredLists.has(p.id)} /></span>
              {canAdmin && (<>
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onRename(p.id); }} title="Rename project" className="shrink-0 rounded-[5px] p-1 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"><I.pencil /></span>
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onDelete(p.id); }} title="Delete project" className="shrink-0 rounded-[5px] p-1 text-muted opacity-0 hover:bg-background hover:text-danger group-hover:opacity-100"><I.trash /></span>
              </>)}
              <span className="w-12 shrink-0 text-right text-[16px] tabular-nums text-muted">{openCount(p.id)}</span>
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="py-16 text-center text-[16px] text-muted">{query ? "No projects match your search." : "No projects yet. Add one with Add project."}</div>
        )}
      </div>
    </div>
  );
}

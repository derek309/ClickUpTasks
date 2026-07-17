"use client";

// Full-page Projects directory — the "Projects" nav destination. Lists the
// workspace-level project lists (Administration, Idea board, etc. — the
// shared/internal lists not tied to a client), with search and an Add button.
// Clicking a row opens that project's task list.
import { useState } from "react";
import { type Project } from "@/lib/data";
import { I } from "./ui";

export function ProjectsDirectory({
  projects, openCount, onOpen, canAdmin, onAddProject, onRename, onDelete,
}: {
  projects: Project[]; // workspace projects, in the caller's chosen order
  openCount: (id: string) => number;
  onOpen: (id: string) => void;
  canAdmin: boolean;
  onAddProject: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = query ? projects.filter((p) => p.name.toLowerCase().includes(query)) : projects;

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <I.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…"
              className="w-full rounded-lg border bg-surface py-2 pl-8 pr-3 text-[15px] outline-none focus:border-accent" />
          </div>
          {canAdmin && <button onClick={onAddProject} className="inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-2 text-[13px] font-medium text-white hover:opacity-90"><I.plus /> Add project</button>}
        </div>

        <div className="space-y-1.5">
          {shown.map((p) => (
            <button key={p.id} onClick={() => onOpen(p.id)}
              className="group flex w-full items-center gap-3 rounded-xl border bg-surface px-3.5 py-2.5 text-left transition hover:border-accent">
              <I.folder className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{p.name}</span>
              <span className="shrink-0 text-[13px] tabular-nums text-muted">{openCount(p.id)}</span>
              {canAdmin && (<>
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onRename(p.id); }} title="Rename project" className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"><I.pencil /></span>
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onDelete(p.id); }} title="Delete project" className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-background hover:text-danger group-hover:opacity-100"><I.trash /></span>
              </>)}
            </button>
          ))}
          {shown.length === 0 && (
            <div className="rounded-xl border border-dashed py-16 text-center text-[15px] text-muted">
              {query ? "No projects match your search." : "No projects yet — click Add project to create one."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

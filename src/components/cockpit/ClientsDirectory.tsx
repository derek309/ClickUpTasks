"use client";

// Full-page Clients directory — the "Clients" nav destination. Lists every
// client (sorted/scoped the same way the old sidebar section was), with a
// search box, the sort + Mine/All controls relocated from the sidebar, and an
// Add-client button. Clicking a row opens that client's task list.
import { useState } from "react";
import { clientStatusMeta, type Client } from "@/lib/data";
import { I } from "./ui";

type ClientSort = "manual" | "az" | "tasks" | "recent" | "used" | "urgent" | "mine";

export function ClientsDirectory({
  clients, clientCompany, taskCount, starred, onToggleStar, needsReview, onOpen,
  canAdmin, onAddClient, onRename, onDelete, sort, onSetSort, scope, onToggleScope,
}: {
  clients: Client[]; // already sorted + scoped by the caller
  clientCompany: (c: Client) => string;
  taskCount: (id: string) => number;
  starred: Set<string>;
  onToggleStar: (id: string) => void;
  needsReview: (id: string) => boolean;
  onOpen: (id: string) => void;
  canAdmin: boolean;
  onAddClient: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  sort: ClientSort;
  onSetSort: (s: ClientSort) => void;
  scope: "mine" | "all";
  onToggleScope: () => void;
}) {
  const [q, setQ] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const query = q.trim().toLowerCase();
  const shown = query ? clients.filter((c) => c.name.toLowerCase().includes(query) || clientCompany(c).toLowerCase().includes(query)) : clients;
  const sortLabels: [ClientSort, string][] = [["urgent", "Overdue first"], ["mine", "By my work"], ["used", "Recently used"], ["manual", "Manual"], ["az", "A → Z"], ["tasks", "Most active"], ["recent", "Recently added"]];

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <I.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…"
              className="w-full rounded-lg border bg-surface py-2 pl-8 pr-3 text-[15px] outline-none focus:border-accent" />
          </div>
          <button onClick={onToggleScope} title={scope === "mine" ? "Showing only clients with open work assigned to or followed by you" : "Showing every client"}
            className={`rounded-lg border px-2.5 py-2 text-[13px] font-medium ${scope === "mine" ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-surface"}`}>{scope === "mine" ? "My clients" : "All clients"}</button>
          <span className="relative">
            <button onClick={() => setSortOpen((o) => !o)} title="Sort" className="rounded-lg border px-2.5 py-2 text-muted hover:bg-surface"><I.list className="h-4 w-4" /></button>
            {sortOpen && (<>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border bg-surface p-1 shadow-soft-md">
                {sortLabels.map(([v, label]) => (
                  <button key={v} onClick={() => { onSetSort(v); setSortOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-background">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sort === v ? "bg-accent" : "bg-transparent"}`} />{label}
                  </button>
                ))}
              </div>
            </>)}
          </span>
          {canAdmin && <button onClick={onAddClient} className="inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-2 text-[13px] font-medium text-white hover:opacity-90"><I.plus /> Add client</button>}
        </div>

        <div className="space-y-1.5">
          {shown.map((c) => {
            const meta = clientStatusMeta(c.status);
            const count = taskCount(c.id);
            const company = clientCompany(c);
            const dim = c.status === "cancelled" || c.status === "past_client";
            return (
              <button key={c.id} onClick={() => onOpen(c.id)}
                className={`group flex w-full items-center gap-3 rounded-xl border bg-surface px-3.5 py-2.5 text-left transition hover:border-accent ${dim ? "opacity-60" : ""}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.dot }} title={meta.label} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 truncate text-[15px] font-medium">{c.name}
                    {needsReview(c.id) && <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-teal-600" style={{ background: "#14b8a61a" }}>Review</span>}
                  </span>
                  {company && <span className="block truncate text-[13px] text-muted">{company}</span>}
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted">{count}</span>
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onToggleStar(c.id); }} title={starred.has(c.id) ? "Unstar" : "Star"}
                  className={`shrink-0 rounded p-1 hover:bg-background ${starred.has(c.id) ? "text-amber-400" : "text-muted opacity-0 group-hover:opacity-100"}`}><I.star filled={starred.has(c.id)} /></span>
                {canAdmin && (<>
                  <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onRename(c.id); }} title="Rename client" className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"><I.pencil /></span>
                  <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} title="Remove client" className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-background hover:text-danger group-hover:opacity-100"><I.trash /></span>
                </>)}
              </button>
            );
          })}
          {shown.length === 0 && (
            <div className="rounded-xl border border-dashed py-16 text-center text-[15px] text-muted">
              {query ? "No clients match your search." : "No clients yet."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// Full-page Clients directory — the "Clients" nav destination. Lists every
// client (sorted/scoped the same way the old sidebar section was), grouped
// into colored, collapsible status sections — the same "colored strip"
// language TerritoryDirectory uses for its Claimed/Unclaimed buckets — with a
// search box, the sort + Mine/All controls relocated from the sidebar, and an
// Add-client button. Clicking a row opens that client's task list.
import { useState } from "react";
import { CLIENT_STATUS_ORDER, CLIENT_STATUS_META, formatDue, isOverdue, type ClientStatus, type Client, type Task } from "@/lib/data";
import { I } from "./ui";

type ClientSort = "manual" | "az" | "tasks" | "recent" | "used" | "urgent" | "mine";

export function ClientsDirectory({
  clients, clientCompany, taskCount, tasksByClient, starred, onToggleStar, needsReview, onOpen,
  canAdmin, onAddClient, onRename, onDelete, onSetStatus, sort, onSetSort, scope, onToggleScope,
}: {
  clients: Client[]; // already sorted + scoped by the caller
  clientCompany: (c: Client) => string;
  taskCount: (id: string) => number;
  // Open tasks per client, for the soonest-due badge in the Tasks column —
  // same map Cockpit already builds for the territory view's per-business
  // Tasks column (territoryTasksByClient), reused here rather than re-derived.
  tasksByClient?: Map<string, Task[]>;
  starred: Set<string>;
  onToggleStar: (id: string) => void;
  needsReview: (id: string) => boolean;
  onOpen: (id: string) => void;
  canAdmin: boolean;
  onAddClient: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onSetStatus: (id: string, status: ClientStatus) => void;
  sort: ClientSort;
  onSetSort: (s: ClientSort) => void;
  scope: "mine" | "all";
  onToggleScope: () => void;
}) {
  const [q, setQ] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [statusOpenId, setStatusOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<ClientStatus>>(new Set());
  const toggleGroup = (s: ClientStatus) => setCollapsed((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const query = q.trim().toLowerCase();
  const shown = query ? clients.filter((c) => c.name.toLowerCase().includes(query) || clientCompany(c).toLowerCase().includes(query)) : clients;
  const sortLabels: [ClientSort, string][] = [["urgent", "Overdue first"], ["mine", "By my work"], ["used", "Recently used"], ["manual", "Manual"], ["az", "A → Z"], ["tasks", "Most active"], ["recent", "Recently added"]];
  // Preserves the caller's sort order within each bucket — just partitions
  // `shown` by status rather than re-sorting. Empty buckets are skipped so
  // e.g. a workspace with no Cancelled clients doesn't show a bare "0" header.
  const groups = CLIENT_STATUS_ORDER.map((s) => ({ status: s, clients: shown.filter((c) => c.status === s) })).filter((g) => g.clients.length > 0);

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
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

      {/* Same flat, column-aligned list surface as the task lists, but
          bucketed into colored, collapsible status sections — the same
          language TerritoryDirectory uses for Claimed/Unclaimed — instead of
          one long undifferentiated list. */}
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="hidden items-center gap-3 border-b bg-background/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted sm:flex">
          <span className="flex-1">Client</span>
          <span className="w-32">Status</span>
          <span className="w-28 text-right">Tasks</span>
        </div>
        <div className="divide-y-8 divide-background">
          {groups.map((g) => {
            const meta = CLIENT_STATUS_META[g.status];
            const isOpen = !collapsed.has(g.status);
            return (
              <div key={g.status}>
                <button onClick={() => toggleGroup(g.status)} className="flex w-full items-center gap-2 border-y px-4 py-2 text-left transition" style={{ background: meta.dot + "22", borderColor: meta.dot + "40" }}>
                  <I.chevron className={`text-muted transition ${isOpen ? "-rotate-90" : "rotate-180"}`} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.dot }} />
                  <span className="text-[15px] font-bold">{meta.label}</span>
                  <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: meta.dot }}>{g.clients.length}</span>
                </button>
                {isOpen && g.clients.map((c) => {
                  const count = taskCount(c.id);
                  const company = clientCompany(c);
                  const openTasks = tasksByClient?.get(c.id) ?? [];
                  const nextDue = openTasks.reduce<string | null>((soonest, t) => (t.due && (!soonest || t.due < soonest) ? t.due : soonest), null);
                  return (
                    <div key={c.id} onClick={() => onOpen(c.id)}
                      className="group flex min-h-[46px] cursor-pointer items-center gap-3 border-b px-4 py-2 transition-colors last:border-0 hover:bg-accent-soft/50">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.dot }} title={meta.label} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 truncate text-[15px] font-medium">{c.name}
                          {needsReview(c.id) && <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-teal-600" style={{ background: "#14b8a61a" }}>Review</span>}
                        </span>
                        {company && <span className="block truncate text-[13px] text-muted">{company}</span>}
                      </span>
                      {/* Status pill — admins can change it inline (e.g. to move
                          a client into a different group) without opening it. */}
                      <span className="relative hidden w-32 shrink-0 sm:block" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => canAdmin && setStatusOpenId((v) => (v === c.id ? null : c.id))} disabled={!canAdmin}
                          title={canAdmin ? "Change status" : meta.label}
                          className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[12px] font-medium ${canAdmin ? "hover:bg-background" : "cursor-default"}`}>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.dot }} /> <span className="truncate">{meta.label}</span>
                        </button>
                        {statusOpenId === c.id && (<>
                          <div className="fixed inset-0 z-30" onClick={() => setStatusOpenId(null)} />
                          <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg border bg-surface p-1 shadow-soft-md">
                            {CLIENT_STATUS_ORDER.map((s) => (
                              <button key={s} onClick={() => { onSetStatus(c.id, s); setStatusOpenId(null); }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-background">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: CLIENT_STATUS_META[s].dot }} />{CLIENT_STATUS_META[s].label}
                                {c.status === s && <I.check className="ml-auto h-3.5 w-3.5 text-accent" />}
                              </button>
                            ))}
                          </div>
                        </>)}
                      </span>
                      <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onToggleStar(c.id); }} title={starred.has(c.id) ? "Unstar" : "Star"}
                        className={`shrink-0 rounded p-1 hover:bg-background ${starred.has(c.id) ? "text-amber-400" : "text-muted opacity-0 group-hover:opacity-100"}`}><I.star filled={starred.has(c.id)} /></span>
                      {canAdmin && (<>
                        <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onRename(c.id); }} title="Rename client" className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"><I.pencil /></span>
                        <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} title="Remove client" className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-background hover:text-danger group-hover:opacity-100"><I.trash /></span>
                      </>)}
                      <span className="w-28 shrink-0 text-right text-[13px] text-muted">
                        {count > 0 ? <span className="tabular-nums">{count} open</span> : <span className="text-muted/50">—</span>}
                        {nextDue && <span className={`ml-1 ${isOverdue(nextDue) ? "font-medium text-danger" : ""}`}>{formatDue(nextDue)}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <div className="py-16 text-center text-[15px] text-muted">{query ? "No clients match your search." : "No clients yet."}</div>
        )}
      </div>
    </div>
  );
}

"use client";

// "Completed" — who finished what, and when. Lives under My Work (moved
// from the Clients directory, Derek: "makes more sense there"). A flat,
// day-grouped feed: task, client, who completed it, and the time — the only
// filter is who completed it, on purpose (Derek: "that's it, simple clean").
import { useMemo, useState } from "react";
import { timeAgo } from "@/lib/data";
import { I } from "./ui";

export type CompletionRow = { id: string; taskId: string; taskTitle: string; clientId: string; clientName: string; authorId: string; authorName: string; authorColor: string; authorInitials: string; at: string };

// authorId, when given, is the caller answering "whose" for us — All Tasks
// asks it in its own header dropdown, and the log's picker beneath would be
// the same question a second time.
export function CompletedLog({ rows, authorId = null, onOpenTask }: { rows: CompletionRow[]; authorId?: string | null; onOpenTask?: (clientId: string, taskId: string) => void }) {
  const [q, setQ] = useState("");
  const [completedBy, setCompletedBy] = useState<string>("all");
  const who = authorId ?? completedBy;

  const query = q.trim().toLowerCase();
  const matches = (r: CompletionRow) => !query || r.taskTitle.toLowerCase().includes(query) || r.clientName.toLowerCase().includes(query);
  const shown = useMemo(() => rows.filter((r) => (who === "all" || r.authorId === who) && matches(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, who, query]);

  // Doesn't depend on the search query at all — rebuilding it on every
  // keystroke was wasted work.
  const completedByOptions = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.authorId, { id: r.authorId, name: r.authorName, color: r.authorColor }])).values())
      .sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );

  // Grouped by calendar day. `rows` arrives already sorted most-recent-first,
  // so a Map preserves that order for both the days and the rows within each.
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const dayLabel = (key: string) => key === today ? "Today" : key === yesterday ? "Yesterday" : new Date(key).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const dayGroups = useMemo(() => {
    const map = new Map<string, CompletionRow[]>();
    for (const r of shown) {
      const key = new Date(r.at).toDateString();
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    return Array.from(map.entries());
  }, [shown]);

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <I.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search completed tasks…"
            className="w-full rounded-lg border bg-surface py-2 pl-8 pr-3 text-[15px] outline-none focus:border-accent" />
        </div>
        {!authorId && completedByOptions.length > 0 && (
          <select value={completedBy} onChange={(e) => setCompletedBy(e.target.value)} title="Filter by who completed it"
            className="rounded-lg border bg-surface px-2.5 py-2 text-[13px] font-medium outline-none focus:border-accent">
            <option value="all">Everyone</option>
            {completedByOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="divide-y-8 divide-background">
          {dayGroups.map(([key, dayRows]) => (
            <div key={key}>
              <div className="flex items-center gap-2 border-y bg-background/40 px-4 py-2">
                <span className="text-[13px] font-bold">{dayLabel(key)}</span>
                <span className="rounded-[5px] bg-border px-1.5 text-[12px] font-semibold text-foreground">{dayRows.length}</span>
              </div>
              {dayRows.map((r) => (
                <div key={r.id} onClick={() => onOpenTask?.(r.clientId, r.taskId)}
                  className="flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 transition-colors last:border-0 hover:bg-accent-soft/50">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: r.authorColor }} title={r.authorName}>{r.authorInitials}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium">{r.taskTitle}</span>
                    <span className="block truncate text-[12.5px] text-muted">{r.clientName} &middot; {r.authorName}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-muted" title={timeAgo(r.at)}>
                    {new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {dayGroups.length === 0 && (
            <div className="py-16 text-center text-[15px] text-muted">
              {query || completedBy !== "all" ? "No completions match." : "Nothing completed yet — this fills in as tasks get marked done."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

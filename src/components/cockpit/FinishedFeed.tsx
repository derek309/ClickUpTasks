"use client";

// "Finished" — everything that came to an end, and when. Lives as an All Tasks
// mode (moved from My Work, Derek: "makes more sense there"). A flat,
// day-grouped feed: what finished, on whose task, who finished it, the time.
//
// It began as a log of tasks marked done, and Derek, 2026-09-18: "now that we
// have delegate tasks and clients review and approve I'm finding it hard to go
// find what's being completed or approved". Those are the other two ways work
// ends, so they belong in the same list. What each one is shows as a word on
// the row rather than as three separate screens.
//
// Two filters, and they are different questions on purpose. The All Tasks
// header's scope answers WHOSE WORK, by the task's owner, the same as it does
// on the list behind this. The picker here answers WHO FINISHED IT, which on a
// client approval is the client, not anyone on the team.
import { Fragment, useMemo, useState } from "react";
import { timeAgo, type FinishKind } from "@/lib/data";
import { I } from "./ui";

export type CompletionRow = {
  id: string; taskId: string; taskTitle: string; clientId: string; clientName: string;
  /** Who finished it: a teammate, or the client on an approval of theirs. */
  authorId: string; authorName: string; authorColor: string; authorInitials: string;
  /** Whose task it is, which the All Tasks scope filters on. */
  ownerId: string | null;
  kind: FinishKind;
  at: string;
};

// What each kind is called on its row. A client approving is the one worth
// spotting, so it is the one with colour.
const KIND_LABEL: Record<FinishKind, { label: string; tone: string }> = {
  completed: { label: "Completed", tone: "bg-background text-muted" },
  client_approved: { label: "Client approved", tone: "bg-emerald-50 text-emerald-700" },
  team_approved: { label: "We approved", tone: "bg-background text-muted" },
  handoff: { label: "Handoff done", tone: "bg-accent-soft text-accent" },
};

// ownerId, when given, is the caller answering "whose" for us — All Tasks asks
// it in its own header dropdown, and a picker beneath would be the same
// question a second time.
const LOADED_ON = new Date();

export function FinishedFeed({ rows, ownerId = null, seenAt = null, onOpenTask }: {
  rows: CompletionRow[];
  ownerId?: string | null;
  /** When this person last looked, frozen for the visit. Anything newer gets
   *  the line above it. Null on a first ever visit, when everything is new and
   *  a line saying so would be noise. */
  seenAt?: string | null;
  onOpenTask?: (clientId: string, taskId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [finishedBy, setFinishedBy] = useState<string>("all");

  // Newer than the moment they last looked. Unknown rows are not new: the
  // marker should never claim something arrived when nothing says it did.
  const isNew = (r: CompletionRow | undefined) => !!seenAt && !!r && r.at > seenAt;

  const query = q.trim().toLowerCase();
  const matches = (r: CompletionRow) => !query || r.taskTitle.toLowerCase().includes(query) || r.clientName.toLowerCase().includes(query);
  const shown = useMemo(
    () => rows.filter((r) => (ownerId === null || r.ownerId === ownerId) && (finishedBy === "all" || r.authorId === finishedBy) && matches(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, ownerId, finishedBy, query],
  );

  // Doesn't depend on the search query at all — rebuilding it on every
  // keystroke was wasted work.
  const finishedByOptions = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.authorId, { id: r.authorId, name: r.authorName }])).values())
      .sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );

  // Grouped by calendar day. `rows` arrives already sorted most-recent-first,
  // so a Map preserves that order for both the days and the rows within each.
  // Both from the day the app was loaded, not from the clock at render time:
  // reading the clock in render is impure, and Cockpit reloads the page when
  // the date rolls over, so a window left open overnight relabels anyway.
  const today = LOADED_ON.toDateString();
  const yesterday = new Date(LOADED_ON.getTime() - 86400000).toDateString();
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what finished…"
            className="w-full rounded-lg border bg-surface py-2 pl-8 pr-3 text-[16px] outline-none focus:border-accent" />
        </div>
        {finishedByOptions.length > 1 && (
          <select value={finishedBy} onChange={(e) => setFinishedBy(e.target.value)} title="Filter by who finished it"
            className="rounded-lg border bg-surface px-2.5 py-2 text-[16px] font-medium outline-none focus:border-accent">
            <option value="all">Anyone</option>
            {finishedByOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="divide-y-8 divide-background">
          {dayGroups.map(([key, dayRows]) => (
            <div key={key}>
              <div className="flex items-center gap-2 border-y bg-background/40 px-4 py-2">
                <span className="text-[16px] font-bold">{dayLabel(key)}</span>
                <span className="rounded-[5px] bg-border px-1.5 text-[16px] font-semibold text-foreground">{dayRows.length}</span>
              </div>
              {dayRows.map((r, i) => (
                <Fragment key={r.id}>
                {/* Rows read newest first, so the line sits under the last one
                    that is new: everything above it arrived since you looked.
                    Only on the boundary, and only when there is something on
                    both sides of it. */}
                {isNew(r) && !isNew(dayRows[i + 1]) && i + 1 < dayRows.length && (
                  <div className="flex items-center gap-3 px-4 py-2" role="separator">
                    <span className="h-px flex-1 bg-accent/40" />
                    <span className="shrink-0 text-[16px] font-semibold text-accent">New since you last looked</span>
                    <span className="h-px flex-1 bg-accent/40" />
                  </div>
                )}
                <div onClick={() => onOpenTask?.(r.clientId, r.taskId)}
                  className="flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 transition-colors last:border-0 hover:bg-accent-soft/50">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-white" style={{ background: r.authorColor }} title={r.authorName}>{r.authorInitials}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-medium">{r.taskTitle}</span>
                    <span className="block truncate text-[16px] text-muted">{r.clientName} &middot; {r.authorName}</span>
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[16px] font-medium ${KIND_LABEL[r.kind].tone}`}>{KIND_LABEL[r.kind].label}</span>
                  <span className="shrink-0 text-[16px] text-muted" title={timeAgo(r.at)}>
                    {new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                </Fragment>
              ))}
            </div>
          ))}
          {dayGroups.length === 0 && (
            <div className="py-16 text-center text-[16px] text-muted">
              {query || finishedBy !== "all" ? "Nothing matches." : "Nothing finished yet. Tasks marked done, reviews the client approves and handoffs your team finishes all land here."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

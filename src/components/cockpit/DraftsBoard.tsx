"use client";

// "Drafts" — everything written and not sent, across every client at once.
//
// An email in progress lives in one of three places and none of them was a list
// you could look at: on a task, on a client, or queued to go later. A draft you
// abandoned halfway was invisible until you happened to reopen the exact task
// or client it was written on, which is how a half written reply sits for a
// week and how a reminder the AI drafted for you is never read at all.
//
// Two groups, because they ask for opposite things: what is queued goes out on
// its own and wants leaving alone, what is a draft needs someone to finish it
// or throw it away. Drafts read OLDEST first, the same reasoning as the Reviews
// board, so the forgotten one is at the top.
import { I } from "./ui";
import { type PendingSend, type PendingSendGroups } from "@/lib/pendingSends";
import { waitedFor } from "@/lib/elapsed";

export type DraftsBoardProps = {
  groups: PendingSendGroups;
  loading: boolean;
  /** Where a row belongs, or null when its task or client is not loaded. */
  rowContext: (row: PendingSend) => { clientName: string; taskTitle: string | null } | null;
  /** Open the task it is on, or the client it belongs to. */
  onOpen: (row: PendingSend) => void;
  onRefresh: () => void;
};

// Which of the two places a draft was written. A scheduled row gets none: its
// group already says it is queued, and the line underneath names its client and
// task, so a "Queued" badge would only repeat the heading above it.
const WHERE: Partial<Record<PendingSend["kind"], string>> = {
  task_draft: "On a task",
  client_draft: "On the client",
};

/** A scheduled send says when it goes, because that is the question. A draft
 *  says how long it has sat, because that is. */
function when(row: PendingSend): string {
  if (row.kind !== "scheduled") return waitedFor(row.days);
  const d = new Date(row.at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function Row({ row, context, onOpen }: { row: PendingSend; context: { clientName: string; taskTitle: string | null } | null; onOpen: () => void }) {
  const where = context
    ? [context.clientName, context.taskTitle].filter(Boolean).join(" · ")
    : "On something you cannot see";
  return (
    // Same shape as the Reviews board: the chips sit under the heading on a
    // phone and beside it from the small breakpoint up.
    <button type="button" onClick={onOpen}
      className="flex w-full flex-col gap-1.5 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50 sm:flex-row sm:items-center sm:gap-3">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full truncate text-[16px] font-medium">{row.subject}</span>
          {row.channel === "sms" && <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[16px] text-muted">Text</span>}
          {WHERE[row.kind] && <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[16px] text-muted">{WHERE[row.kind]}</span>}
        </span>
        {row.preview && <span className="mt-0.5 block truncate text-[16px] text-muted">{row.preview}</span>}
        <span className="mt-0.5 block truncate text-[16px] text-muted">{where}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {row.overdue && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-[16px] font-medium text-amber-700"
            title="This was due to go already and is still sitting here">
            Overdue
          </span>
        )}
        <span className={`text-right text-[16px] ${row.overdue ? "font-semibold text-amber-700" : "text-muted"}`}>{when(row)}</span>
      </span>
    </button>
  );
}

function Group({ title, help, rows, rowContext, onOpen }: {
  title: string; help: string; rows: PendingSend[];
  rowContext: DraftsBoardProps["rowContext"]; onOpen: DraftsBoardProps["onOpen"];
}) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
      <div className="flex items-center gap-2 border-b bg-background/40 px-4 py-2.5">
        <span className="text-[17px] font-bold">{title}</span>
        <span className="rounded-[5px] bg-border px-1.5 text-[16px] font-semibold text-foreground">{rows.length}</span>
        <span className="ml-2 hidden truncate text-[16px] text-muted sm:inline">{help}</span>
      </div>
      {rows.map((row) => <Row key={row.id} row={row} context={rowContext(row)} onOpen={() => onOpen(row)} />)}
    </div>
  );
}

export function DraftsBoard({ groups, loading, rowContext, onOpen, onRefresh }: DraftsBoardProps) {
  const total = groups.scheduled.length + groups.drafts.length;
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[16px] text-muted">
          {loading ? "Checking what is waiting…"
            : total === 0 ? "Nothing written and unsent."
            : `${total} written and not sent.`}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={onRefresh} disabled={loading} title="Check again"
          className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] font-medium text-muted hover:text-foreground disabled:opacity-50">
          <I.repeat className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <Group title="Scheduled to send" help="Soonest first. These go on their own." rows={groups.scheduled} rowContext={rowContext} onOpen={onOpen} />
        <Group title="Drafts" help="Longest untouched first. These need you." rows={groups.drafts} rowContext={rowContext} onOpen={onOpen} />
        {!loading && total === 0 && (
          <div className="rounded-xl border bg-surface py-16 text-center text-[16px] text-muted shadow-soft">
            Nothing is written and waiting. Drafts and scheduled sends appear here until they go out.
          </div>
        )}
      </div>
    </div>
  );
}

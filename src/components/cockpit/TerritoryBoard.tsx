"use client";

// Territory Dashboard's ("Follow Up") presentational layer — deliberately
// the same component shape as ClientsBoard.tsx, not a variant of it: one
// card, colored tier-header bands with a count pill, rows that are a single
// scannable line (status dot, initials circle, name over a subtitle,
// right-aligned meta), click straight through to that business's task list.
//
// Big pivot #1 (Derek, 2026-08-08): this used to own an inline expand-per-row
// panel — Call Now/Send Email/SMS/Book Meeting, a touch logger, a follow-up
// composer, all living right here. None of that anymore — click a row, land
// on the task list, click a task, leave your note there. That tooling moved
// to (and stayed on) the Businesses page, a separate thing on purpose.
//
// Big pivot #2 (Derek, 2026-08-09): every row now always has a real Client
// behind it — engagement signals create their Conversation task server-side,
// at the moment they happen (see TerritoryDashboard.tsx's own header
// comment), not lazily when this page happens to be open. So there's no more
// "prospect with no Client yet" case to fall back from — every row is just
// onOpenClient, same as ClientsBoard's own ClientRow, no second navigation
// path to maintain.
import { type Client, type playbookCompletion } from "@/lib/data";

export interface BusinessRow {
  id: string; // always a real Client id
  name: string;
  city: string;
  stageLabel: string;
  stageColor: string;
  client: Client;
  playbook: ReturnType<typeof playbookCompletion> | null;
  // Right-column trigger text — why this row earned its spot. Whenever an
  // open Conversation task is why, this is that task's own title (e.g.
  // "Clicked the invite email — call or visit to close"), not a generic
  // placeholder — the task's title IS the "very clear" part.
  meta: string | null;
  metaDanger?: boolean;
}

export interface TerritoryBoardGroup {
  key: string;
  label: string;
  color: string;
  rows: BusinessRow[];
}

const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

export function TerritoryBoard({ groups, onOpenClient }: {
  groups: TerritoryBoardGroup[];
  onOpenClient: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {groups.length === 0 && (
          <div className="px-4 py-10 text-center text-[16px] text-muted">
            Nothing needs you right now. Every territory you&apos;re assigned to is caught up.
          </div>
        )}
        <div className="divide-y-8 divide-background">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 border-y px-4 py-2" style={{ background: g.color + "22", borderColor: g.color + "40" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[17px] font-bold">{g.label}</span>
                <span className="rounded-full px-1.5 text-[16px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.rows.length}</span>
              </div>
              <div>
                {g.rows.map((row) => (
                  <BusinessRowView key={row.id} row={row} onOpen={() => onOpenClient(row.client.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusinessRowView({ row, onOpen }: { row: BusinessRow; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" title={row.stageLabel} style={{ background: row.stageColor }} />
      <span className="h-8 w-8 shrink-0 rounded-full text-center text-[16px] font-semibold leading-8 text-white" style={{ background: row.stageColor }}>
        {initialsOf(row.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[17px] font-medium leading-snug">{row.name}</span>
        <span className="truncate text-[16px] text-muted">{row.city} · {row.stageLabel}</span>
      </span>
      {row.playbook && (
        <span className="shrink-0 rounded-md border px-2 py-1 text-[16px] font-medium text-muted">
          Playbook {row.playbook.doneCount}/{row.playbook.total}
        </span>
      )}
      {row.meta && (
        <span className={`shrink-0 truncate text-right text-[16px] ${row.metaDanger ? "font-medium text-danger" : "text-muted"}`} title={row.meta}>{row.meta}</span>
      )}
    </button>
  );
}

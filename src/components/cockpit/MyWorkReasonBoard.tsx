"use client";

// Phase 2, 2.2: My Work reshaped around a reason, not a date tier. A client
// appears only if it has a reason — the reason IS the row's content (a
// colored edge, who, the reason in words, age, one action matched to it).
// Never a generic "View". Waiting-on-your-reply is deliberately not built
// here — see the phase-2 pass-1 report: without an isAutomated signal, a
// raw inbound/outbound check flagged 45% of active clients in a spot-check
// against live data, which is worse than not shipping it. "Needs review"
// takes its place as a third reason (existing clientNeedsReview logic,
// unrelated to messages) rather than dropping a real, already-used signal.
import { clientStatusMeta, type Client } from "@/lib/data";
import { I } from "./ui";

export type ClientReasonKind = "overdue" | "review" | "quiet";

export interface ClientReasonRow {
  client: Client;
  kind: ClientReasonKind;
  reasonText: string;
  ageDays: number;
}

const REASON_META: Record<ClientReasonKind, { label: string; color: string; action: string }> = {
  overdue: { label: "Overdue work", color: "#ef4444", action: "Open" },
  review: { label: "Needs review", color: "#14b8a6", action: "Open" },
  quiet: { label: "Going quiet", color: "#94a3b8", action: "Check in" },
};

export function MyWorkReasonBoard({ rows, clearClients, onOpenClient, onCheckIn }: {
  rows: ClientReasonRow[];
  // Collapsed into one row with an avatar stack + count, per spec — no
  // per-client detail once there's no reason to show.
  clearClients: Client[];
  onOpenClient: (id: string) => void;
  onCheckIn: (id: string) => void;
}) {
  const groups: { kind: ClientReasonKind; rows: ClientReasonRow[] }[] = (["overdue", "review", "quiet"] as const)
    .map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) }))
    .filter((g) => g.rows.length > 0);

  if (groups.length === 0 && clearClients.length === 0) {
    return <div className="px-4 py-10 text-center text-[13px] text-muted">No clients assigned yet.</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
      <div className="divide-y-8 divide-background">
        {groups.map((g) => {
          const meta = REASON_META[g.kind];
          return (
            <div key={g.kind}>
              <div className="flex items-center gap-2 border-y px-4 py-2" style={{ background: meta.color + "22", borderColor: meta.color + "40" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                <span className="text-[15px] font-bold">{meta.label}</span>
                <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: meta.color }}>{g.rows.length}</span>
              </div>
              <div>
                {g.rows.map((r) => (
                  <ReasonRow key={r.client.id} row={r} meta={meta}
                    onOpen={() => onOpenClient(r.client.id)}
                    onAction={() => (r.kind === "quiet" ? onCheckIn(r.client.id) : onOpenClient(r.client.id))} />
                ))}
              </div>
            </div>
          );
        })}
        {clearClients.length > 0 && (
          <div>
            <div className="flex items-center gap-2 border-y px-4 py-2" style={{ background: "#22c55e22", borderColor: "#22c55e40" }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#22c55e" }} />
              <span className="text-[15px] font-bold">All clear</span>
              <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: "#22c55e" }}>{clearClients.length}</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="flex items-center -space-x-2">
                {clearClients.slice(0, 8).map((c) => (
                  <span key={c.id} title={c.name} className="h-7 w-7 shrink-0 rounded-full border-2 border-surface text-center text-[11px] font-semibold leading-[26px] text-white" style={{ background: c.color }}>
                    {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                ))}
              </div>
              <span className="text-[14px] text-muted">{clearClients.length} client{clearClients.length === 1 ? "" : "s"} with nothing outstanding.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReasonRow({ row, meta, onOpen, onAction }: { row: ClientReasonRow; meta: { label: string; color: string; action: string }; onOpen: () => void; onAction: () => void }) {
  const c = row.client;
  return (
    <div className="flex w-full items-center gap-3 border-b border-l-[3px] px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50" style={{ borderLeftColor: meta.color }}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" title={clientStatusMeta(c.status).label} style={{ background: clientStatusMeta(c.status).dot }} />
        <span className="h-8 w-8 shrink-0 rounded-full text-center text-[13px] font-semibold leading-8 text-white" style={{ background: c.color }}>
          {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-medium leading-snug">{c.name}</span>
          <span className="truncate text-[13px] text-muted" title={row.reasonText}>{row.reasonText}</span>
        </span>
      </button>
      <span className="shrink-0 text-[13px] text-muted">{row.ageDays}d</span>
      <button onClick={onAction} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-[13px] font-medium hover:bg-background" style={{ borderColor: meta.color + "60", color: meta.color }}>
        {row.kind === "quiet" && <I.comment className="h-3.5 w-3.5" />} {meta.action}
      </button>
    </div>
  );
}

// Small strip above the board, same vocabulary as the client record and the
// reason groups themselves — one glance at counts before scanning rows.
export function MyWorkSignalStrip({ overdue, review, quiet, clear }: { overdue: number; review: number; quiet: number; clear: number }) {
  const cells: { label: string; count: number; color: string }[] = [
    { label: "Overdue", count: overdue, color: "#ef4444" },
    { label: "Needs review", count: review, color: "#14b8a6" },
    { label: "Going quiet", count: quiet, color: "#94a3b8" },
    { label: "All clear", count: clear, color: "#22c55e" },
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-xl border bg-surface px-3 py-2">
          <div className="text-[22px] font-bold leading-none" style={{ color: cell.count > 0 ? cell.color : undefined }}>{cell.count}</div>
          <div className="mt-0.5 text-[12px] text-muted">{cell.label}</div>
        </div>
      ))}
    </div>
  );
}

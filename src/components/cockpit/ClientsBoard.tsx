"use client";

// "My Clients" — the same grouped-list visual language as My Work, but the
// rows are clients, not tasks, grouped by the same urgency tiers that drive
// the sidebar's "Overdue first" sort: a client who's messaged and is waiting
// on a reply comes first, then overdue work, then due today, and so on.
import { clientStatusMeta, type Client } from "@/lib/data";
import { I } from "./ui";

export interface ClientBoardGroup {
  key: string;
  label: string;
  color: string;
  clients: Client[];
}

export function ClientsBoard({ groups, clientTaskCount, hasUnreadMessage, onOpen }: {
  groups: ClientBoardGroup[];
  clientTaskCount: (id: string) => number;
  hasUnreadMessage: (id: string) => boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {groups.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No clients yet.</div>}
        <div className="divide-y-8 divide-background">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 border-y px-4 py-2" style={{ background: g.color + "22", borderColor: g.color + "40" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[15px] font-bold">{g.label}</span>
                <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.clients.length}</span>
              </div>
              <div>
                {g.clients.map((c) => (
                  <ClientRow key={c.id} client={c} taskCount={clientTaskCount(c.id)} unread={hasUnreadMessage(c.id)} onOpen={() => onOpen(c.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientRow({ client, taskCount, unread, onOpen }: {
  client: Client; taskCount: number; unread: boolean; onOpen: () => void;
}) {
  // Business name lives in ghlLocationId for GHL-synced clients (repurposed
  // field, same as the sidebar/header use via clientCompany).
  const business = client.id.startsWith("cl_") ? (client.ghlLocationId ?? "") : "";
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" title={clientStatusMeta(client.status).label} style={{ background: clientStatusMeta(client.status).dot }} />
      <span className="h-8 w-8 shrink-0 rounded-full text-center text-[13px] font-semibold leading-8 text-white" style={{ background: client.color }}>
        {client.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-[17px] font-medium leading-snug">{client.name}</span>
        {unread && <span title="New message — waiting on a reply"><I.comment className="shrink-0 text-accent" /></span>}
      </span>
      {business && <span className="hidden w-56 shrink-0 truncate text-[13px] text-muted sm:block" title={business}>{business}</span>}
      <span className="w-16 shrink-0 text-right text-[13px] text-muted">{taskCount} task{taskCount === 1 ? "" : "s"}</span>
    </button>
  );
}

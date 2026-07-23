"use client";

// "My Work" — the same grouped-list visual language as the old My Work tab,
// but the rows are clients and projects (not tasks), grouped by the same
// urgency tiers that drive the sidebar's "Overdue first" sort: a client
// who's messaged and is waiting on a reply comes first, then overdue work,
// then due today, and so on. Clients and projects are interleaved together
// within each tier, not split into separate sections — a project qualifies
// (and sorts) exactly the same way a client does.
import { clientStatusMeta, formatDue, isOverdue, type Client, type Project, type Task } from "@/lib/data";
import { I } from "./ui";

// A personal to-do isn't a client or project — it's its own thing, so it
// gets its own row in the tier it earns rather than being folded into one
// "Personal" project tile (which used to hide e.g. an overdue personal task
// behind a single undifferentiated bucket).
export type WorkItem = { kind: "client"; client: Client } | { kind: "project"; project: Project; clientName: string } | { kind: "task"; task: Task };

export interface WorkBoardGroup {
  key: string;
  label: string;
  color: string;
  items: WorkItem[];
}

export function ClientsBoard({ groups, clientTaskCount, projectTaskCount, hasUnreadMessage, onOpenClient, onOpenProject, onOpenTask }: {
  groups: WorkBoardGroup[];
  clientTaskCount: (id: string) => number;
  projectTaskCount: (id: string) => number;
  hasUnreadMessage: (id: string) => boolean;
  onOpenClient: (id: string) => void;
  onOpenProject: (id: string) => void;
  onOpenTask: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {groups.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">Nothing here yet.</div>}
        <div className="divide-y-8 divide-background">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 border-y px-4 py-2" style={{ background: g.color + "22", borderColor: g.color + "40" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[15px] font-bold">{g.label}</span>
                <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.items.length}</span>
              </div>
              <div>
                {g.items.map((it) => it.kind === "client"
                  ? <ClientRow key={`c:${it.client.id}`} client={it.client} taskCount={clientTaskCount(it.client.id)} unread={hasUnreadMessage(it.client.id)} onOpen={() => onOpenClient(it.client.id)} />
                  : it.kind === "project"
                  ? <ProjectRow key={`p:${it.project.id}`} project={it.project} clientName={it.clientName} taskCount={projectTaskCount(it.project.id)} onOpen={() => onOpenProject(it.project.id)} />
                  : <TaskRow key={`t:${it.task.id}`} task={it.task} onOpen={() => onOpenTask(it.task.id)} />
                )}
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
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[17px] font-medium leading-snug">{client.name}</span>
          {unread && <span title="New message — waiting on a reply"><I.comment className="shrink-0 text-accent" /></span>}
        </span>
        {business && <span className="truncate text-[14px] font-medium text-muted" title={business}>{business}</span>}
      </span>
      <span className="w-16 shrink-0 text-right text-[13px] text-muted">{taskCount} task{taskCount === 1 ? "" : "s"}</span>
    </button>
  );
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-muted"><I.check /></span>
      <span className="min-w-0 flex-1 truncate text-[17px] font-medium leading-snug">{task.title}</span>
      {task.due && <span className={`shrink-0 text-[13px] ${isOverdue(task.due) ? "font-medium text-danger" : "text-muted"}`}>{formatDue(task.due)}</span>}
    </button>
  );
}

function ProjectRow({ project, clientName, taskCount, onOpen }: {
  project: Project; clientName: string; taskCount: number; onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-muted"><I.folder /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[17px] font-medium leading-snug">{project.name}</span>
        <span className="truncate text-[13px] text-muted">{clientName}</span>
      </span>
      <span className="w-16 shrink-0 text-right text-[13px] text-muted">{taskCount} task{taskCount === 1 ? "" : "s"}</span>
    </button>
  );
}

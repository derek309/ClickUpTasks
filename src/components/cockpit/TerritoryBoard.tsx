"use client";

// Territory Dashboard's presentational layer — same visual language as
// ClientsBoard.tsx (one card, colored tier-header bands with a count pill,
// flat clickable rows), but rows are claimed+ businesses instead of
// clients/projects/tasks, and each row carries a "Log a follow-up" action
// TerritoryDashboard.tsx wires up.
import { useState } from "react";
import { formatDue, timeAgo, htmlToText, playbookCompletion, type Client } from "@/lib/data";
import { I } from "./ui";

export interface BusinessRow {
  client: Client;
  city: string;
  stageLabel: string;
  stageColor: string;
  playbook: ReturnType<typeof playbookCompletion>;
  lastTouch: { authorName: string; body: string; at: string } | null;
  flagReason: string | null;
  nextCheckIn: string | null;
  needsAttention: boolean;
  followedUp: boolean;
  taskId: string | null;
  // Keys followUpState/onFollowUp by — the open conversation task's id when
  // there is one, else the client's own id (so a business with nothing open
  // yet can still show a "saving"/error state before its first task exists).
  followUpKey: string;
}

export interface TerritoryBoardGroup {
  key: string;
  label: string;
  color: string;
  rows: BusinessRow[];
}

export function TerritoryBoard({ groups, followUpState, onOpenClient, onOpenPlaybook, onFollowUp, onDismissError }: {
  groups: TerritoryBoardGroup[];
  followUpState: Record<string, "saving" | string>;
  onOpenClient: (id: string) => void;
  onOpenPlaybook: (id: string) => void;
  onFollowUp: (row: BusinessRow, note: string) => void;
  onDismissError: (row: BusinessRow) => void;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {groups.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-muted">
            Nothing to work right now — every claimed business in your territories is caught up.
          </div>
        )}
        <div className="divide-y-8 divide-background">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 border-y px-4 py-2" style={{ background: g.color + "22", borderColor: g.color + "40" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[15px] font-bold">{g.label}</span>
                <span className="rounded-full px-1.5 text-[13px] font-semibold normal-case tracking-normal text-white" style={{ background: g.color }}>{g.rows.length}</span>
              </div>
              <div>
                {g.rows.map((row) => (
                  <BusinessRowView key={row.client.id} row={row}
                    state={followUpState[row.followUpKey]}
                    onOpen={() => onOpenClient(row.client.id)}
                    onOpenPlaybook={() => onOpenPlaybook(row.client.id)}
                    onFollowUp={(note) => onFollowUp(row, note)}
                    onDismissError={() => onDismissError(row)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusinessRowView({ row, state, onOpen, onOpenPlaybook, onFollowUp, onDismissError }: {
  row: BusinessRow;
  state: "saving" | string | undefined;
  onOpen: () => void;
  onOpenPlaybook: () => void;
  onFollowUp: (note: string) => void;
  onDismissError: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const submit = () => { onFollowUp(note.trim()); setNote(""); setNoteOpen(false); };
  return (
    <div className="border-b px-4 py-3 last:border-0">
      <button onClick={onOpen} className="flex w-full items-center gap-3 text-left transition-colors hover:bg-accent-soft/50">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" title={row.stageLabel} style={{ background: row.stageColor }} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-medium leading-snug">{row.client.name}</span>
          <span className="truncate text-[13px] text-muted">{row.city} · {row.stageLabel}</span>
        </span>
        <span className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted">
          Playbook {row.playbook.doneCount}/{row.playbook.total}
          {row.playbook.next && <span className="ml-1 font-normal text-accent">· {row.playbook.next.label}</span>}
        </span>
      </button>
      {row.flagReason && (
        <div className="mt-1.5 pl-6 text-[13px] font-medium text-danger">{row.flagReason}</div>
      )}
      {row.nextCheckIn && (
        <div className="mt-1.5 pl-6 text-[13px] text-muted">Check back {formatDue(row.nextCheckIn)}</div>
      )}
      {row.lastTouch && (
        <div className="mt-1.5 truncate pl-6 text-[13px] text-muted" title={htmlToText(row.lastTouch.body)}>
          <span className="font-medium text-foreground">{row.lastTouch.authorName}</span> · {timeAgo(row.lastTouch.at)} — {htmlToText(row.lastTouch.body).slice(0, 80)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        {state === "saving" ? (
          <span className="text-[12px] text-muted">Saving…</span>
        ) : state ? (
          <span className="flex items-center gap-1.5 text-[12px]">
            <span className="text-danger">{state}</span>
            <button onClick={onDismissError} className="font-medium text-muted hover:text-foreground">Dismiss</button>
          </span>
        ) : noteOpen ? (
          <div className="flex w-full flex-col gap-1.5 sm:max-w-md">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus rows={2}
              placeholder="What happened? (optional)"
              className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent" />
            <div className="flex items-center gap-2">
              <button onClick={submit} className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white">Log it</button>
              <button onClick={() => { setNoteOpen(false); setNote(""); }} className="text-[12px] font-medium text-muted hover:text-foreground">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setNoteOpen(true)}
            title="Record that you reached out, with a note if you want one. Checks back in a few days if nothing comes of it."
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-background hover:text-foreground">
            <I.comment className="h-3 w-3" /> Log a follow-up
          </button>
        )}
        <button onClick={onOpenPlaybook} className="text-[12px] font-medium text-accent hover:underline">Open Playbook</button>
      </div>
    </div>
  );
}

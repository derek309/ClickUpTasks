"use client";

// Territory Dashboard's presentational layer — same visual language as
// ClientsBoard.tsx (one card, colored tier-header bands with a count pill,
// flat clickable rows). Rows are either a claimed+ business (a real Client,
// with Playbook progress and a "Log a follow-up" action) or a prospect still
// mid invite (accepted or clicked but hasn't claimed yet — no Client row to
// attach a follow-up task to, so those get a lighter Call/Open action
// instead). Both render through the same row shell so the page reads as one
// list, not two different components stitched together.
import { useState } from "react";
import { formatDue, timeAgo, htmlToText, playbookCompletion, type Client } from "@/lib/data";
import { I } from "./ui";

export interface BusinessRow {
  // Unique key — a claimed+ row uses client.id, a prospect row has no client
  // yet so uses its own gd_place_id-derived key instead.
  id: string;
  name: string;
  city: string;
  stageLabel: string;
  stageColor: string;
  // Null for a prospect row (accepted/clicked but not yet claimed) — nothing
  // to show Playbook progress or log a follow-up task against yet.
  client: Client | null;
  playbook: ReturnType<typeof playbookCompletion> | null;
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
  // Prospect rows only — a phone number to call and the public listing to
  // open, since there's no client page yet to send a rep to.
  phone?: string | null;
  listingUrl?: string | null;
}

export interface TerritoryBoardGroup {
  key: string;
  label: string;
  color: string;
  rows: BusinessRow[];
}

export function TerritoryBoard({ groups, followUpState, onOpenClient, onOpenTerritory, onOpenPlaybook, onFollowUp, onDismissError }: {
  groups: TerritoryBoardGroup[];
  followUpState: Record<string, "saving" | string>;
  onOpenClient: (id: string) => void;
  // Opens a prospect row's own city Businesses tab (no client page exists
  // yet for a business that hasn't claimed) — the full engagement history,
  // call/copy-link/invite-again actions already live there, so a prospect
  // row's job is surfacing it across territories, not re-building those
  // actions here.
  onOpenTerritory: (territoryId: string) => void;
  onOpenPlaybook: (id: string) => void;
  onFollowUp: (row: BusinessRow, note: string) => void;
  onDismissError: (row: BusinessRow) => void;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {groups.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-muted">
            Nothing needs you right now — every territory you&apos;re assigned to is caught up.
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
                  <BusinessRowView key={row.id} row={row}
                    state={followUpState[row.followUpKey]}
                    onOpen={() => (row.client ? onOpenClient(row.client.id) : onOpenTerritory(row.id.split("|")[0]))}
                    onOpenPlaybook={() => row.client && onOpenPlaybook(row.client.id)}
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
          <span className="truncate text-[17px] font-medium leading-snug">{row.name}</span>
          <span className="truncate text-[13px] text-muted">{row.city} · {row.stageLabel}</span>
        </span>
        {row.playbook && (
          <span className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted">
            Playbook {row.playbook.doneCount}/{row.playbook.total}
            {row.playbook.next && <span className="ml-1 font-normal text-accent">· {row.playbook.next.label}</span>}
          </span>
        )}
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
        {row.client ? (
          state === "saving" ? (
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
          )
        ) : (
          <>
            {row.phone && (
              <a href={`tel:${row.phone}`} onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">
                <I.phone className="h-3 w-3" /> Call {row.phone}
              </a>
            )}
            {row.listingUrl && (
              <a href={row.listingUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="text-[12px] font-medium text-accent hover:underline">View listing</a>
            )}
          </>
        )}
        {row.client && <button onClick={onOpenPlaybook} className="text-[12px] font-medium text-accent hover:underline">Open Playbook</button>}
      </div>
    </div>
  );
}

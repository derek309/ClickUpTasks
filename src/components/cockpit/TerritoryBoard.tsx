"use client";

// Territory Dashboard's presentational layer, deliberately the same component
// shape as ClientsBoard.tsx: one card, colored tier-header bands with a count
// pill, and rows that are a single scannable line (status dot, initials
// circle, name over a subtitle, right-aligned meta) rather than a stack of
// detail lines.
//
// The first cut rendered everything inline — flag reason, last touch, a
// Call link, a View listing link, an "Open Playbook" link and a follow-up
// composer, all stacked under every row — which turned a list meant for
// scanning into a wall of controls that looked nothing like the Client
// Dashboard next to it. Rows now collapse to that one line and expand on
// click, one at a time, so the list stays readable and the actions for the
// business you're actually working get the room they need.
//
// Rows are either a claimed+ business (a real Client, with Playbook progress
// and a "Log a follow-up" action) or a prospect still mid invite (accepted or
// clicked but hasn't claimed yet, so there's no Client row to attach a
// follow-up task to). Both use the same row shell; only the expanded action
// area differs.
import { useState } from "react";
import { formatDue, timeAgo, htmlToText, playbookCompletion, type Client } from "@/lib/data";
import { I } from "./ui";
import { TouchPanel, type TouchResult, type OutcomeKey } from "./TouchLogger";

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
  /** Compact right-column status, the equivalent of ClientRow's task count:
   * "90d overdue", "Accepted 18h ago", "Back Aug 11". Kept short on purpose —
   * the full sentence is flagReason, shown once the row is expanded. */
  meta?: string | null;
  metaDanger?: boolean;
  // Prospect rows only — a phone number to call and the public listing to
  // open, since there's no client page yet to send a rep to.
  phone?: string | null;
  listingUrl?: string | null;
  /** Feeds TouchPanel's click-to-email — absent when WP has no email on file
   * for this listing, in which case that outcome falls back to a plain
   * select instead of a dead mailto: link. */
  email?: string | null;
  /** Public booking widget for this business's city, when its territory has
   * one set up — null otherwise, in which case Book Meeting doesn't render. */
  bookingUrl?: string | null;
  /** GHL contact record and wp-admin edit screen — "" when not resolvable
   * (see directoryListingsServer.ts), in which case that link doesn't render. */
  ghlUrl?: string;
  editUrl?: string;
  /** GeoDirectory post id, which is what /api/directory/activity keys a
   * logged touch by. Prospect rows only; a claimed+ row logs its outreach as
   * a comment on its conversation task instead. */
  listingId?: number | null;
  /** WP's rendered label for the last logged outcome ("Called", "SMS'd"), and
   * when it happened / when it's due back. Unix seconds, 0 when unset. */
  touchLabel?: string | null;
  touchedAt?: number;
  followupDue?: number;
}

export interface TerritoryBoardGroup {
  key: string;
  label: string;
  color: string;
  rows: BusinessRow[];
}

const initialsOf = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

// One date format for every date this component renders. The first version
// mixed timeAgo()'s absolute fallback with a locale month/day and produced
// lines like "Visited 5/9/2026. Back on May 10." in a single sentence.
const shortDate = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function TerritoryBoard({ groups, followUpState, onOpenClient, onOpenTerritory, onOpenPlaybook, onFollowUp, onDismissError, onTouchLogged }: {
  groups: TerritoryBoardGroup[];
  followUpState: Record<string, "saving" | string>;
  /** A prospect row logged an outreach touch — hands the updated listing
   * fields back up so the owner of the listing data can patch that row in
   * place (it re-tiers off followupDue) without refetching the whole city. */
  onTouchLogged: (row: BusinessRow, result: TouchResult) => void;
  onOpenClient: (id: string) => void;
  // Opens a prospect row's own city Businesses tab (no client page exists
  // yet for a business that hasn't claimed) — the full engagement history,
  // call/copy-link/invite-again actions already live there, so a prospect
  // row's job is surfacing it across territories, not re-building those
  // actions here.
  // listingId, when given, deep-links to that specific row on the Businesses
  // page instead of the top of the whole city — see the call site below.
  onOpenTerritory: (territoryId: string, listingId?: number) => void;
  onOpenPlaybook: (id: string) => void;
  onFollowUp: (row: BusinessRow, note: string) => void;
  onDismissError: (row: BusinessRow) => void;
}) {
  // One row expanded at a time — the point of collapsing them was that a
  // list with every row's actions on screen isn't scannable, and that's just
  // as true with two open as with all of them.
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
                  <BusinessRowView key={row.id} row={row}
                    expanded={expandedId === row.id}
                    onToggle={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                    state={followUpState[row.followUpKey]}
                    onOpenClient={() => (row.client ? onOpenClient(row.client.id) : onOpenTerritory(row.id.split("|")[0], row.listingId ?? undefined))}
                    onOpenPlaybook={() => row.client && onOpenPlaybook(row.client.id)}
                    onFollowUp={(note) => onFollowUp(row, note)}
                    onTouchLogged={(result) => { setExpandedId(null); onTouchLogged(row, result); }}
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

function BusinessRowView({ row, expanded, onToggle, state, onOpenClient, onOpenPlaybook, onFollowUp, onTouchLogged, onDismissError }: {
  row: BusinessRow;
  expanded: boolean;
  onToggle: () => void;
  state: "saving" | string | undefined;
  onOpenClient: () => void;
  onOpenPlaybook: () => void;
  onFollowUp: (note: string) => void;
  onTouchLogged: (result: TouchResult) => void;
  onDismissError: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  // null = panel closed. "manual" = opened via the plain "Log a touch"
  // trigger, no outcome pre-picked. Otherwise the outcome key of whichever
  // Call Now/Send Email/Send SMS/Book Meeting button was clicked — keyed on
  // the panel below so switching from e.g. Call Now to Send Email properly
  // resets the pre-selection instead of a stale one sticking around.
  const [touchOutcome, setTouchOutcome] = useState<OutcomeKey | "manual" | null>(null);
  const submit = () => { onFollowUp(note.trim()); setNote(""); setNoteOpen(false); };

  return (
    <div className="border-b last:border-0">
      {/* Collapsed row: deliberately the same single line as ClientsBoard's
          ClientRow, so the two dashboards read as one product. */}
      <button onClick={onToggle} aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent-soft/50">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" title={row.stageLabel} style={{ background: row.stageColor }} />
        <span className="h-8 w-8 shrink-0 rounded-full text-center text-[16px] font-semibold leading-8 text-white" style={{ background: row.stageColor }}>
          {initialsOf(row.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-medium leading-snug">{row.name}</span>
          <span className="truncate text-[16px] text-muted">{row.city} · {row.stageLabel}</span>
        </span>
        {row.meta && (
          <span className={`shrink-0 text-right text-[16px] ${row.metaDanger ? "font-medium text-danger" : "text-muted"}`}>{row.meta}</span>
        )}
        {/* I.chevron points left, so right = collapsed, down = expanded. */}
        <I.chevron className={`shrink-0 text-muted transition-transform ${expanded ? "-rotate-90" : "rotate-180"}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-[60px]">
          {row.flagReason && <div className="text-[16px] font-medium text-danger">{row.flagReason}</div>}
          {row.nextCheckIn && <div className="mt-1 text-[16px] text-muted">Check back {formatDue(row.nextCheckIn)}</div>}
          {row.touchLabel && !!row.touchedAt && (
            <div className="mt-1 text-[16px] text-muted">
              {row.touchLabel} {shortDate(row.touchedAt)}
              {row.followupDue ? ` · Follow up due ${shortDate(row.followupDue)}` : ""}
            </div>
          )}
          {row.playbook && (
            <div className="mt-1 text-[16px] text-muted">
              Playbook {row.playbook.doneCount}/{row.playbook.total}
              {row.playbook.next && <span className="ml-1 text-accent">· next: {row.playbook.next.label}</span>}
            </div>
          )}
          {row.lastTouch && (
            <div className="mt-1 truncate text-[16px] text-muted" title={htmlToText(row.lastTouch.body)}>
              <span className="font-medium text-foreground">{row.lastTouch.authorName}</span> · {timeAgo(row.lastTouch.at)} · {htmlToText(row.lastTouch.body).slice(0, 80)}
            </div>
          )}

          {row.client ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {state === "saving" ? (
                <span className="text-[16px] text-muted">Saving…</span>
              ) : state ? (
                <span className="flex items-center gap-1.5 text-[16px]">
                  <span className="text-danger">{state}</span>
                  <button onClick={onDismissError} className="font-medium text-muted hover:text-foreground">Dismiss</button>
                </span>
              ) : noteOpen ? (
                <div className="flex w-full flex-col gap-1.5 sm:max-w-md">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus rows={2}
                    placeholder="What happened? (optional)"
                    className="w-full resize-none rounded-lg border bg-background px-2.5 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
                  <div className="flex items-center gap-3">
                    <button onClick={submit} className="rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white">Log it</button>
                    <button onClick={() => { setNoteOpen(false); setNote(""); }} className="text-[16px] font-medium text-muted hover:text-foreground">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setNoteOpen(true)}
                  title="Record that you reached out, with a note if you want one. Checks back in a few days if nothing comes of it."
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[16px] font-medium text-foreground hover:border-accent hover:bg-accent-soft hover:text-accent">
                  <I.comment className="h-3.5 w-3.5" /> Log a follow-up
                </button>
              )}
              {row.listingUrl && (
                <a href={row.listingUrl} target="_blank" rel="noopener noreferrer" className="text-[16px] font-medium text-accent hover:underline">View listing</a>
              )}
              <button onClick={onOpenClient} className="text-[16px] font-medium text-accent hover:underline">Open client</button>
              <button onClick={onOpenPlaybook} className="text-[16px] font-medium text-accent hover:underline">Open Playbook</button>
            </div>
          ) : touchOutcome && row.listingId != null ? (
            <TouchPanel key={touchOutcome} listingId={row.listingId} phone={row.phone} email={row.email} bookingUrl={row.bookingUrl}
              initialOutcome={touchOutcome === "manual" ? undefined : touchOutcome}
              onLogged={onTouchLogged} onCancel={() => setTouchOutcome(null)} />
          ) : (
            <>
              {/* One place to see who's top priority and take the action —
                  these four ARE the outcome picker, promoted onto the row
                  instead of hidden behind a generic "Log a touch" click.
                  Each is a real tel:/mailto:/sms:/booking link (fires the
                  actual dial/compose/booking page) that also opens the panel
                  below pre-selected on that outcome, so a rep never does the
                  thing and then separately comes back to log it. */}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {row.phone && (
                  <a href={`tel:${row.phone}`} onClick={() => setTouchOutcome("called")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent px-3 py-1.5 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    <I.phone className="h-3.5 w-3.5" /> Call Now
                  </a>
                )}
                {row.email && (
                  <a href={`mailto:${row.email}`} onClick={() => setTouchOutcome("emailed")}
                    className="rounded-lg border border-accent px-3 py-1.5 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    Send Email
                  </a>
                )}
                {row.phone && (
                  <a href={`sms:${row.phone}`} onClick={() => setTouchOutcome("sms")}
                    className="rounded-lg border border-accent px-3 py-1.5 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    Send SMS
                  </a>
                )}
                {row.bookingUrl && (
                  <a href={row.bookingUrl} target="_blank" rel="noopener noreferrer" onClick={() => setTouchOutcome("presented")}
                    className="rounded-lg border border-accent px-3 py-1.5 text-[16px] font-medium text-accent hover:bg-accent-soft">
                    Book Meeting
                  </a>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {row.listingId != null && (
                  <button onClick={() => setTouchOutcome("manual")} className="text-[16px] font-medium text-muted hover:text-foreground">Log a touch</button>
                )}
                {row.listingUrl && (
                  <a href={row.listingUrl} target="_blank" rel="noopener noreferrer" className="text-[16px] font-medium text-accent hover:underline">View listing</a>
                )}
                {row.editUrl && (
                  <a href={row.editUrl} target="_blank" rel="noopener noreferrer" className="text-[16px] font-medium text-accent hover:underline">Edit business profile</a>
                )}
                {row.ghlUrl && (
                  <a href={row.ghlUrl} target="_blank" rel="noopener noreferrer" className="text-[16px] font-medium text-accent hover:underline">Open GHL</a>
                )}
                <button onClick={onOpenClient} className="text-[16px] font-medium text-accent hover:underline">Open in Businesses</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// The turn line (Derek, 2026-10-17, step-done-then-next-mockup.html): one
// short sentence, "● Michaella's turn, due Oct 15, 2d late …". The turn word
// is the only way to hand a step on: You, teammates, Claude, the client. The
// date opens the usual calendar (Today, Tomorrow, Next week, Pick). The "…"
// at the end holds the extras for that turn: priority, the teammate's dates,
// the client's reminders. The step card and What's next both draw it.
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InlineDate } from "./GroupedList";
import { MenuSheet } from "./ActionMenu";
import { useEscapeToClose } from "./useEscapeToClose";
import { I } from "./ui";

type MenuItem = { key: string; label: string; sub?: string; on?: boolean; muted?: boolean; onClick: () => void };

/** A word in the sentence that opens a short menu: anchored on a desktop, a
 *  sheet at the bottom on a phone. Inline, so the sentence wraps as words. */
export function WordMenu({ label, title, heading, items, note, className }: { label: ReactNode; title: string; heading?: string; items: MenuItem[]; note?: string; className: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEscapeToClose(() => setOpen(false), open);
  const body = (
    <>
      {heading && <div className="px-2.5 pb-1 pt-1.5 text-[16px] font-semibold">{heading}</div>}
      {items.map((it) => (
        <button key={it.key} role="menuitemradio" aria-checked={!!it.on} onClick={() => { setOpen(false); it.onClick(); }}
          className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[16px] hover:bg-background ${it.muted ? "text-muted" : ""}`}>
          <span className="min-w-0 flex-1">
            <span className={`block ${it.on ? "font-semibold" : ""}`}>{it.label}</span>
            {it.sub && <span className="block text-muted">{it.sub}</span>}
          </span>
          {it.on && <I.check className="h-4 w-4 shrink-0 text-accent" />}
        </button>
      ))}
      {note && <div className="border-t px-2.5 pb-1 pt-2 text-[16px] text-muted">{note}</div>}
    </>
  );
  return (
    <>
      <button type="button" title={title} aria-haspopup="menu" aria-expanded={open} className={className}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const w = Math.min(300, window.innerWidth - 16);
          const h = items.length * 48 + (heading ? 40 : 0) + (note ? 64 : 0) + 14;
          setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4 });
          setOpen((o) => !o);
        }}>{label}</button>
      {open && (<>
        <span className="fixed inset-0 z-30 hidden sm:block" onClick={() => setOpen(false)} />
        <span role="menu" aria-label={title} style={{ top: pos.top, left: pos.left }}
          className="fixed z-40 hidden max-h-[calc(100vh-16px)] w-[min(300px,calc(100vw-16px))] overflow-y-auto rounded-[5px] border bg-surface p-1.5 text-foreground shadow-lg sm:block">{body}</span>
        {/* The phone's sheet is drawn at the page level: a block inside the
            sentence broke the line under the word while it was open. */}
        {typeof document !== "undefined" && createPortal(
          <div data-no-open onClick={(e) => e.stopPropagation()}><MenuSheet label={title} onClose={() => setOpen(false)}>{body}</MenuSheet></div>, document.body)}
      </>)}
    </>
  );
}

export type TurnChoice = { key: string; label: string; on?: boolean };

const WORD = "font-semibold underline decoration-dotted underline-offset-4 hover:decoration-solid";

export function TurnLine({ lead, word, title = "Whose turn it is", choices, onPick, dateLead, date, onDate, onClearDate, formatDate, dateClass = "", emptyDate, fixedDate, tail, extras }: {
  /** The face or coloured dot before the words. */
  lead?: ReactNode;
  /** "Michaella's turn". */
  word: string;
  title?: string;
  /** Missing: the turn word is plain text (a step that can't change hands). */
  choices?: TurnChoice[];
  onPick?: (key: string) => void;
  /** "due", "need by". */
  dateLead?: string;
  date?: string | null;
  onDate?: (d: string | null) => void;
  onClearDate?: () => void;
  formatDate?: (d: string) => string;
  dateClass?: string;
  emptyDate?: ReactNode;
  /** In place of a picker: Claude's "today". */
  fixedDate?: string;
  /** Words after the date: "reminders on". */
  tail?: ReactNode;
  /** The "…" (StepMore). */
  extras?: ReactNode;
}) {
  const dateWord = `-mx-1 ${WORD} text-[16px] sm:text-[18px] ${dateClass}`;
  return (
    <div data-no-open className="text-[16px] leading-snug sm:text-[18px]">
      <span className="font-semibold">
        {lead}
        {choices && onPick
          ? <WordMenu title={title} heading="Whose turn" className={`rounded-[5px] text-left ${WORD}`} label={word}
              items={choices.map((c) => ({ key: c.key, label: c.label, on: c.on, onClick: () => onPick(c.key) }))} />
          : word}
      </span>
      {fixedDate ? <>, {fixedDate}</> : onDate && (
        <>{", "}{dateLead ? `${dateLead} ` : ""}
          <span className="inline-flex items-baseline">
            <InlineDate value={date ?? null} onChange={onDate} onClear={onClearDate}
              emptyLabel={emptyDate ?? <span className="text-accent underline decoration-dotted underline-offset-4">set a date</span>}
              formatValue={formatDate} className={dateWord} />
          </span>
        </>
      )}
      {tail && <>{", "}{tail}</>}
      {extras && <>{" "}{extras}</>}
    </div>
  );
}

export type MoreItem = { key: string; label: string; sub?: string; on?: boolean; onClick: () => void };
export type MoreDate = { key: string; label: string; value: string | null; onChange: (d: string | null) => void; onClear?: () => void; format: (d: string) => string };
export type MoreGroup = { heading: string; items?: MoreItem[]; dates?: MoreDate[]; note?: string };

/** The "…" at the end of the turn line: a small text button, no pill, its
 *  menu anchored under it on every screen (a calendar opens over it). */
export function StepMore({ title, groups }: { title: string; groups: MoreGroup[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEscapeToClose(() => setOpen(false), open);
  if (!groups.length) return null;
  const rows = groups.reduce((n, g) => n + (g.items?.length ?? 0) + (g.dates?.length ?? 0) + 1, 0);
  return (
    <span className="relative inline-block">
      <button type="button" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const w = Math.min(300, window.innerWidth - 16);
          const h = Math.min(window.innerHeight - 16, rows * 46 + 16);
          setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4 });
          setOpen((o) => !o);
        }}
        className="rounded-[5px] px-1 text-[16px] font-semibold leading-none text-muted hover:bg-background hover:text-foreground">…</button>
      {open && (<>
        <span className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <span role="menu" aria-label={title} style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}
          className="fixed z-40 block max-h-[calc(100vh-16px)] w-[min(300px,calc(100vw-16px))] overflow-y-auto rounded-[5px] border bg-surface p-1.5 text-left text-foreground shadow-lg">
          {groups.map((g, gi) => (
            <span key={g.heading} className={`block ${gi > 0 ? "mt-1 border-t pt-1" : ""}`}>
              <span className="block px-2.5 pb-0.5 pt-1.5 text-[16px] text-muted">{g.heading}</span>
              {g.items?.map((it) => (
                <button key={it.key} role="menuitemradio" aria-checked={!!it.on} onClick={() => { setOpen(false); it.onClick(); }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[16px] hover:bg-background">
                  <span className="min-w-0 flex-1">
                    <span className={`block ${it.on ? "font-semibold" : ""}`}>{it.label}</span>
                    {it.sub && <span className="block text-muted">{it.sub}</span>}
                  </span>
                  {it.on && <I.check className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              ))}
              {g.dates?.map((d) => (
                <span key={d.key} className="flex min-h-11 items-center justify-between gap-2 px-2.5 text-[16px]">
                  <span>{d.label}</span>
                  <InlineDate value={d.value} onChange={d.onChange} onClear={d.onClear} formatValue={d.format}
                    emptyLabel={<span className="text-accent">set a date</span>} className="text-[16px] font-semibold text-muted" />
                </span>
              ))}
              {g.note && <span className="block px-2.5 pb-1 pt-1 text-[16px] text-muted">{g.note}</span>}
            </span>
          ))}
        </span>
      </>)}
    </span>
  );
}

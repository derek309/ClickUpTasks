"use client";

// Set up a step (Derek, 2026-10-14): three rows, one line each, at most five
// choices a row, nothing else. Whose turn, by when, what the action is. The
// likely answer of the first two is picked already, so one tap on an action
// finishes it; each tap moves on to the next row. No Save: an action sets the
// step up and the rows fold into the step's sentence ("● Justin's turn, due
// Oct 16"). Skip folds it with what is picked. Desktop keys: 1 to 5 pick in
// the row you are on, Tab or Enter moves on, Escape skips.
//
// One pattern, two places: a step's own page (a step just added, or made
// from Quick step or an Add menu) and What's next.
import { useEffect, useId, useState } from "react";
import { CLAUDE_ID, formatDue } from "@/lib/data";
import { impliedBy, whenChoices, whenKeyFor } from "@/lib/stepSetup";
import { I } from "./ui";
import { InlineDate } from "./GroupedList";
import { ActionMenu } from "./ActionMenu";

// An empty step lays the Add menu out in three rows (Derek, 2026-10-14):
// what you write, how you talk to the client, what you make for them to
// review. Anything else on the menu stays behind + More at the end.
export const ADD_ROWS = [
  { row: "write", keys: ["directions", "checklist"] },
  { row: "talk", keys: ["email", "text", "chat"] },
  { row: "make", keys: ["doc", "image", "page", "video"] },
] as const;
export const ADD_SHORT: Record<string, string> = {
  directions: "Directions", checklist: "To dos", email: "Email", text: "Text", chat: "Chat in the portal",
  doc: "Document", image: "Image", page: "HTML review", video: "Video",
};
// ui's icons have no image, HTML review or video; these match their stroke.
const rowIcon = (d: React.ReactNode) => function RowIcon(p: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className} width="16" height="16" aria-hidden>{d}</svg>;
};
export const ADD_ICON: Record<string, (p: { className?: string }) => React.ReactNode> = {
  directions: I.pencil, checklist: I.list, email: I.mail, text: I.mobile, chat: I.chatBubbles, doc: I.note,
  image: rowIcon(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>),
  page: rowIcon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01" /></>),
  video: rowIcon(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4.5-2.5z" /></>),
};

/** One thing a step can be given: the same items as its Add menu. */
export type SetupAction = { key: string; label: string; title?: string; disabled?: boolean; onPick: () => void };
/** The Add menu's items laid out as its rows, with what is left for + More. */
export function addRowsOf<T extends { key: string }>(options: T[], first: string, skip: Set<string> = new Set()) {
  const rowKeys = new Set<string>(ADD_ROWS.flatMap((r) => r.keys));
  const rows = ADD_ROWS.map((r) => ({
    label: r.row === "write" ? "Write" : r.row === "talk" ? `Talk to ${first}` : "Make to review",
    items: (r.keys as readonly string[]).flatMap((k) => options.filter((o) => o.key === k && !skip.has(k))),
  })).filter((r) => r.items.length > 0);
  return { rows, rest: options.filter((o) => !rowKeys.has(o.key)) };
}

export type SetupWho = { key: string; label: string };
export type SetupAnswer = { who: string | null; when: string };

const CHOICE = "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-3 text-[16px] font-semibold ring-1 ring-inset";
const OFF = `${CHOICE} bg-surface text-foreground ring-border hover:ring-accent`;
const ON = `${CHOICE} bg-accent-soft text-accent ring-2 ring-accent`;

export function StepSetup({ name, who, whoInitial, nameOf, someoneElse, whenInitial, today, meId, lead = [], rows, more = [], preset, onDone, autoFocus = false, search = false, enterSubmits = false, onAnswer }: {
  /** What's next: the next step's name, above the three rows. */
  name?: React.ReactNode;
  who: SetupWho[];
  whoInitial: string | null;
  /** A person's first name, for one picked from Someone else. */
  nameOf?: (id: string) => string;
  /** The full picker, behind "Someone else ▾": draws its trigger with the label given. */
  someoneElse?: (label: React.ReactNode, pick: (id: string) => void) => React.ReactNode;
  whenInitial: string;
  today: string;
  meId: string | null;
  /** First in the action row: what the step's name suggests, Email to review. */
  lead?: SetupAction[];
  rows: { label: string; items: SetupAction[] }[];
  more?: SetupAction[];
  /** The action already chosen (made from Quick step): shown picked; a tap
   *  on it, or on By when, finishes. A tap on it also starts it when it is
   *  not on the step yet (the to-do box opens). */
  preset?: string | null;
  /** Set the step up with these answers, then do the action (if one). */
  onDone: (answer: SetupAnswer, run?: () => void) => void;
  autoFocus?: boolean;
  /** On a desktop, a box to find an action by typing: letters filter the
   *  action row, arrows move, Enter picks (Quick step's search, 2026-10-13). */
  search?: boolean;
  /** Enter in the name box sets it up with what is picked (+ Add step). */
  enterSubmits?: boolean;
  /** Told each pick, for a name box outside the rows (+ Add step's input). */
  onAnswer?: (a: SetupAnswer) => void;
}) {
  const [whoPick, setWhoPick] = useState<string | null>(whoInitial);
  const [when, setWhen] = useState(whenInitial);
  const [q, setQ] = useState("");
  const [qAt, setQAt] = useState(0);
  // Rows found by id: no refs read while drawing.
  const uid = useId();
  const rowEl = (i: number) => (typeof document === "undefined" ? null : document.getElementById(`${uid}-row${i}`));
  const choicesOf = (i: number) => [...(rowEl(i)?.querySelectorAll<HTMLElement>("[data-choice]") ?? [])];
  const focusRow = (i: number) => {
    const list = choicesOf(i);
    const el = list.find((x) => x.getAttribute("aria-pressed") === "true" || x.querySelector("[aria-pressed=true]")) ?? list[0];
    const b = el?.matches("button") ? el : el?.querySelector<HTMLElement>("button");
    b?.focus({ preventScroll: true });
  };
  useEffect(() => { if (autoFocus) focusRow(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (): SetupAnswer => ({ who: whoPick, when });
  const pickWho = (k: string) => {
    setWhoPick(k);
    // Claude starts on it now: today, always.
    if (k === CLAUDE_ID) setWhen(today);
    onAnswer?.({ who: k, when: k === CLAUDE_ID ? today : when });
    setTimeout(() => focusRow(1), 0);
  };
  const pickWhen = (d: string) => {
    setWhen(d);
    onAnswer?.({ who: whoPick, when: d });
    // The action is chosen already: this was the last thing to answer.
    if (preset) { onDone({ who: whoPick, when: d }); return; }
    setTimeout(() => focusRow(2), 0);
  };
  const act = (a: SetupAction) => {
    const imp = impliedBy(a.key, meId, today);
    onDone({ who: imp.who ?? whoPick, when: imp.when ?? when }, a.onPick);
  };
  const whenKey = whenKeyFor(when, today);
  // What the search finds: every action, the + More ones too, by any word.
  const needle = q.trim().toLowerCase();
  const found = !needle ? [] : [...lead, ...rows.flatMap((r) => r.items), ...more]
    .filter((a, i, all) => !a.disabled && all.findIndex((b) => b.key === a.key) === i)
    .filter((a) => a.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle)) || a.label.toLowerCase().includes(needle));
  const known = who.some((c) => c.key === whoPick);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(answer()); return; }
    if (enterSubmits && e.key === "Enter" && !e.nativeEvent.isComposing && t.matches("input[data-name]")) { e.preventDefault(); onDone(answer()); return; }
    if (t.closest("input, textarea, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const row = [0, 1, 2].findIndex((i) => !!rowEl(i)?.contains(t));
    if (row < 0) return;
    if (/^[1-9]$/.test(e.key)) {
      const el = choicesOf(row)[Number(e.key) - 1];
      if (!el) return;
      e.preventDefault();
      (el.matches("button") ? el : el.querySelector<HTMLElement>("button"))?.click();
    } else if (e.key === "Tab" && !e.shiftKey && row < 2) { e.preventDefault(); focusRow(row + 1); }
    else if (e.key === "Tab" && e.shiftKey && row > 0) { e.preventDefault(); focusRow(row - 1); }
  };
  // Each row: its question, then its choices on one line (a phone, too
  // narrow for five, wraps them).
  const Row = ({ i, label, children }: { i: number; label: string; children: React.ReactNode }) => (
    <div className={`flex min-w-0 flex-col gap-1 sm:flex-row sm:gap-3 ${i === 2 ? "sm:items-start" : "sm:items-center"}`}>
      <span id={`${uid}-q${i}`} className={`shrink-0 text-[16px] font-semibold text-muted sm:w-[9.5rem] ${i === 2 ? "sm:pt-2.5" : ""}`}>{label}</span>
      <div id={`${uid}-row${i}`} role="group" aria-labelledby={`${uid}-q${i}`} className="flex min-w-0 flex-wrap items-center gap-1.5 py-0.5 sm:flex-nowrap">{children}</div>
    </div>
  );
  const whoLabel = (c: SetupWho) => c.key === "else" ? <>{!known && whoPick ? nameOf?.(whoPick) ?? "Someone else" : "Someone else"}<I.chevron className="h-3.5 w-3.5 -rotate-90" /></> : c.label;
  return (
    <section aria-label="Set up this step" onKeyDown={onKeyDown} className="flex flex-col gap-2">
      {name}
      {Row({ i: 0, label: "Whose turn?", children: who.map((c) => c.key === "else" && someoneElse ? (
        <span key={c.key} data-choice className="shrink-0">
          {someoneElse(<span aria-pressed={!known && !!whoPick} className={!known && !!whoPick ? ON : OFF}>{whoLabel(c)}</span>, pickWho)}
        </span>
      ) : (
        <button key={c.key} data-choice aria-pressed={whoPick === c.key} onClick={() => pickWho(c.key)} className={whoPick === c.key ? ON : OFF}>{whoLabel(c)}</button>
      )) })}
      {Row({ i: 1, label: "By when?", children: (<>
        {whenChoices(today).map((c) => (
          <button key={c.key} data-choice aria-pressed={whenKey === c.key} onClick={() => pickWhen(c.date)} className={whenKey === c.key ? ON : OFF}>{c.label}</button>
        ))}
        {/* A picked day shows in place of Pick a date, picked. */}
        <span data-choice className="shrink-0">
          <InlineDate value={whenKey === "pick" ? when : null} onChange={(d) => { if (d) pickWhen(d); }}
            formatValue={(v) => formatDue(v)} emptyLabel="Pick a date"
            className={`${whenKey === "pick" ? ON : OFF} !overflow-visible !rounded-[5px] !px-3 !py-0`} />
        </span>
      </>) })}
      {Row({ i: 2, label: "What's the action?", children: (
        <div className="flex min-w-0 flex-col gap-1">
          {search && (
            <input value={q} onChange={(e) => { setQ(e.target.value); setQAt(0); }} placeholder="Find an action, or type a letter" aria-label="Find an action"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setQAt((n) => Math.min(n + 1, Math.max(0, found.length - 1))); }
                else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setQAt((n) => Math.max(0, n - 1)); }
                else if (e.key === "Enter" && found[qAt]) { e.preventDefault(); act(found[qAt]); }
              }}
              className="hidden h-10 w-full max-w-[320px] rounded-[5px] bg-surface px-2.5 text-[16px] outline-none ring-1 ring-inset ring-border focus:ring-accent sm:block" />
          )}
          {needle ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {found.length ? found.map((a, i) => {
                const Icon = ADD_ICON[a.key];
                return <button key={`f-${a.key}`} data-choice aria-pressed={i === qAt} onClick={() => act(a)} className={i === qAt ? ON : OFF}>{Icon && <Icon className="h-4 w-4 shrink-0" />}{a.label}</button>;
              }) : <span className="text-[16px] text-muted">Nothing matches &ldquo;{q}&rdquo;</span>}
            </div>
          ) : (<>
          {lead.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {lead.map((a) => {
                const Icon = ADD_ICON[a.key];
                return <button key={`lead-${a.key}`} data-choice aria-pressed={preset === a.key} disabled={a.disabled} title={a.title} onClick={() => (preset === a.key ? onDone(answer(), a.disabled ? undefined : a.onPick) : act(a))} className={preset === a.key ? ON : OFF}>{Icon && <Icon className="h-4 w-4 shrink-0" />}{a.label}</button>;
              })}
            </div>
          )}
          {rows.map((r) => (
            <div key={r.label} className="flex flex-wrap items-center gap-x-1">
              <span className="mr-1 shrink-0 text-[16px] text-muted">{r.label}</span>
              {r.items.map((a) => {
                const Icon = ADD_ICON[a.key];
                const on = preset === a.key;
                return (
                  <button key={a.key} data-choice aria-pressed={on} disabled={a.disabled && !on} title={a.title} onClick={() => (on ? onDone(answer(), a.disabled ? undefined : a.onPick) : act(a))}
                    className={on ? ON : "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-[16px] font-semibold text-accent hover:bg-background disabled:opacity-50"}>
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}{ADD_SHORT[a.key] ?? a.label}
                  </button>
                );
              })}
            </div>
          ))}
          {more.length > 0 && (
            <span data-choice className="self-start">
              <ActionMenu sheet label={<span className="inline-flex items-center gap-1.5"><I.plus className="h-4 w-4" />More</span>} title="More to add to this step"
                triggerClassName="inline-flex h-10 items-center rounded-[5px] px-2.5 text-[16px] font-semibold text-accent hover:bg-background"
                items={more.map((a) => !a.disabled && { label: a.label, onClick: () => act(a) })} />
            </span>
          )}
          </>)}
        </div>
      ) })}
      <div className="flex justify-end">
        <button onClick={() => onDone(answer())} title="Keep what is picked (Escape)" className="text-[16px] font-medium text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">Skip</button>
      </div>
    </section>
  );
}

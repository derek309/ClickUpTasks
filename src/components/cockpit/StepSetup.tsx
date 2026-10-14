"use client";

// Set up a step (Derek, 2026-10-14): three rows, one line each, at most five
// choices a row, nothing else. Whose turn, by when, what the action is. The
// likely answer of the first two is picked already, so one tap on an action
// finishes it; each tap moves on to the next row. No Save: an action sets the
// step up and the rows fold into the step's sentence ("● Justin's turn, due
// Oct 16"). Skip folds it with what is picked. Desktop keys: 1 to 5 pick in
// the row you are on, Tab or Enter moves on, Escape skips.
//
// The action row is a find box and three recommended actions, nothing else
// (Derek, 2026-10-14: the box, a suggestion and three rows of nine was too
// much). The full list shows once a letter is typed, filtered, or from "All
// actions". The three are ranked in lib/stepSetup (recommendActions).
//
// One pattern, two places: a step's own page (a step just added, or made
// from Quick step or an Add menu) and What's next.
import { useEffect, useId, useState } from "react";
import { CLAUDE_ID, formatDue, isLongTitle } from "@/lib/data";
import { historyKinds, impliedBy, recommendActions, whenChoices, whenKeyFor, type HistoryStep } from "@/lib/stepSetup";
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
  claude: I.bolt,
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

// Choices wrap onto new lines, never scroll sideways (Derek, 2026-10-14).
const CHOICE = "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-3 text-[16px] font-semibold ring-1 ring-inset";
const OFF = `${CHOICE} bg-surface text-foreground ring-border hover:ring-accent`;
const ON = `${CHOICE} bg-accent-soft text-accent ring-2 ring-accent`;
// An action on a desktop sits in its labelled row as a plain accent word.
const ITEM = "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-[16px] font-semibold text-accent hover:bg-background disabled:opacity-50";
// On a phone the actions are large tiles, three a row, the icon above a short
// word; the name's suggestion comes first, outlined in the accent.
const TILE = "flex min-h-[4.75rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[5px] px-1 py-2 text-center text-[16px] font-semibold leading-tight ring-inset [overflow-wrap:anywhere] disabled:opacity-50";
const TILE_OFF = `${TILE} bg-surface text-foreground ring-1 ring-border hover:ring-accent`;
const TILE_LEAD = `${TILE} bg-surface text-accent ring-2 ring-accent`;
const TILE_ON = `${TILE} bg-accent-soft text-accent ring-2 ring-accent`;
const TILE_WORD: Record<string, string> = { chat: "Chat" };
const tileWord = (key: string, label: string) => TILE_WORD[key] ?? ADD_SHORT[key] ?? label;

export function StepSetup({ name, who, whoInitial, nameOf, someoneElse, whenInitial, today, meId, lead = [], rows, more = [], preset, onDone, autoFocus = false, enterSubmits = false, onAnswer, hide = [], skip = true, stepName = "", context, history, submit, longHint = false }: {
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
  /** Enter in the name box sets it up with what is picked (+ Add step). */
  enterSubmits?: boolean;
  /** Told each pick, for a name box outside the rows (+ Add step's input). */
  onAnswer?: (a: SetupAnswer) => void;
  /** Rows not asked (the new task box: a queue list's step 1 gets its date
   *  when the task reaches Now; your own list has nobody else's turn). */
  hide?: ("who" | "when")[];
  /** Skip, and Escape as Skip. Off where the rows sit inside a box with its
   *  own button and its own Escape (the new task box). */
  skip?: boolean;
  /** The step's name as typed, for the recommendations (and the long name hint). */
  stepName?: string;
  /** What the context asks for, as an action key (a What's next suggestion's kind). */
  context?: string | null;
  /** Steps named like this one before, for this client or this person (setupHistory). */
  history?: HistoryStep[];
  /** A visible button beside Skip that sets it up with what is picked, as
   *  Enter does: "Add step" for a step not made yet. None when left out
   *  (What's next has Start it; the new task box has its own Add). */
  submit?: string;
  /** Under the name box: a name that is a whole request goes into the
   *  step's directions (the long name tidy moves it). */
  longHint?: boolean;
}) {
  const [whoPick, setWhoPick] = useState<string | null>(whoInitial);
  const [when, setWhen] = useState(whenInitial);
  const [q, setQ] = useState("");
  const [qAt, setQAt] = useState(0);
  const [showAll, setShowAll] = useState(false);
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
  // The rows shown, in order: the keys move between these.
  // Claude's turn needs no date (always today) and only what Claude should
  // do: Directions or To dos (Derek, 2026-10-14: "the only thing that we
  // really need to do at this point is add directions or a to-do list").
  const forClaude = whoPick === CLAUDE_ID;
  const shown = [0, 1, 2].filter((i) => !(i === 0 && hide.includes("who")) && !(i === 1 && (hide.includes("when") || forClaude)));
  const nextRow = (i: number) => shown.find((r) => r > i);
  const prevRow = (i: number) => [...shown].reverse().find((r) => r < i);
  useEffect(() => { if (autoFocus) focusRow(shown[0]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (): SetupAnswer => ({ who: whoPick, when });
  const pickWho = (k: string) => {
    setWhoPick(k);
    // Claude starts on it now: today, always.
    if (k === CLAUDE_ID) setWhen(today);
    onAnswer?.({ who: k, when: k === CLAUDE_ID ? today : when });
    setTimeout(() => focusRow(nextRow(0) ?? 2), 0);
  };
  const pickWhen = (d: string) => {
    setWhen(d);
    onAnswer?.({ who: whoPick, when: d });
    // The action is chosen already: this was the last thing to answer.
    if (preset) { onDone({ who: whoPick, when: d }); return; }
    setTimeout(() => focusRow(2), 0);
  };
  const act = (a: SetupAction) => {
    // Give to Claude with no menu item of its own: Claude's turn, today.
    if (a.key === "claude" && !more.some((m) => m.key === "claude") && !rows.some((r) => r.items.some((m) => m.key === "claude"))) {
      onDone({ who: CLAUDE_ID, when: today }, () => {});
      return;
    }
    const imp = impliedBy(a.key, meId, today);
    onDone({ who: imp.who ?? whoPick, when: imp.when ?? when }, a.onPick);
  };
  // A tap on the preset finishes; any other starts it.
  const tap = (a: SetupAction) => (preset === a.key ? onDone(answer(), a.disabled ? undefined : a.onPick) : act(a));
  const whenKey = whenKeyFor(when, today);
  // Every action on offer, once, the name's own label kept. Give to Claude is
  // one too: the menu's own where it has one, else Claude as Whose turn.
  const claudeTurn = !hide.includes("who") && who.some((c) => c.key === CLAUDE_ID);
  const pool: SetupAction[] = [...lead, ...rows.flatMap((r) => r.items), ...more,
    ...(claudeTurn ? [{ key: "claude", label: "Give to Claude", onPick: () => {} }] : [])]
    .filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
  const byKey = (k: string) => pool.find((a) => a.key === k);
  const recs = recommendActions({
    preset, lead: lead.map((a) => a.key), context, history: history ? historyKinds(stepName, history) : [],
    available: pool.filter((a) => !a.disabled).map((a) => a.key), stepName,
  }).flatMap((k) => { const a = byKey(k); return a ? [k === "claude" ? { ...a, label: "Give to Claude" } : a] : []; });
  // What the search finds: every action, the + More ones too, by any word.
  const needle = q.trim().toLowerCase();
  const found = !needle ? [] : pool
    .filter((a) => !a.disabled)
    .filter((a) => a.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle)) || a.label.toLowerCase().includes(needle));
  const known = who.some((c) => c.key === whoPick);
  const claudeActs = forClaude ? ["directions", "checklist"].flatMap((k) => { const a = pool.find((x) => x.key === k && !x.disabled); return a ? [a] : []; }) : [];
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape") { if (!skip) return; e.preventDefault(); e.stopPropagation(); onDone(answer()); return; }
    if (enterSubmits && e.key === "Enter" && !e.nativeEvent.isComposing && t.matches("input[data-name]")) { e.preventDefault(); onDone(answer()); return; }
    if (t.closest("input, textarea, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const row = [0, 1, 2].findIndex((i) => !!rowEl(i)?.contains(t));
    if (row < 0) return;
    if (/^[1-9]$/.test(e.key)) {
      const el = choicesOf(row)[Number(e.key) - 1];
      if (!el) return;
      e.preventDefault();
      (el.matches("button") ? el : el.querySelector<HTMLElement>("button"))?.click();
    } else if (e.key === "Tab" && !e.shiftKey && nextRow(row) != null) { e.preventDefault(); focusRow(nextRow(row)!); }
    else if (e.key === "Tab" && e.shiftKey && prevRow(row) != null) { e.preventDefault(); focusRow(prevRow(row)!); }
  };
  // Each row: its question, then its choices. On a phone the question is a
  // short word above them and they wrap onto new lines, never scrolling
  // sideways (Derek, 2026-10-14). A desktop wraps them too: the task panel
  // can be narrow, and "Pick a date" ran past its edge.
  const Row = ({ i, label, short, children }: { i: number; label: string; short: string; children: React.ReactNode }) => (
    <div className={`flex min-w-0 flex-col gap-1.5 sm:flex-row sm:gap-3 ${i === 2 ? "sm:items-start" : "sm:items-center"}`}>
      <span id={`${uid}-q${i}`} className={`shrink-0 text-[16px] font-semibold text-muted sm:w-[9.5rem] ${i === 2 ? "sm:pt-2.5" : ""}`}>
        <span className="sm:hidden">{short}</span><span className="max-sm:hidden">{label}</span>
      </span>
      <div id={`${uid}-row${i}`} role="group" aria-labelledby={`${uid}-q${i}`}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-0.5">{children}</div>
    </div>
  );
  const whoLabel = (c: SetupWho) => c.key === "else" ? <>{!known && whoPick ? nameOf?.(whoPick) ?? "Someone else" : "Someone else"}<I.chevron className="h-3.5 w-3.5 -rotate-90" /></> : c.label;
  return (
    <section aria-label="Set up this step" onKeyDown={onKeyDown} className="flex min-w-0 flex-col gap-3 sm:gap-2">
      {name}
      {longHint && isLongTitle(stepName) && <p className="-mt-1 text-[16px] text-muted">The full request goes into the step&apos;s directions</p>}
      {shown.includes(0) && Row({ i: 0, label: "Whose turn?", short: "Who", children: who.map((c) => c.key === "else" && someoneElse ? (
        <span key={c.key} data-choice className="shrink-0">
          {someoneElse(<span aria-pressed={!known && !!whoPick} className={!known && !!whoPick ? ON : OFF}>{whoLabel(c)}</span>, pickWho)}
        </span>
      ) : (
        <button key={c.key} data-choice aria-pressed={whoPick === c.key} onClick={() => pickWho(c.key)} className={whoPick === c.key ? ON : OFF}>{whoLabel(c)}</button>
      )) })}
      {shown.includes(1) && Row({ i: 1, label: "By when?", short: "When", children: (<>
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
      {claudeActs.length ? Row({ i: 2, label: "Tell Claude what to do", short: "Do", children: claudeActs.map((a) => {
        const Icon = ADD_ICON[a.key];
        return <button key={`c-${a.key}`} data-choice onClick={() => act(a)} className={OFF}>{Icon && <Icon className="h-4 w-4 shrink-0" />}{ADD_SHORT[a.key] ?? a.label}</button>;
      }) }) : Row({ i: 2, label: "What's the action?", short: "Do", children: (
        <div className="flex w-full min-w-0 flex-col gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setQAt(0); }} placeholder="Find an action" aria-label="Find an action"
            name="find-action" autoComplete="off" enterKeyHint="go"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setQAt((n) => Math.min(n + 1, Math.max(0, found.length - 1))); }
              else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setQAt((n) => Math.max(0, n - 1)); }
              else if (e.key === "Enter" && !e.nativeEvent.isComposing && needle && found[qAt]) { e.preventDefault(); e.stopPropagation(); act(found[qAt]); }
              // Nothing typed: Enter sets it up with what is picked, as Add step does.
              else if (e.key === "Enter" && !e.nativeEvent.isComposing && !needle && submit) { e.preventDefault(); e.stopPropagation(); onDone(answer()); }
            }}
            className="h-10 w-full rounded-[5px] bg-surface px-2.5 text-[16px] outline-none ring-1 ring-inset ring-border focus:ring-accent sm:max-w-[320px]" />
          {needle ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {found.length ? found.map((a, i) => {
                const Icon = ADD_ICON[a.key];
                return <button key={`f-${a.key}`} data-choice aria-pressed={i === qAt} onClick={() => act(a)} className={i === qAt ? ON : OFF}>{Icon && <Icon className="h-4 w-4 shrink-0" />}{a.label}</button>;
              }) : <span className="text-[16px] text-muted">Nothing matches &ldquo;{q}&rdquo;</span>}
            </div>
          ) : (<>
            {/* Three recommended: tiles on a phone, buttons on a desktop. */}
            <div className="grid w-full grid-cols-3 gap-2 sm:hidden">
              {recs.map((a, i) => {
                const Icon = ADD_ICON[a.key];
                const on = preset === a.key;
                return (
                  <button key={`t-${a.key}`} aria-pressed={on} disabled={a.disabled && !on} title={a.title ?? (tileWord(a.key, a.label) !== a.label ? a.label : undefined)}
                    onClick={() => tap(a)} className={on ? TILE_ON : i === 0 ? TILE_LEAD : TILE_OFF}>
                    {Icon ? <Icon className="h-6 w-6 shrink-0" /> : <I.plus className="h-6 w-6 shrink-0" />}{lead.some((l) => l.key === a.key) || a.key === "claude" ? a.label : tileWord(a.key, a.label)}
                  </button>
                );
              })}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-sm:hidden">
              {recs.map((a, i) => {
                const Icon = ADD_ICON[a.key];
                const on = preset === a.key;
                return (
                  <button key={`r-${a.key}`} data-choice aria-pressed={on} disabled={a.disabled && !on} title={a.title} onClick={() => tap(a)}
                    className={on ? ON : i === 0 ? `${CHOICE} bg-surface text-accent ring-2 ring-accent` : OFF}>
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}{a.label}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}
              className="self-start text-[16px] font-semibold text-accent underline decoration-dotted underline-offset-4 hover:text-foreground">
              {showAll ? "Fewer actions" : "All actions"}
            </button>
            {showAll && (<>
              <div className="grid w-full grid-cols-3 gap-2 sm:hidden">
                {rows.flatMap((r) => r.items).map((a) => {
                  const Icon = ADD_ICON[a.key];
                  const on = preset === a.key;
                  return (
                    <button key={`ta-${a.key}`} aria-pressed={on} disabled={a.disabled && !on} title={a.title ?? (tileWord(a.key, a.label) !== a.label ? a.label : undefined)}
                      onClick={() => tap(a)} className={on ? TILE_ON : TILE_OFF}>
                      {Icon ? <Icon className="h-6 w-6 shrink-0" /> : <I.plus className="h-6 w-6 shrink-0" />}{tileWord(a.key, a.label)}
                    </button>
                  );
                })}
                {more.length > 0 && (
                  <ActionMenu sheet label={<span className="flex flex-col items-center gap-1.5"><I.plus className="h-6 w-6" />More</span>} title="More to add to this step"
                    triggerClassName={`${TILE_OFF} w-full text-accent`}
                    items={more.map((a) => !a.disabled && { label: a.label, onClick: () => act(a) })} />
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1 max-sm:hidden">
                {rows.map((r) => (
                  // The row's word in its own column and its choices wrapping beside
                  // it, so a narrow panel never leaves a choice hanging under the word.
                  <div key={r.label} className="flex min-w-0 items-start gap-x-2">
                    <span className="w-[7.5rem] shrink-0 pt-2 text-[16px] text-muted">{r.label}</span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
                    {r.items.map((a) => {
                      const Icon = ADD_ICON[a.key];
                      const on = preset === a.key;
                      return (
                        <button key={a.key} aria-pressed={on} disabled={a.disabled && !on} title={a.title} onClick={() => tap(a)}
                          className={on ? ON : ITEM}>
                          {Icon && <Icon className="h-4 w-4 shrink-0" />}{ADD_SHORT[a.key] ?? a.label}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                ))}
                {more.length > 0 && (
                  <span className="shrink-0 self-start">
                    <ActionMenu sheet label={<span className="inline-flex items-center gap-1.5"><I.plus className="h-4 w-4" />More</span>} title="More to add to this step"
                      triggerClassName="inline-flex h-10 items-center whitespace-nowrap rounded-[5px] px-2.5 text-[16px] font-semibold text-accent hover:bg-background"
                      items={more.map((a) => !a.disabled && { label: a.label, onClick: () => act(a) })} />
                  </span>
                )}
              </div>
            </>)}
          </>)}
        </div>
      ) })}
      {(skip || submit) && <div className="flex flex-wrap items-center justify-end gap-4">
        {skip && <button onClick={() => onDone(answer())} title="Keep what is picked (Escape)" className="text-[16px] font-medium text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">Skip</button>}
        {/* The one dark button while no action is picked (a picked one is
            the button to finish on). */}
        {submit && <button onClick={() => onDone(answer())} title="Enter"
          className={preset ? "h-10 rounded-[5px] px-4 text-[16px] font-semibold ring-1 ring-inset ring-border hover:bg-background" : "h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90"}>{forClaude && claudeActs.length ? "Give to Claude" : submit}</button>}
      </div>}
    </section>
  );
}

/** One choice on a What's next card: what it does stays as its title. */
export type NextPick = { key: string; label: string; says: string; onClick: () => void };

/** A What's next card's choices, the same as the set up (Derek, 2026-10-14:
 *  nine rows with a line each was too much): three recommended, the first
 *  the dark button, "All actions" for the rest, and "The task is finished"
 *  as a small link at the bottom. No intro and no descriptions: what each
 *  does is its tooltip. */
export function WhatsNextPicks({ picks, rest, finish }: { picks: NextPick[]; rest: NextPick[]; finish: NextPick }) {
  const [showAll, setShowAll] = useState(false);
  const uid = useId();
  const btn = (c: NextPick, i: number, dark: boolean) => (
    <span key={c.key} className="contents">
      <button onClick={c.onClick} title={c.says} aria-describedby={`${uid}-${i}`}
        className={`min-h-10 max-w-full rounded-[5px] px-4 py-1.5 text-left text-[16px] font-semibold leading-snug [overflow-wrap:anywhere] ${dark ? "bg-accent text-white hover:opacity-90" : "bg-surface ring-1 ring-inset ring-border hover:bg-background"}`}>{c.label}</button>
      <span id={`${uid}-${i}`} className="sr-only">{c.says}</span>
    </span>
  );
  return (
    <section aria-label="What's next" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {picks.map((c, i) => btn(c, i, i === 0))}
      </div>
      {rest.length > 0 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}
          className="self-start text-[16px] font-semibold text-accent underline decoration-dotted underline-offset-4 hover:text-foreground">
          {showAll ? "Fewer actions" : "All actions"}
        </button>
      )}
      {showAll && (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {rest.map((c, i) => btn(c, picks.length + i, false))}
        </div>
      )}
      <button onClick={finish.onClick} title={finish.says}
        className="mt-1 self-start text-[16px] font-medium text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">{finish.label}</button>
    </section>
  );
}

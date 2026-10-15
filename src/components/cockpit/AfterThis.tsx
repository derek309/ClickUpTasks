"use client";

// After this (Derek, 2026-10-15, step-flow-mockup.html): the bottom of the
// current step, on its page and on the task page. The next step's name, then
// one sentence like the step's own, each word a picker: "● Pamela's turn,
// check in Fri, Oct 17, waiting for Pamela's reply, 🔔 add a reminder". Whose
// turn, when (the check in for a wait on the client; Claude has none, always
// today), what, and an optional reminder for someone else's turn. Filled, Done
// (or Send) finishes this step and starts that one. Empty, Done asks What's
// next as before. lib/afterThis holds the rules.
import { useState, type ReactNode } from "react";
import { CLAUDE_ID, formatDayDate, type StepRemind, type Subtask } from "@/lib/data";
import { ACTION_WORDS, afterThisAction, afterThisWho, remindKind, remindWord, type AfterAction } from "@/lib/afterThis";
import { remindersOn } from "@/lib/clientRequests";
import { InlineDate } from "./GroupedList";
import { MenuSheet } from "./ActionMenu";
import { useEscapeToClose } from "./useEscapeToClose";
import { I } from "./ui";

/** The step After this shows: the plan's next step, or the suggestion
 *  (suggestedAfter) while nothing is saved yet. */
export type AfterStep = Pick<Subtask, "title"> & Partial<Subtask>;

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
        <MenuSheet label={title} onClose={() => setOpen(false)}>{body}</MenuSheet>
      </>)}
    </>
  );
}

/** The client's reminder word on their step (Derek and Justin, 2026-10-15):
 *  "🔔 reminders on" by default with a need by date, its menu On or Off. An
 *  older choice (once, every N) reads as it was until changed. */
export function ClientRemindWord({ remind, needBy, first, onRemind, note, className }: { remind?: StepRemind; needBy: string | null; first: string; onRemind: (r: StepRemind | null) => void; note?: string; className: string }) {
  const on = remindersOn({ remind, needBy });
  const legacy = !!remind && "every" in remind;
  const label = legacy ? remindWord(remind, first, needBy ? formatDayDate(needBy) : null) : on ? "reminders on" : "reminders off";
  return (
    <WordMenu title={`Remind ${first} about this`} heading={`Remind ${first} about this`} className={className} note={note}
      label={<><span aria-hidden>🔔 </span>{label}</>}
      items={[
        // On is the default (nothing saved) once there is a need by date; without one, every 3 business days.
        { key: "on", label: "On", sub: "Every 3 days, then the due day, then daily once late", on: on && !legacy, onClick: () => onRemind(needBy ? null : { every: 3 }) },
        { key: "off", label: "Off", sub: `Nothing goes to ${first} about this`, on: !on, onClick: () => onRemind({ off: true }) },
      ]} />
  );
}

export function AfterThis({ next, suggested = false, clientFirst, ownerId, meId, who, nameOf, onName, onWho, onDue, onAction, onRemind, remindNote, canRemindClient = true }: {
  /** The next step, or the suggestion; null when After this is empty. */
  next: AfterStep | null;
  /** True while `next` is only the suggestion (nothing saved yet). */
  suggested?: boolean;
  clientFirst: string;
  ownerId: string | null;
  meId: string | null;
  /** Whose turn it can be: you, teammates, Claude, and "client". */
  who: { key: string; label: string }[];
  nameOf: (id: string) => string;
  /** The name typed: makes the next step when there is none (or takes the
   *  suggestion), renames it, and an empty name empties After this. */
  onName: (title: string) => void;
  /** A word picked: on the next step (the suggestion is saved first). */
  onWho: (key: string) => void;
  onDue: (date: string | null) => void;
  onAction: (a: AfterAction | null) => void;
  onRemind: (r: StepRemind | null) => void;
  /** Under the client's reminder choices: for review first, or sends itself. */
  remindNote?: string;
  /** No email to send a client reminder to: no reminder word for them. */
  canRemindClient?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? next?.title ?? "";
  const word = "font-semibold underline decoration-dotted underline-offset-4 hover:decoration-solid";
  const pickWord = `rounded-[5px] text-left ${word}`;
  const dateWord = `-mx-1 ${word} text-[16px] sm:text-[18px]`;
  const whoKey = next ? afterThisWho(next, ownerId) : null;
  const turnWord = whoKey === "client" ? `${clientFirst}'s turn` : whoKey === CLAUDE_ID ? "Claude's turn" : !whoKey || whoKey === meId ? "Your turn" : `${nameOf(whoKey)}'s turn`;
  const kind = next ? remindKind(whoKey, { ownerId, meId }) : null;
  const remindTo = whoKey === "client" ? clientFirst : whoKey ? nameOf(whoKey) : "";
  const action = next ? afterThisAction(next) : null;
  const r = next?.remind;
  const checkIn = next?.due ? formatDayDate(next.due) : null;
  const parts: ReactNode[] = [];
  if (next) {
    if (whoKey !== CLAUDE_ID) parts.push(
      <span key="d">
        {whoKey === "client" ? "need by " : next.due ? "due " : ""}
        <span className="inline-flex items-baseline">
          <InlineDate value={next.due ?? null} onChange={(v) => onDue(v)}
            emptyLabel={<span className="text-accent underline decoration-dotted underline-offset-4">{whoKey === "client" ? "set a date" : "no due date"}</span>}
            formatValue={formatDayDate} className={dateWord} />
        </span>
      </span>,
    );
    if (whoKey !== "client" && whoKey !== CLAUDE_ID) parts.push(
      <WordMenu key="a" title="What the next step is" className={action ? pickWord : `${pickWord} text-accent`}
        label={action && action !== "wait" && action !== "brief" ? ACTION_WORDS[action] : "pick what"}
        items={[...(Object.keys(ACTION_WORDS) as Exclude<AfterAction, "wait" | "brief">[]).map((k) => ({ key: k, label: ACTION_WORDS[k], on: action === k, onClick: () => onAction(k) })),
          ...(action ? [{ key: "none", label: "Nothing to make", muted: true, onClick: () => onAction(null) }] : [])]} />,
    );
    if (kind === "client" && canRemindClient) parts.push(
      <ClientRemindWord key="r" remind={r} needBy={next.due ?? null} first={clientFirst} note={remindNote} onRemind={onRemind} className={`${pickWord} text-accent`} />,
    );
    else if (kind === "teammate") parts.push(
      <WordMenu key="r" title={`Remind ${remindTo} about this`} heading={`Remind ${remindTo} about this`}
        className={`${pickWord} text-accent`}
        label={<><span aria-hidden>🔔 </span>{r ? remindWord(r, remindTo, checkIn) : "add a reminder"}</>}
        items={[
          { key: "day", label: "The day before", on: !!r && "at" in r && r.at === "day_before", onClick: () => setRemind({ at: "day_before" }) },
          { key: "morning", label: "The morning it's due", on: !!r && "at" in r && r.at === "morning", onClick: () => setRemind({ at: "morning" }) },
          ...(r ? [{ key: "off", label: "Off", muted: true, onClick: () => setRemind(null) }] : []),
        ]} />,
    );
  }
  function setRemind(x: StepRemind | null) { onRemind(x); }
  const dot = whoKey === "client" ? "#d97706" : whoKey === CLAUDE_ID ? "#ea580c" : !whoKey || whoKey === meId ? "#ef4444" : "#d97706";
  return (
    <section aria-label="After this" className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[17px] font-bold">After this</h3>
      <input value={name} aria-label="The next step" placeholder="Name the next step, or leave it for later" autoComplete="off" name="next-step"
        onFocus={() => setDraft(name)} onBlur={() => setDraft(null)}
        onChange={(e) => { setDraft(e.target.value); onName(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape" && draft !== null) { e.stopPropagation(); e.currentTarget.blur(); } }}
        className={`w-full min-w-0 rounded-[5px] bg-surface px-3 py-2 text-[17px] outline-none ring-1 ring-inset ring-border placeholder:font-medium placeholder:text-muted focus:ring-accent ${suggested ? "font-medium text-muted focus:text-foreground" : "font-semibold"}`} />
      {next && name.trim() && (
        <div className="text-[16px] leading-snug sm:text-[18px]">
          <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: dot }} />
          <WordMenu title="Whose turn it is next" className={pickWord} label={turnWord}
            items={who.map((c) => ({ key: c.key, label: c.key === "client" ? clientFirst : c.label, on: c.key === whoKey || (c.key === meId && !whoKey), onClick: () => onWho(c.key) }))} />
          {parts.map((p, i) => <span key={i}>{", "}{p}</span>)}
        </div>
      )}
    </section>
  );
}

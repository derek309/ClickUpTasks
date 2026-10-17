"use client";

// "✨ Claude read it" (Derek, 2026-10-17, ai-help-mockup.html sections 1 and
// 1b): under a client's email on its step's page, what Claude made of it: a
// step (its name, Description, the asks as a checklist with their dates, whose
// turn and when, and why), or, when the asks have their own dates, designs or
// approvals, the choice of one task each in a list. Use this makes a NEW
// draft step after this one; Make N tasks makes the list and its tasks;
// Change it opens the same fields to edit first; No thanks hides it for this
// email. Nothing is given, sent or saved until one of those is pressed.
// Read once per email (kept on the step), when the page first opens with it.
import { useEffect, useState } from "react";
import { formatDayDate } from "@/lib/data";
import { differentDates, emailWorthReading, needsReading, shortDate, splitChoice, suggestionShows, type AiAsk, type AiEmailSuggest } from "@/lib/aiSteps";
import type { ReceivedEmail, Subtask } from "@/lib/data";

export const AI_BOX = "rounded-[5px] border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-400/30 dark:bg-violet-500/10";
export const AI_LABEL = "text-[16px] font-bold text-violet-700 dark:text-violet-300";
const LINK = "text-[16px] font-semibold text-accent underline-offset-4 hover:underline";
const QUIET = "text-[16px] text-muted hover:text-foreground";
const FIELD = "w-full min-w-0 rounded-[5px] bg-surface px-3 py-2 text-[16px] outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-accent";

export type Who = { key: string; label: string };

export function AiEmailBox({ step, email, sender, clientFirst, choices, turnWord, nameOf, read, onCache, onUse, onSplit, onOpenTask }: {
  step: Subtask;
  /** The email it reads: the newest on the step. */
  email: ReceivedEmail;
  /** Who wrote it, by first name ("Chelsea"). */
  sender: string;
  /** The client the task is for ("Brian"). */
  clientFirst: string;
  /** Whose turn it can be: You, teammates, Claude, the client. */
  choices: Who[];
  /** "Michaella's turn" for a choice key. */
  turnWord: (key: string | null) => string;
  /** "you", "Michaella", "Claude", "Brian" for a choice key. */
  nameOf: (key: string | null) => string;
  /** Asks Claude: the suggestion, "off" when AI in steps is off, null when it failed. */
  read: () => Promise<AiEmailSuggest | "off" | null>;
  /** Keeps it on the step (aiSuggest). */
  onCache: (s: AiEmailSuggest) => void;
  /** Use this: a new draft step after this one. */
  onUse: (s: AiEmailSuggest) => void;
  /** Make N tasks in the list. */
  onSplit: (s: AiEmailSuggest) => void;
  onOpenTask?: (id: string) => void;
}) {
  const worth = emailWorthReading(email);
  const want = worth && needsReading(step, email.messageId);
  const [busy, setBusy] = useState(want);
  const [off, setOff] = useState(false);
  const [edit, setEdit] = useState<AiEmailSuggest | null>(null);
  const [pick, setPick] = useState<"split" | "one" | null>(null);
  const fetchIt = () => read().then((r) => {
    setBusy(false);
    if (r === "off") { setOff(true); return; }
    if (r) { setEdit(null); setPick(null); onCache(r); }
  });
  // Read it again: asked fresh, the old suggestion replaced.
  const again = () => { setBusy(true); void fetchIt(); };
  // Once, when the page first opens with this email (busy starts true then).
  useEffect(() => { if (want) void fetchIt(); }, [email.messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (off || !worth) return null;
  const made = step.aiSuggest?.messageId === email.messageId ? step.aiSuggest.made ?? [] : [];
  if (made.length) return (
    <section aria-label="Made from this email" className="flex flex-col gap-1.5">
      <h3 className="text-[16px] font-semibold">Made from this email</h3>
      <ul className="flex flex-col rounded-[5px] ring-1 ring-inset ring-border">
        {made.map((t, i) => (
          <li key={t.id} className={i > 0 ? "border-t" : ""}>
            <button onClick={() => onOpenTask?.(t.id)} className="flex min-h-11 w-full items-center px-3 text-left text-[16px] font-medium text-accent hover:bg-background">{t.title}</button>
          </li>
        ))}
      </ul>
    </section>
  );
  if (busy) return <p className={`${AI_BOX} ${AI_LABEL}`} aria-live="polite">✨ Claude is reading it…</p>;
  if (!suggestionShows(step, email.messageId)) return null;
  const s = edit ?? step.aiSuggest!;
  const choice = splitChoice(s);
  const split = choice.offer && (pick ?? (choice.byDefault ? "split" : "one")) === "split";
  const n = s.items.length;
  const turn = `${turnWord(s.who)}${s.due ? `, due ${formatDayDate(s.due)}` : ""}`;
  const set = (patch: Partial<AiEmailSuggest>) => setEdit({ ...s, ...patch });
  const setItem = (i: number, patch: Partial<AiAsk>) => set({ items: s.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const dismiss = () => onCache({ ...step.aiSuggest!, dismissed: true });
  const go = () => (split ? onSplit(s) : onUse(s));

  return (
    <section aria-label="Claude read it" className={`${AI_BOX} flex flex-col gap-3`}>
      <p className={AI_LABEL}>
        {choice.offer
          ? <>✨ {sender} asked for {n} things{differentDates(s.items) ? " with different dates" : ""}</>
          : <>✨ Claude read it. Here&apos;s the step:</>}
      </p>
      {choice.offer && (
        <div className="flex flex-col gap-2">
          {s.ownWork && <p className="text-[16px] text-foreground">Each needs its own design and {sender}&apos;s OK, so I&apos;d keep them apart.</p>}
          {([["split", `Make ${n} tasks in "${s.list || s.name || "a new list"}"`, `A list on ${clientFirst} that finishes, as a queue, 2 at a time in order of the dates. Each task: ${nameOf(s.who) === "you" ? "you make it" : `${nameOf(s.who)} makes it`}, you check it, ${sender} approves.`],
            ["one", "Keep it as one step", "One checklist on a new step. Fine for small things done in one go."]] as const).map(([k, title, sub]) => (
            <button key={k} type="button" aria-pressed={(k === "split") === split} onClick={() => setPick(k)}
              className={`flex flex-col items-start gap-0.5 rounded-[5px] bg-surface px-3 py-2.5 text-left ring-inset ${(k === "split") === split ? "ring-2 ring-accent" : "ring-1 ring-border hover:bg-background"}`}>
              <span className="text-[16px] font-semibold">{title}</span>
              <span className="text-[16px] text-muted">{sub}</span>
            </button>
          ))}
        </div>
      )}
      {edit ? (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1"><span className="text-[16px] font-semibold">{split ? "List" : "Step"}</span>
            <input value={split ? s.list : s.name} onChange={(e) => set(split ? { list: e.target.value } : { name: e.target.value })} className={FIELD} /></label>
          <label className="flex flex-col gap-1"><span className="text-[16px] font-semibold">Description</span>
            <textarea value={s.description} rows={3} onChange={(e) => set({ description: e.target.value })} className={`${FIELD} resize-y`} /></label>
          <span className="text-[16px] font-semibold">{split ? "Tasks" : "Checklist"}</span>
          {s.items.map((it, i) => (
            <div key={i} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
              <input aria-label={`Item ${i + 1}`} value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} className={`${FIELD} sm:flex-1`} />
              <span className="flex items-center gap-2">
                <input aria-label={`Item ${i + 1} date`} type="date" value={it.when ?? ""} onChange={(e) => setItem(i, { when: e.target.value || null, whenLabel: e.target.value ? shortDate(e.target.value) : "ASAP" })} className={`${FIELD} flex-1 sm:w-auto`} />
                <button onClick={() => set({ items: s.items.filter((_, k) => k !== i) })} aria-label={`Remove item ${i + 1}`} className="h-11 shrink-0 rounded-[5px] px-3 text-[16px] text-muted hover:bg-background hover:text-danger">Remove</button>
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[16px]"><span className="font-semibold">Whose turn</span>
              <select value={s.who ?? ""} onChange={(e) => set({ who: e.target.value || null })} className={`${FIELD} w-auto`}>
                {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select></label>
            <label className="flex items-center gap-2 text-[16px]"><span className="font-semibold">Due</span>
              <input type="date" value={s.due ?? ""} onChange={(e) => set({ due: e.target.value || null })} className={`${FIELD} w-auto`} /></label>
          </div>
        </div>
      ) : (<>
        {!split && s.description && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[16px] font-semibold">Description</span>
            <p className="text-[16px] text-muted [overflow-wrap:anywhere]">{s.description}</p>
          </div>
        )}
        <div className="flex flex-col">
          {!split && <span className="text-[16px] font-semibold">Checklist</span>}
          <ul className={split ? "rounded-[5px] bg-surface ring-1 ring-inset ring-border" : ""}>
            {s.items.map((it, i) => (
              <li key={i} className={`flex items-start gap-2.5 py-1.5 text-[16px] ${split ? "px-3" : ""} ${i > 0 ? "border-t border-violet-200/70 dark:border-violet-400/20" : ""}`}>
                {!split && <span aria-hidden className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-[5px] bg-surface ring-2 ring-inset ring-border" />}
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{it.title}</span>
                {it.whenLabel && <span className="shrink-0 pl-2 text-muted">{it.whenLabel}</span>}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[16px] text-muted"><span className="font-semibold text-violet-700 dark:text-violet-300">Suggested turn:</span> {turn}{s.why ? ` (${s.why})` : ""}.</p>
      </>)}
      <div className="flex flex-col-reverse gap-3 border-t border-violet-200 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-violet-400/30">
        <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {edit ? <button onClick={() => setEdit(null)} className={LINK}>Undo changes</button> : <button onClick={() => setEdit({ ...s })} className={LINK}>Change it</button>}
          <button onClick={dismiss} className={QUIET}>No thanks</button>
          <button onClick={again} className={QUIET}>Read it again</button>
        </span>
        <button onClick={go} disabled={!s.items.length && !s.name.trim()}
          className="h-11 w-full rounded-[5px] bg-accent px-5 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-40 sm:w-auto">{split ? `Make ${n} tasks` : "Use this"}</button>
      </div>
      {!split && <p className="text-[16px] text-muted">Use this adds it as the next step. It stays a draft until you press Give to.</p>}
    </section>
  );
}

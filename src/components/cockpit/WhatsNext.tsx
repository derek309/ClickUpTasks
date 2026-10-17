"use client";

// What's next, once a step is done (Derek, 2026-10-17,
// step-done-then-next-mockup.html): the step folds to one line, "✓ Hand off ·
// done by Michaella", and in its place the next step's name, the same turn
// line the step card uses ("Brian's turn, due Tomorrow", each word a picker),
// one line on what will happen, "Nothing next, close the task" and the button
// that follows whose turn it is. One component, on the task page and at the
// foot of a step's page. Escape or leaving it keeps the step done with no next
// step named; the task then asks What's next as it always has.
import { useEffect, useState } from "react";
import { prefill, type AiNext } from "@/lib/aiSteps";
import { CLAUDE_ID } from "@/lib/data";
import { descriptionLabel, turnWord, whatsNextButton, whatsNextSays } from "@/lib/stepThenNext";
import { TurnLine, type TurnChoice } from "./TurnLine";
import { friendlyDue } from "./GroupedList";
import { StepWriteFields } from "./NewStepBox";

export type WhatsNextAnswer = { name: string; who: string | null; due: string | null; waits: boolean;
  /** Its Description and to dos as typed (empty ones dropped on save). */
  description?: string; todos?: string[] };

export function WhatsNext({ done, first, name: initialName = "", suggestion, waitName, who: initialWho, due: initialDue, choices, meId, clientFirst, nameOf, onSave, onCloseTask, today, ai: cachedAi = null, askAi, onAi }: {
  /** The step just done, folded: "✓ Hand off · done by Michaella". */
  done: string;
  /** What comes first, before naming a next step: the HTML review on the
   *  step just done, emailed to the client for review. */
  first?: { label: string; onClick: () => void } | null;
  /** The next step's name when the plan has one already. */
  name?: string;
  /** The suggested next step, shown in the name box until something is typed. */
  suggestion?: string | null;
  /** A next step that only waits on the client's reply (the plan's, or the
   *  suggestion after an email): on the client's turn under this name it
   *  waits, with no new email to write. */
  waitName?: string | null;
  /** Whose turn it starts as: a member id, Claude's, or "client". */
  who: string | null;
  due: string | null;
  /** You, teammates, Claude, the client by first name (keys as `who`). */
  choices: { key: string; label: string }[];
  meId: string | null;
  clientFirst: string;
  nameOf: (id: string) => string;
  onSave: (a: WhatsNextAnswer) => void;
  onCloseTask: () => void;
  today: string;
  /** Claude's next step, asked once for the step just done and kept on it. */
  ai?: AiNext | null;
  /** Asks Claude when nothing is kept yet (never blocks: the rule's
   *  suggestion shows meanwhile, and a failure says nothing). */
  askAi?: () => Promise<AiNext | null>;
  /** Keeps Claude's answer on the step just done. */
  onAi?: (n: AiNext) => void;
}) {
  // What was typed or picked, null or undefined until then: any edit wins
  // over Claude's suggestion, and Claude's over the rule's (lib/aiSteps prefill).
  const [typed, setName] = useState<string | null>(initialName ? initialName : null);
  const [picked, setWho] = useState<string | null | undefined>(undefined);
  const [dated, setDue] = useState<string | null | undefined>(undefined);
  const [fresh, setFresh] = useState<AiNext | null>(null);
  // Its Checklist open, its Description once asked for, as on a new step (NewStepBox).
  const [description, setDescription] = useState("");
  const [todos, setTodos] = useState<string[]>([]);
  const [descOpen, setDescOpen] = useState(false);
  const ai = cachedAi ?? fresh;
  useEffect(() => {
    if (cachedAi || !askAi) return;
    let live = true;
    void askAi().then((n) => { if (n && live) { setFresh(n); onAi?.(n); } }).catch(() => {});
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = prefill({ name: "", who: initialWho, due: initialDue }, ai && choices.some((c) => c.key === ai.who) ? ai : ai ? { ...ai, who: null } : null, { name: typed, who: picked, due: dated });
  const name = shown.name;
  const who = shown.who;
  const due = shown.due;
  const o = { meId, clientFirst, nameOf };
  const finalName = name.trim() || suggestion?.trim() || "";
  const waits = who === "client" && !!waitName && finalName === waitName.trim();
  const button = waits ? `Wait for ${clientFirst}` : whatsNextButton(who, o);
  const says = waits ? `It waits for ${clientFirst}'s reply.` : whatsNextSays(who, o);
  const save = () => { if (finalName) onSave({ name: finalName, who, due: who === CLAUDE_ID ? today : due, waits,
    // Empty ones are left out.
    ...(description.trim() ? { description } : {}), ...(todos.some((t) => t.trim()) ? { todos: todos.filter((t) => t.trim()) } : {}) }); };
  const turnChoices: TurnChoice[] = choices.map((c) => ({ ...c, on: c.key === who || (!who && c.key === meId) }));
  const dot = who === "client" ? "#d97706" : who === CLAUDE_ID ? "#7c3aed" : !who || who === meId ? "#ef4444" : "#d97706";
  return (
    <section aria-label="What's next" className="flex min-w-0 flex-col gap-3">
      <p className="text-[16px] font-semibold text-success [overflow-wrap:anywhere]">{done}</p>
      <h3 className="text-[18px] font-bold">What&apos;s next?</h3>
      {first && <button onClick={first.onClick} className="h-11 self-start rounded-[5px] border bg-surface px-4 text-[16px] font-semibold text-accent hover:bg-background">{first.label}</button>}
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="The next step" name="next-step" autoComplete="off" enterKeyHint="done"
        autoFocus={typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 640px)").matches}
        placeholder={suggestion?.trim() || "Name the next step"}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        className="w-full min-w-0 rounded-[5px] bg-surface px-3 py-2 text-[17px] font-semibold outline-none ring-1 ring-inset ring-border placeholder:font-medium placeholder:text-muted focus:ring-2 focus:ring-accent" />
      {(() => {
        const d = descriptionLabel(who === "client" ? "client" : who === CLAUDE_ID ? "claude" : !who || who === meId ? "me" : "teammate", clientFirst);
        return <StepWriteFields label={d.label} tone={d.tone} description={description} onDescription={setDescription} onTodos={setTodos}
          descriptionOpen={descOpen} onOpenDescription={() => setDescOpen(true)} />;
      })()}
      <TurnLine word={turnWord(who, o)} choices={turnChoices} onPick={(k) => setWho(k)}
        lead={<span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: dot }} />}
        fixedDate={who === CLAUDE_ID ? "today" : undefined}
        dateLead={who === "client" ? "need by" : "due"} date={due} onDate={(d) => setDue(d)}
        formatDate={friendlyDue} />
      <p className="text-[16px] text-muted">{says}</p>
      {shown.why && <p className="text-[16px] text-muted"><span className="font-semibold text-violet-700 dark:text-violet-300">✨ Why:</span> {shown.why}</p>}
      <div className="flex flex-col-reverse gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <button onClick={onCloseTask} className="self-center text-[16px] font-semibold text-accent underline-offset-4 hover:underline sm:self-auto">Nothing next, close the task</button>
        <button onClick={save} disabled={!finalName}
          className="h-11 w-full rounded-[5px] bg-accent px-5 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-40 sm:w-auto">{button}</button>
      </div>
    </section>
  );
}

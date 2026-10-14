"use client";

// The current step, open on the task page (Derek, 2026-10-14, mockup
// current-step-inline-mockup.html): whose turn it is, its directions, its to
// dos, the work it holds, and how it ends, with no click to get to the work.
// The step's own page (Open the step) still has its history and messages.
// Its directions and to dos are the step page's own (useStepDirections,
// useStepTodos), so they edit and save the same way in both places.
import { useState } from "react";
import type { Message, StepTodo, Subtask } from "@/lib/data";
import { suggestStepActions, type StepSuggestKind } from "@/lib/stepSuggest";
import { useStepDirections, useStepTodos, type StepSetupProps } from "./StepPage";
import { StepSetup, ADD_SHORT, addRowsOf } from "./StepSetup";

type AddOption = { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void };

/** The same name, whatever the case and spacing: a step named as its task
 *  does not say its name again (Derek, 2026-10-14). */
export const sameStepName = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export function CurrentStep({ sub, number, showName, firstName, tone, meId, messages, onPatchSub, onRename, clientItems = [], onToggleClientItem, onTodoDone, onAskTodos,
  addOptions = [], held, outFor, doneActions, setup, followBox, planBits, onMarkDone, onSendHeldEmail, onOpenStep }: {
  sub: Subtask;
  /** Its number in the steps, shown with its name. */
  number: number;
  /** False when the step has the task's name: only whose turn it is shows. */
  showName: boolean;
  firstName: string;
  /** Whose move it is (TaskDrawer stepTone): the line's words and colour. */
  tone: { say: string | null; word: string; sayTone: string };
  meId: string | null;
  messages: Message[];
  onPatchSub: (patch: Partial<Subtask>) => void;
  onRename: (title: string) => void;
  clientItems?: Subtask[];
  onToggleClientItem?: (id: string) => void;
  onTodoDone?: (todo: StepTodo) => void;
  onAskTodos?: (todoIds: string[]) => void;
  /** What the step's + Add offers (TaskDrawer stepAddOptions). */
  addOptions?: AddOption[];
  held?: React.ReactNode;
  /** The client's waiting step: the review out with them, in place of held. */
  outFor?: React.ReactNode;
  /** How a waiting, check in or "what's next?" step ends, in place of Done. */
  doneActions?: React.ReactNode;
  /** Not set up yet (Start it, without answering): asked here. */
  setup?: StepSetupProps | null;
  followBox?: React.ReactNode;
  planBits?: React.ReactNode;
  onMarkDone: () => void;
  onSendHeldEmail?: () => void;
  onOpenStep: () => void;
}) {
  const whatsNext = !sub.done && /: what's next\?$/.test(sub.title);
  const dir = useStepDirections({ sub, onPatchSub, inline: true });
  const todo = useStepTodos({ sub, onPatchSub, messages, first: firstName, clientItems, onToggleClientItem, onTodoDone, onAskTodos, inline: true });
  // Naming a "what's next?" step: the box stays while typing, though the
  // first letter renames it.
  const [naming, setNaming] = useState(false);
  const options: AddOption[] = [
    { key: "directions", label: "Directions", disabled: dir.open, onPick: dir.start },
    { key: "checklist", label: "Checklist", onPick: () => todo.ref.current?.focus() },
    ...addOptions,
  ];
  // The step's main quick action: what its name suggests, as on its page,
  // gone once the step holds that kind of work.
  const holdsKind = (k: StepSuggestKind) =>
    k === "checklist" ? todo.todos.length > 0 || clientItems.length > 0
    : k === "text" ? sub.draftMessage?.channel === "sms"
    : (sub.holds ?? []).includes(k);
  const optionFor = (k: StepSuggestKind) => options.find((o) => o.key === k);
  const named = whatsNext ? [] : suggestStepActions(sub.title, firstName);
  const quick = sub.done || sub.onClient || outFor !== undefined ? null : named
    .filter((x) => !holdsKind(x.kind) && optionFor(x.kind) && !optionFor(x.kind)!.disabled)
    .map((x) => ({ label: x.label, onPick: optionFor(x.kind)!.onPick }))[0] ?? null;
  // Its email is written and all it asks for is on it: finishing is sending.
  const sendReady = !!onSendHeldEmail && holdsKind("email")
    && named.every((x) => x.kind === "email" || !optionFor(x.kind) || holdsKind(x.kind));
  const addRows = setup ? addRowsOf(options, firstName, new Set(quick ? named.map((x) => x.kind) : [])) : null;
  const link = "font-semibold text-accent underline-offset-4 hover:underline";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        {whatsNext || naming ? (
          <input value={whatsNext ? "" : sub.title} aria-label="Name the next step" placeholder="What's next? Name the next step"
            onChange={(e) => { setNaming(true); if (!whatsNext || e.target.value.trim()) onRename(e.target.value); }}
            onBlur={() => setNaming(false)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="-mx-1 min-w-0 rounded-[5px] bg-transparent px-1 py-0.5 text-[17px] font-bold outline-none placeholder:font-semibold placeholder:text-muted hover:bg-background focus:bg-background" />
        ) : showName && (
          <div className="text-[17px] font-bold leading-snug [overflow-wrap:anywhere]">
            <span className="mr-1.5 tabular-nums text-muted">{number}.</span>{sub.title}
          </div>
        )}
        {/* Whose move it is, strong red for yours, the step's own colour otherwise. */}
        <div className={`flex flex-wrap items-center gap-x-3 text-[16px] font-semibold leading-snug ${tone.sayTone}`}>
          <span>{tone.say ?? tone.word}</span>
          {sub.cloudSession?.url && <a href={sub.cloudSession.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:opacity-80">Watch Claude work ↗</a>}
        </div>
      </div>
      {setup && addRows && (
        <div className="rounded-[5px] p-3 ring-1 ring-inset ring-border">
          <StepSetup {...setup} meId={meId}
            lead={quick ? [{ key: named[0].kind, label: quick.label, onPick: quick.onPick }] : []}
            rows={addRows.rows.map((r) => ({ label: r.label, items: r.items.map((o) => ({ key: o.key, label: o.label, disabled: o.disabled, title: [o.label !== (ADD_SHORT[o.key] ?? o.label) && o.label, o.note].filter(Boolean).join(", ") || undefined, onPick: o.onPick })) }))}
            more={addRows.rest.map((o) => ({ key: o.key, label: o.label, disabled: o.disabled, onPick: o.onPick }))}
            onDone={(a, run) => setup.onDone(a, run)} />
        </div>
      )}
      {dir.node}
      {followBox}
      {planBits}
      {outFor ?? held}
      {/* A wait on the client gets no to do box until one is added. */}
      {!sub.onClient && (sub.finishWhen !== "reply" || todo.todos.length > 0) && todo.node}
      {/* How it ends: Done, then What's next; a waiting, check in or "what's
          next?" step has its own choices. The only dark button on the page. */}
      {!sub.done && doneActions ? (
        <div className="border-t pt-3">{doneActions}</div>
      ) : !sub.done && !sub.onClient ? (
        <div className="border-t pt-3">
          {sendReady ? (
            <div className="flex flex-col items-start gap-2">
              <button onClick={onSendHeldEmail} className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Send the email to {firstName}</button>
              <button onClick={onMarkDone} className="text-[16px] font-medium text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">Done, without sending</button>
            </div>
          ) : (
            <button onClick={onMarkDone} aria-label="Done with this step, choose what's next" className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Done · what&apos;s next?</button>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px]">
        {quick && <><button onClick={quick.onPick} className={link}>{quick.label}</button><span aria-hidden className="text-muted">·</span></>}
        <button onClick={onOpenStep} title="The step's own page: its history and messages" className={link}>Open the step</button>
      </div>
    </div>
  );
}

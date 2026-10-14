"use client";

// The current step, open on the task page (Derek, 2026-10-14, mockup
// current-step-inline-mockup.html): whose turn it is, its directions, its to
// dos, the work it holds, and how it ends, with no click to get to the work.
// The step's own page (Open the step) still has its history and messages.
// Its directions and to dos are the step page's own (useStepDirections,
// useStepTodos), so they edit and save the same way in both places.
import { useState } from "react";
import { htmlToText, type Message, type StepTodo, type Subtask } from "@/lib/data";
import { dedupeSuggestions, suggestStepActions, type StepSuggestKind } from "@/lib/stepSuggest";
import { useStepDirections, useStepTodos, type StepSetupProps } from "./StepPage";
import { StepSetup, ADD_SHORT, addRowsOf } from "./StepSetup";
import { JoinNowLine } from "./MeetNowSheet";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { I, LinkedText } from "./ui";

type AddOption = { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void };

/** The same name, whatever the case and spacing: a step named as its task
 *  does not say its name again (Derek, 2026-10-14). */
export const sameStepName = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export function CurrentStep({ sub, number, showName, firstName, tone, meId, messages, onPatchSub, onRename, clientItems = [], onToggleClientItem, onTodoDone, onAskTodos,
  addOptions = [], held, outFor, doneActions, setup, followBox, planBits, onMarkDone, onSendHeldEmail, onOpenStep, onGiveClaude, delegate, picked, suggestion, onAcceptSuggestion, onCopyForClaude, files, face, sentence, incoming, waiting = false, waitDates }: {
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
  /** Whose turn, as a face before the words: the person's avatar, Claude's
   *  icon, the client's initials. */
  face?: React.ReactNode;
  /** Its links and files, under what came in. */
  files?: React.ReactNode;
  /** The step page's own sentence ("● Your turn, assigned to Derek, due
   *  today, follow up Oct 15"), its pickers working here too (Derek,
   *  2026-10-14: the two read the same). */
  sentence?: React.ReactNode;
  /** What came in: the client's email, open, or the email a waiting step waits on. */
  incoming?: React.ReactNode;
  /** Waiting on the client: its name says so, no sentence under it. */
  waiting?: boolean;
  /** A waiting step's dates in place of the sentence: "Checking again Oct 16 ▾". */
  waitDates?: React.ReactNode;
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
  /** Hand this step on while working it (Derek, 2026-10-14: "I'm going to be
   *  delegating stuff to Claude a lot, and it's hidden"): Give to Claude as
   *  its own button, everyone else under Delegate. */
  onGiveClaude?: () => void;
  delegate?: ActionMenuItem[];
  /** A What's next answered by a pick: what it became, and Change to ask again. */
  picked?: { says: string; onChange: () => void };
  /** A "what's next?" step's suggested next step, shown in its name box;
   *  Enter takes it. */
  suggestion?: string;
  onAcceptSuggestion?: () => void;
  /** ✳ Copy for Claude: the way to start Claude now when its cloud start is not set up. */
  onCopyForClaude?: () => void;
}) {
  const whatsNext = !sub.done && /: what's next\?$/.test(sub.title);
  const dir = useStepDirections({ sub, onPatchSub, inline: true });
  const todo = useStepTodos({ sub, onPatchSub, messages, first: firstName, clientItems, onToggleClientItem, onTodoDone, onAskTodos, inline: true });
  // Naming a "what's next?" step: the box stays while typing, though the
  // first letter renames it.
  const [naming, setNaming] = useState(false);
  // The suggestion sits in the name box until it is typed over.
  const [typed, setTyped] = useState(false);
  const options: AddOption[] = [
    // Not offered once the step has them (Derek, 2026-10-14).
    ...(dir.open ? [] : [{ key: "directions", label: "Directions", onPick: dir.start }]),
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
  const quick = sub.done || sub.onClient || outFor !== undefined ? null : dedupeSuggestions(named, sub)
    .filter((x) => !holdsKind(x.kind) && optionFor(x.kind) && !optionFor(x.kind)!.disabled)
    .map((x) => ({ label: x.label, onPick: optionFor(x.kind)!.onPick }))[0] ?? null;
  // Its email is written and all it asks for is on it: finishing is sending.
  const sendReady = !!onSendHeldEmail && holdsKind("email")
    && named.every((x) => x.kind === "email" || !optionFor(x.kind) || holdsKind(x.kind));
  const addRows = setup ? addRowsOf(options, firstName, new Set(quick ? named.map((x) => x.kind) : [])) : null;
  const link = "font-semibold text-accent underline-offset-4 hover:underline";
  // The longer reason, when the sentence's first word does not say it all.
  const reason = tone.say && !sub.done && tone.say !== tone.word && !["Your turn", "Claude's turn"].includes(tone.say) ? tone.say : null;
  // A "what's next?" step's context (why it is asking, the original ask): the
  // easiest thing on the card to read, in ink, right under its heading (Derek,
  // 2026-10-14: it was pale grey under a red line).
  const context = whatsNext ? htmlToText(sub.notes ?? "").trim() : "";

  // A click on the card's empty space opens the step's page; what is on it
  // keeps its own click, and selecting text opens nothing (Derek,
  // 2026-10-14). Keyboard users have Open the step.
  const openFromCard = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, textarea, select, label, [role=button], [contenteditable=true], [data-no-open]")) return;
    if ((window.getSelection?.()?.toString() ?? "").trim()) return;
    onOpenStep();
  };
  return (
    <div onClick={openFromCard} className="flex min-w-0 cursor-pointer flex-col gap-3">
      <div className="flex flex-col gap-1">
        {/* The name, then whose turn as a face and the › to its page in the
            top right corner, where the folded rows have them (Derek, 2026-10-14). */}
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
        {whatsNext || naming ? (
          <input value={whatsNext ? (typed ? "" : suggestion ?? "") : sub.title} aria-label="Name the next step" placeholder="What's next? Name the next step"
            onChange={(e) => { setNaming(true); setTyped(true); if (!whatsNext || e.target.value.trim()) onRename(e.target.value); }}
            onBlur={() => setNaming(false)} onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (whatsNext && !typed && suggestion && onAcceptSuggestion) onAcceptSuggestion();
              e.currentTarget.blur();
            }}
            className="-mx-1 min-w-0 rounded-[5px] bg-transparent px-1 py-0.5 text-[17px] font-bold outline-none placeholder:font-semibold placeholder:text-muted hover:bg-background focus:bg-background" />
        ) : showName && (
          <div className="text-[17px] font-bold leading-snug [overflow-wrap:anywhere]">
            <span className="mr-1.5 tabular-nums text-muted">{number}.</span>{sub.title}
          </div>
        )}
            {/* The step page's sentence, its pickers working here; the
                waiting step's name says it all. */}
            {waiting ? waitDates : sentence}
          </div>
          <span className="flex shrink-0 items-center gap-2 pt-0.5">
            {face}
            <button onClick={onOpenStep} title="Open the step" aria-label="Open the step" className="rounded-[5px] p-1 text-muted hover:bg-background hover:text-foreground"><I.chevron className="h-4 w-4 -rotate-180" /></button>
          </span>
        </div>
        {/* Why it is whose move, its own coloured line, as on the step page. */}
        {!waiting && reason && (
          <div className={`flex flex-wrap items-center gap-x-3 text-[16px] font-semibold leading-snug ${tone.sayTone}`}>
            <span>{reason}</span>
            {sub.cloudSession?.url && <a href={sub.cloudSession.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:opacity-80">Watch Claude work ↗</a>}
          </div>
        )}
        {sub.cloudError === "not_set_up" && !sub.done && (
          <p className="text-[16px] text-foreground">
            Claude in the cloud isn&apos;t set up yet, so it starts when someone opens Claude and says: work your ClickUpTasks list.
            {onCopyForClaude && <> Or use <button onClick={onCopyForClaude} className="font-semibold text-accent underline-offset-4 hover:underline">✳ Copy for Claude</button>.</>}
          </p>
        )}
        {picked && (
          <p className="text-[16px] text-foreground">{picked.says}{" · "}
            <button onClick={picked.onChange} title="Put the question back and pick again" className="font-semibold text-accent underline-offset-4 hover:underline">Change</button>
          </p>
        )}
        {context && <p className="whitespace-pre-line text-[16px] leading-relaxed text-foreground [overflow-wrap:anywhere]"><LinkedText text={context} /></p>}
      </div>
      {/* A meeting started now: its link, one tap away (Derek, 2026-10-14). */}
      {sub.meeting && !sub.done && <JoinNowLine meeting={sub.meeting} />}
      {setup && addRows && (
        <div className="rounded-[5px] p-3 ring-1 ring-inset ring-border">
          <StepSetup {...setup} meId={meId}
            lead={quick ? [{ key: named[0].kind, label: quick.label, onPick: quick.onPick }] : []}
            rows={addRows.rows.map((r) => ({ label: r.label, items: r.items.map((o) => ({ key: o.key, label: o.label, disabled: o.disabled, title: [o.label !== (ADD_SHORT[o.key] ?? o.label) && o.label, o.note].filter(Boolean).join(", ") || undefined, onPick: o.onPick })) }))}
            more={addRows.rest.map((o) => ({ key: o.key, label: o.label, disabled: o.disabled, onPick: o.onPick }))}
            onDone={(a, run) => setup.onDone(a, run)} />
        </div>
      )}
      {/* What came in (Derek, 2026-10-14): directions, the client's email
          open with its files (or the review out with them and the email that
          took it), then the links and files on the step. */}
      {!context && dir.node}
      {outFor ?? incoming}
      {!outFor && files && (
        <section aria-label="Links and files" className="flex flex-col gap-1.5">
          <h4 className="text-[16px] font-semibold text-muted">Links and files</h4>
          {files}
        </section>
      )}
      {/* What I'm going to do: the work, the + to add one, the to dos. A wait
          on the client gets no to do box until one is added; nor a step with
          no name yet, or still asking what's next (Derek, 2026-10-14). */}
      {!outFor && !whatsNext && !setup && (() => {
        const todos = !sub.onClient && !!sub.title.trim() && (sub.finishWhen !== "reply" || todo.todos.length > 0);
        const addable = !sub.done && !sub.onClient && sub.finishWhen !== "reply";
        if (!held && !planBits && !followBox && !todos && !addable) return null;
        return (
          <section aria-label="Actions" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h4 className="text-[16px] font-semibold text-muted">Actions</h4>
              {addable && <ActionMenu label={<span className="inline-flex items-center gap-1"><I.plus /> Add</span>} title="Add to this step"
                triggerClassName="inline-flex items-center text-[16px] font-medium text-accent hover:underline"
                items={options.map((o) => !o.disabled && { label: o.note ? `${o.label} (${o.note})` : o.label, onClick: o.onPick })} />}
            </div>
            {followBox}
            {planBits}
            {held}
            {todos && todo.node}
          </section>
        );
      })()}
      {/* How it ends: Done, then What's next; a waiting, check in or "what's
          next?" step has its own choices. The only dark button on the page. */}
      {!sub.done && doneActions && <div className="border-t pt-3">{doneActions}</div>}
      {/* One line: Done (the page's one dark button), then Open the step
          beside it, wrapping under only when the width forces it. No quick
          action link here (Derek, 2026-10-14). */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-[16px] ${!sub.done && !doneActions && !sub.onClient ? "border-t pt-3" : ""}`}>
        {!sub.done && !doneActions && !sub.onClient && (sendReady ? (<>
          <button onClick={onSendHeldEmail} className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Send the email to {firstName}</button>
          <button onClick={onMarkDone} className="font-medium text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">Done, without sending</button>
        </>) : (
          <button onClick={onMarkDone} aria-label="Done with this step, choose what's next" className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Done · what&apos;s next?</button>
        ))}
        {!sub.done && !sub.onClient && onGiveClaude && <button onClick={onGiveClaude} title="Claude's turn, due today" className="inline-flex h-10 items-center gap-1.5 rounded-[5px] px-3 text-[16px] font-semibold ring-1 ring-inset ring-border hover:bg-background"><I.bolt className="h-4 w-4" /> Give to Claude</button>}
        {!sub.done && !sub.onClient && !!delegate?.length && <ActionMenu sheet label="Delegate ▾" title="Give this step to someone else" items={delegate} triggerClassName={link} />}
        <button onClick={onOpenStep} title="The step's own page: its history and messages" className={link}>Open the step</button>
      </div>
    </div>
  );
}

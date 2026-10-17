"use client";

// The current step, open on the task page (Derek, 2026-10-17, mockup
// step-done-then-next-mockup.html): about the step alone. Top to bottom its
// name (a click opens its page), whose turn and when, its Description, its
// Checklist, what it uses, + Add, and one Done. Nothing about what comes
// after it: What's next is asked once it is done, and ticking the last to do
// is Done. Handing it on is the turn word. Its description and to dos are
// the step page's own (useStepDirections, useStepTodos), so they edit and
// save the same way in both places.
import { useState } from "react";
import { htmlToText, type Message, type StepTodo, type Subtask } from "@/lib/data";
import { dedupeSuggestions, suggestStepActions, STEP_SUGGESTIONS_ON, type StepSuggestKind } from "@/lib/stepSuggest";
import { StepFinish, useStepDirections, useStepTodos, type StepSetupProps } from "./StepPage";
import { addLeadItems, workingSections } from "@/lib/stepThenNext";
import { StepSetup, ADD_SHORT, addRowsOf } from "./StepSetup";
import { JoinNowLine } from "./MeetNowSheet";
import { OnThisStep } from "./OnThisStep";
import { LinkedText } from "./ui";

type AddOption = { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void };

/** The same name, whatever the case and spacing: a step named as its task
 *  does not say its name again (Derek, 2026-10-14). */
export const sameStepName = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export function CurrentStep({ sub, number, showName, firstName, tone, meId, messages, onPatchSub, onRename, clientItems = [], onToggleClientItem, onTodoDone, onAskTodos,
  addOptions = [], held, outFor, doneActions, finish, message, banner, setup, followBox, planBits, onMarkDone, onLastTick, onSendHeldEmail, onOpenStep, picked, suggestion, onAcceptSuggestion, files, face, sentence, incoming, waiting = false, waitDates, describe, replyPending = false, replyOpen = false, onAddLink, onAttachFiles, transcript }: {
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
  /** Whose turn, as a face beside the name: the person's avatar, Claude's
   *  icon, the client's initials. */
  face?: React.ReactNode;
  /** Its links and files. */
  files?: React.ReactNode;
  /** The turn line: "● Michaella's turn, due Oct 15, 2d late …". */
  sentence?: React.ReactNode;
  /** What came in: the client's email, open, or the email a waiting step waits on. */
  incoming?: React.ReactNode;
  /** Waiting on the client: its name says so, its own line under it. */
  waiting?: boolean;
  /** A waiting step's line in place of the sentence. */
  waitDates?: React.ReactNode;
  /** The client's waiting step: the review out with them, in place of held. */
  outFor?: React.ReactNode;
  /** How a waiting, check in or "what's next?" step ends, in place of Done. */
  doneActions?: React.ReactNode;
  /** The one button, when it is not Done (stepThenNext finishButton): Give
   *  to Michaella on a draft, or "none" on someone else's live step. */
  finish?: { label: string; onClick: () => void } | "none";
  /** Message Derek / Message Michaella (StepMessage), beside the button. */
  message?: React.ReactNode;
  /** Draft · not given to Michaella yet, or Question from Michaella, above the name. */
  banner?: React.ReactNode;
  /** Not set up yet (Start it, without answering): asked here. */
  setup?: StepSetupProps | null;
  followBox?: React.ReactNode;
  planBits?: React.ReactNode;
  onMarkDone: () => void;
  /** The last to do ticked: the same as Done. */
  onLastTick?: () => void;
  onSendHeldEmail?: () => void;
  onOpenStep: () => void;
  /** A What's next answered by a pick: what it became, and Change to ask again. */
  picked?: { says: string; onChange: () => void };
  /** A "what's next?" step's suggested next step, shown in its name box;
   *  Enter takes it. */
  suggestion?: string;
  onAcceptSuggestion?: () => void;
  /** ✳ Copy for Claude: the way to start Claude now when its cloud start is not set up. */
  onCopyForClaude?: () => void;
  /** The description's heading and tint by whose turn (lib/stepThenNext descriptionLabel). */
  describe?: { label: string; tone: "client" | "claude" | null };
  replyPending?: boolean;
  /** Add the transcript (TranscriptBox), or the line offering it; open, its
   *  Save is the dark button and Done goes light. */
  transcript?: { node: React.ReactNode; open: boolean };
  replyOpen?: boolean;
  /** Link and Attach in + Add: onto this step. */
  onAddLink?: (url: string) => void;
  onAttachFiles?: () => void;
}) {
  const whatsNext = !sub.done && /: what's next\?$/.test(sub.title);
  const dir = useStepDirections({ sub, onPatchSub, inline: true, label: describe?.label, tone: describe?.tone ?? null });
  const todo = useStepTodos({ sub, onPatchSub, messages, first: firstName, clientItems, onToggleClientItem, onTodoDone, onAskTodos, onLastTick, inline: true });
  // Naming a "what's next?" step: the box stays while typing, though the
  // first letter renames it.
  const [naming, setNaming] = useState(false);
  // The suggestion sits in the name box until it is typed over.
  const [typed, setTyped] = useState(false);
  // A link being typed onto the step, or null when closed.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const saveLink = () => { const u = (linkDraft ?? "").trim(); if (u && onAddLink) { onAddLink(u); setLinkDraft(null); } };
  const options: AddOption[] = [
    // Not offered once the step has them (Derek, 2026-10-14).
    ...(dir.open ? [] : [{ key: "directions", label: "Description", onPick: dir.start }]),
    { key: "checklist", label: "Checklist", onPick: todo.start },
    ...addOptions,
  ];
  const lead = addLeadItems({ description: dir.open, checklist: todo.show });
  // The quiet words beside + Add: the kinds of work it can make or send.
  const kinds = [...new Set(addOptions.flatMap((o) => { const k = o.key.split(":")[0]; return ["email", "doc", "image", "page", "video"].includes(k) ? [k] : []; }))];
  const hint = kinds.length ? kinds.join(", ") : undefined;
  // The step's main quick action: what its name suggests, as on its page,
  // gone once the step holds that kind of work. Off for now (STEP_SUGGESTIONS_ON).
  const holdsKind = (k: StepSuggestKind) =>
    k === "checklist" ? todo.todos.length > 0 || clientItems.length > 0
    : k === "text" ? sub.draftMessage?.channel === "sms"
    : (sub.holds ?? []).includes(k);
  const optionFor = (k: StepSuggestKind) => options.find((o) => o.key === k);
  const named = whatsNext ? [] : suggestStepActions(sub.title, firstName);
  const quick = !STEP_SUGGESTIONS_ON || sub.done || sub.onClient || outFor !== undefined ? null : dedupeSuggestions(named, sub)
    .filter((x) => !holdsKind(x.kind) && optionFor(x.kind) && !optionFor(x.kind)!.disabled)
    .map((x) => ({ label: x.label, onPick: optionFor(x.kind)!.onPick }))[0] ?? null;
  // Its email is written and all it asks for is on it: finishing is sending.
  const sendReady = !!onSendHeldEmail && holdsKind("email")
    && named.every((x) => x.kind === "email" || !optionFor(x.kind) || holdsKind(x.kind));
  const addRows = setup ? addRowsOf(options, firstName, new Set(quick ? named.map((x) => x.kind) : [])) : null;
  // The longer reason, when the sentence's first word does not say it all.
  // Not said over the client's email card, which says it already (Derek, 2026-10-15).
  const emailShown = !sub.done && !!sub.fromEmails?.length && !!incoming;
  const reason = tone.say && !sub.done && !emailShown && tone.say !== tone.word && !["Your turn", "Claude's turn"].includes(tone.say) ? tone.say : null;
  // A "what's next?" step's context (why it is asking, the original ask): the
  // easiest thing on the card to read, in ink, right under its heading (Derek,
  // 2026-10-14: it was pale grey under a red line).
  const context = whatsNext ? htmlToText(sub.notes ?? "").trim() : "";

  // A click on the card's empty space opens the step's page; what is on it
  // keeps its own click, and selecting text opens nothing (Derek,
  // 2026-10-14). The name is the button to its page.
  const openFromCard = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, textarea, select, label, [role=button], [role=menu], [contenteditable=true], [data-no-open]")) return;
    if ((window.getSelection?.()?.toString() ?? "").trim()) return;
    onOpenStep();
  };
  const usesWork = !!(held || files || planBits || followBox || transcript?.node || linkDraft !== null);
  const todos = !outFor && !whatsNext && !setup && !sub.onClient && !!sub.title.trim() && (sub.finishWhen !== "reply" || todo.todos.length > 0);
  const addable = !outFor && !whatsNext && !setup && !sub.done && !sub.onClient && sub.finishWhen !== "reply";
  const came = outFor ?? incoming;
  // What shows, in order (lib/stepThenNext workingSections): nothing empty.
  const has = new Set(workingSections({
    done: sub.done, description: !context && dir.open, checklist: todos && !!todo.node,
    using: usesWork || !!came, canAdd: addable, canFinish: !!doneActions || !sub.onClient,
  }));
  return (
    <div onClick={openFromCard} className="flex min-w-0 cursor-pointer flex-col gap-3">
      {banner}
      <div className="flex flex-col gap-1">
        {/* The name, whose turn as a face in the top right corner. */}
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
            className="-mx-1 min-w-0 rounded-[5px] bg-transparent px-1 py-0.5 text-[20px] font-bold leading-snug outline-none placeholder:font-semibold placeholder:text-muted hover:bg-background focus:bg-background" />
        ) : showName && (
          // Bigger than the lines under it, so the step reads first; a click
          // opens its page (Derek, 2026-10-17).
          <button type="button" onClick={onOpenStep} title="Open the step: its history and messages"
            className="-mx-1 self-start rounded-[5px] px-1 text-left text-[20px] font-bold leading-snug [overflow-wrap:anywhere] hover:bg-background">
            <span className="mr-1.5 tabular-nums text-muted">{number}.</span>{sub.title}
          </button>
        )}
            {/* Whose turn and when; the waiting step's own line. */}
            {waiting ? waitDates : sentence}
          </div>
          {face && <span className="flex shrink-0 items-center gap-2 pt-0.5">{face}</span>}
        </div>
        {/* Why it is whose move, its own coloured line, as on the step page. */}
        {!waiting && reason && (
          <div className={`flex flex-wrap items-center gap-x-3 text-[16px] font-semibold leading-snug ${tone.sayTone}`}>
            <span>{reason}</span>
            {sub.cloudSession?.url && <a href={sub.cloudSession.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:opacity-80">Watch Claude work ↗</a>}
          </div>
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
      {/* Top to bottom (Derek, 2026-10-17): Description, Checklist, then
          what the step uses, + Add with it, and Done. */}
      {/* The Undo line after a delete shows though the description is gone. */}
      {!context && (has.has("description") || !dir.open) && dir.node}
      {has.has("checklist") && todo.node}
      {has.has("using") && came}
      {has.has("using") && usesWork && (
        <section aria-label="Using" className="flex flex-col gap-2">
          {(held || files) && <h3 className="text-[16px] font-semibold">Using</h3>}
          {transcript?.node}
          {linkDraft !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <input autoFocus value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} aria-label="Link to add to this step"
                onKeyDown={(e) => { if (e.key === "Enter") saveLink(); if (e.key === "Escape") { e.stopPropagation(); setLinkDraft(null); } }}
                placeholder="Paste a link (Drive, website, doc…)" className="min-w-0 flex-1 rounded-[5px] border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
              <button onClick={saveLink} disabled={!linkDraft.trim()} className="h-9 rounded-[5px] border bg-surface px-3 text-[16px] font-semibold text-accent hover:bg-background disabled:opacity-40">Add</button>
              <button onClick={() => setLinkDraft(null)} className="h-9 rounded-[5px] px-2 text-[16px] text-muted hover:text-foreground">Cancel</button>
            </div>
          )}
          {files}
          {followBox}
          {planBits}
          {held}
        </section>
      )}
      {has.has("add") && (
        <OnThisStep first={firstName} options={options} hint={hint}
          lead={quick ? [{ key: "quick", label: quick.label, onPick: quick.onPick }] : []}
          onDescription={lead.includes("description") ? dir.start : undefined}
          onChecklist={lead.includes("checklist") ? todo.start : undefined}
          onLink={onAddLink ? () => setLinkDraft((d) => (d === null ? "" : null)) : undefined}
          onAttach={onAttachFiles} />
      )}
      {/* How it ends: one Done; a waiting, check in or "what's next?" step
          has its own choices. The only dark button on the card. */}
      {finish === "none" ? (message && !sub.done ? <div className="flex flex-col border-t pt-3 sm:flex-row sm:justify-end">{message}</div> : null)
        : finish && !sub.done ? (
        <div className="border-t pt-3">
          <StepFinish onMarkDone={finish.onClick} label={finish.label}>
            <span className="self-center text-[16px] text-muted sm:self-auto">Saved as you type</span>
          </StepFinish>
        </div>
      ) : has.has("done") && doneActions ? <div className="border-t pt-3">{doneActions}</div>
        : has.has("done") ? (
        <div className="border-t pt-3">
          {sendReady && !replyOpen ? (
            <StepFinish onMarkDone={onSendHeldEmail} label={`Send the email to ${firstName}`}>
              {message}
              <button onClick={onMarkDone} className="self-center text-[16px] font-medium text-muted underline decoration-dotted underline-offset-4 hover:text-foreground sm:self-auto">Done, without sending</button>
            </StepFinish>
          ) : (
            <StepFinish onMarkDone={onMarkDone} label={replyOpen ? "Done, without sending" : "Done"} light={replyPending || replyOpen || !!transcript?.open}>{message}</StepFinish>
          )}
        </div>
      ) : null}
    </div>
  );
}

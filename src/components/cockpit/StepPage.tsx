"use client";

// One step's own page (Derek, 2026-10-11, mockup
// https://claude.ai/artifact/HKJa1eM5eJZ2U3JVB78AaC): what the step works on,
// its to-do list, and what was said while it ran, with the client and with
// the team. It slides out over the task to look at something quickly and
// opens full page to work in, like a handoff. Messages to the client are
// ordinary messages; they show here because they were sent while the step
// ran (stepWindow), nothing is filed apart for the client.
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  htmlToText, timeAgo, userById, initialsOf, inWindow, stepWindow, todoProgress, todoWaiting, PERSONAL_CLIENT_ID,
  type Message, type StepTodo, type Subtask, type Task, type TaskAction, type TaskStatus,
} from "@/lib/data";
import { I, Avatar, CollapsibleText, newId } from "./ui";
import { ActionMenu, MenuSheet } from "./ActionMenu";
import { CHANNEL_TONE } from "./channelTone";
import { useEscapeToClose } from "./useEscapeToClose";
import { RichTextEditor } from "./RichTextEditor";
import { suggestStepActions, type StepSuggestKind } from "@/lib/stepSuggest";
import { ADD_ICON, ADD_SHORT, StepSetup, addRowsOf, type SetupAnswer, type SetupWho } from "./StepSetup";
import { JoinNowLine } from "./MeetNowSheet";

/** The set up a step shows before anything else (StepSetup): its answers
 *  picked already, and what to do with them. The action row is the page's own
 *  Add items. */
export type StepSetupProps = {
  who: SetupWho[];
  whoInitial: string | null;
  nameOf?: (id: string) => string;
  someoneElse?: (label: React.ReactNode, pick: (id: string) => void) => React.ReactNode;
  whenInitial: string;
  today: string;
  /** The action already chosen (Quick step): shown picked. */
  preset?: string | null;
  onDone: (answer: SetupAnswer, run?: () => void) => void;
};

/** The end of every step (Derek, 2026-10-13: "more guidance at the end of
 *  the step for next steps", asked several times): "What's next?", a line on
 *  where things stand, then each choice with what it does. Sits above the
 *  step's messages. */
export type NextChoice = {
  label: string; says: string; primary?: boolean;
  onClick: () => void;
};
export function NextChoices({ intro, choices, row, link, heading = true }: {
  intro?: React.ReactNode; choices: NextChoice[];
  /** False where the card already asks "What's next?" (a what's next step's
   *  name box): said once (Derek, 2026-10-14). */
  heading?: boolean;
  /** The buttons side by side, light, without what each does beside it (that
   *  stays as its title), the same on a phone and a desktop: a check in
   *  (Derek, 2026-10-14). */
  row?: boolean;
  /** A small text link under the buttons. */
  link?: NextChoice;
}) {
  const id = useId();
  const look = (c: NextChoice) => (c.primary ? "bg-accent text-white hover:opacity-90" : "border bg-surface hover:bg-background");
  // On a phone each choice is its button alone (Derek, 2026-10-13: simpler);
  // what it does stays on it as its title and, for a screen reader, its
  // description.
  const phoneButton = (c: NextChoice, n: string) => (
    <Fragment key={c.label}>
      <button onClick={c.onClick} title={c.says} aria-describedby={`${id}-${n}`}
        className={`h-10 w-full rounded-[5px] px-4 text-left text-[16px] font-semibold ${look(c)}`}>{c.label}</button>
      <span id={`${id}-${n}`} className="sr-only">{c.says}</span>
    </Fragment>
  );
  return (
    <section aria-label="What's next" className="flex flex-col gap-2">
      {heading && <h3 className="text-[18px] font-bold">What&apos;s next?</h3>}
      {intro && <p className="text-[16px] text-muted">{intro}</p>}
      {row ? (
        // One row, every button light; on a narrow phone a long name wraps
        // inside its button rather than pushing one onto a second row.
        <div className="flex gap-2">
          {choices.map((c, i) => (
            <Fragment key={c.label}>
              <button onClick={c.onClick} title={c.says} aria-describedby={`${id}-r${i}`}
                className="min-h-10 min-w-0 flex-1 rounded-[5px] border bg-surface px-3 py-1.5 text-center text-[16px] font-semibold leading-snug text-balance hover:bg-background sm:flex-none sm:px-4">{c.label}</button>
              <span id={`${id}-r${i}`} className="sr-only">{c.says}</span>
            </Fragment>
          ))}
        </div>
      ) : (
        <>
          {/* From sm up: each choice with what it does beside it. */}
          <div className="hidden flex-col divide-y rounded-[5px] border bg-surface sm:flex">
            {choices.map((c, i) => (
              <div key={c.label} className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <button onClick={c.onClick} aria-describedby={`${id}-d${i}`} className={`h-10 min-w-[12rem] rounded-[5px] px-4 text-left text-[16px] font-semibold ${look(c)}`}>{c.label}</button>
                <span id={`${id}-d${i}`} className="min-w-0 flex-1 text-[16px] text-muted">{c.says}</span>
              </div>
            ))}
          </div>
          {/* On a phone: buttons only, full width. */}
          <div className="flex flex-col gap-1.5 sm:hidden">
            {choices.map((c, i) => phoneButton(c, `p${i}`))}
          </div>
        </>
      )}
      {link && (
        <p className="text-[16px]">
          <button onClick={link.onClick} title={link.says} aria-describedby={`${id}-link`}
            className="font-semibold text-accent underline underline-offset-4 hover:opacity-80">{link.label}</button>
          <span id={`${id}-link`} className="sr-only">{link.says}</span>
        </p>
      )}
    </section>
  );
}

/** The step's directions read as the task's description does: muted, four
 *  lines, then Read more, which opens the rest in place. A click on the text
 *  edits it. On the task page (six) they keep their lines and show six. */
function ClampedDirections({ text, onEdit, six = false }: { text: string; onEdit: () => void; six?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || more) return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, more]);
  return (
    <div className="flex flex-col items-start">
      {/* A div, not a button: a button won't clamp to four lines. */}
      <div ref={ref} role="button" tabIndex={0} onClick={onEdit} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(); } }} title="Click to edit"
        className={`-mx-1 w-full cursor-text rounded-[5px] px-1 text-left text-[16px] leading-relaxed text-muted [overflow-wrap:anywhere] hover:bg-background hover:text-foreground ${six ? "whitespace-pre-line" : ""} ${more ? "" : six ? "line-clamp-6" : "line-clamp-4"}`}>{text}</div>
      {(cut || more) && (
        <button onClick={() => setMore(!more)} aria-expanded={more} className="text-[16px] font-semibold text-accent hover:underline">{more ? "Show less" : "Read more"}</button>
      )}
    </div>
  );
}

/** A step's directions, the same on its page and on the task page (Derek,
 *  2026-10-14: the current step opens on the task): read as muted text, a
 *  click edits them in the rich editor, they save as you type, Done closes,
 *  the bin deletes them with an Undo. `inline` (the task page): shown only
 *  once written or asked for, six lines, their lines kept. */
export function useStepDirections({ sub, onPatchSub, startEditing = false, inline = false }: {
  sub: Subtask;
  onPatchSub: (patch: Partial<Subtask>) => void;
  startEditing?: boolean;
  inline?: boolean;
}) {
  const hasText = !!sub.notes && htmlToText(sub.notes).trim() !== "";
  const [dirOpen, setDirOpen] = useState(startEditing || hasText);
  // Directions read as text once written; new ones open ready to type (on
  // the step's page; on the task page only when asked for).
  const [dirEditing, setDirEditing] = useState(startEditing || (!inline && !hasText));
  const dirTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirSave = useRef<(() => void) | null>(null);
  // Deleted directions can come back until the page closes.
  const [dirRemoved, setDirRemoved] = useState<string | null>(null);
  const removeDirections = () => {
    if (dirTimer.current) { clearTimeout(dirTimer.current); dirTimer.current = null; }
    dirSave.current = null;
    setDirRemoved(sub.notes ?? "");
    onPatchSub({ notes: undefined });
    setDirOpen(false);
  };
  // Closing the page right after typing still saves what was typed.
  useEffect(() => () => { if (dirTimer.current) { clearTimeout(dirTimer.current); dirSave.current?.(); } }, []);
  const start = () => { setDirRemoved(null); setDirOpen(true); setDirEditing(true); };
  // On the task page, directions written elsewhere (Claude, the step's page)
  // show as soon as they arrive.
  const open = dirOpen || (inline && hasText && dirRemoved === null);
  const raw = htmlToText(sub.notes ?? "");
  const dirText = (inline ? raw : raw.replace(/\s*\n\s*/g, " ")).trim();
  const node = (
    <>
      {!open && dirRemoved !== null && (
        <p className="text-[16px] text-muted">Directions deleted. <button onClick={() => { if (dirRemoved) onPatchSub({ notes: dirRemoved }); setDirRemoved(null); setDirOpen(true); setDirEditing(true); }} className="font-semibold text-accent underline underline-offset-4">Undo</button></p>
      )}
      {open && (
        <section aria-label="Directions" className={`${inline ? "" : "mt-1 "}flex flex-col gap-2`}>
          {dirEditing ? (<>
            <RichTextEditor key={`step-dir-${sub.id}`} value={sub.notes ?? ""} autoFocus
              onChange={(html) => {
                if (dirTimer.current) clearTimeout(dirTimer.current);
                dirSave.current = () => onPatchSub({ notes: htmlToText(html).trim() ? html : undefined });
                dirTimer.current = setTimeout(() => { dirTimer.current = null; dirSave.current?.(); }, 600);
              }}
              placeholder="What we want on this step: what to make, what to change, where things are…" />
            {/* They save as you type; Done closes (Derek, 2026-10-12: "no way
                to save or close the directions"). */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button onClick={() => { if (dirTimer.current) { clearTimeout(dirTimer.current); dirTimer.current = null; dirSave.current?.(); } setDirEditing(false); }}
                className={inline ? "h-9 rounded-[5px] border bg-surface px-3 text-[16px] font-semibold text-accent hover:bg-background" : "h-9 rounded-[5px] bg-accent px-3 text-[16px] font-semibold text-white hover:opacity-90"}>Done</button>
              <span className="text-[16px] text-muted">Saves as you type.</span>
              <button onClick={removeDirections} title="Delete the directions" aria-label="Delete the directions" className="ml-auto rounded-lg p-2 text-muted hover:bg-background hover:text-danger"><I.trash className="h-4 w-4" /></button>
            </div>
          </>) : dirText ? (
            <ClampedDirections text={dirText} six={inline} onEdit={() => setDirEditing(true)} />
          ) : (
            <button onClick={() => setDirEditing(true)} className="-mx-1 self-start rounded-[5px] px-1 text-left text-[16px] text-accent underline decoration-dotted underline-offset-4 hover:bg-background">Add directions</button>
          )}
        </section>
      )}
    </>
  );
  return { open, start, node };
}

/** A step's to dos, the same on its page and on the task page: tick, add,
 *  delete, ask the client about some in one email; what the client sent from
 *  their portal ticks off the same way. `inline` (the task page): no heading,
 *  and "+ Add a to do" is always there. */
export function useStepTodos({ sub, onPatchSub, messages, first, clientItems = [], onToggleClientItem, onTodoDone, onAskTodos, startOpen = false, inline = false }: {
  sub: Subtask;
  onPatchSub: (patch: Partial<Subtask>) => void;
  messages: Message[];
  first: string;
  clientItems?: Subtask[];
  onToggleClientItem?: (id: string) => void;
  onTodoDone?: (todo: StepTodo) => void;
  onAskTodos?: (todoIds: string[]) => void;
  startOpen?: boolean;
  inline?: boolean;
}) {
  const headId = useId();
  const todos = sub.todos ?? [];
  const own = todoProgress(todos);
  const progress = { done: own.done + clientItems.filter((c) => c.done).length, total: own.total + clientItems.length };
  const [todoDraft, setTodoDraft] = useState("");
  const [showTodos, setShowTodos] = useState(startOpen);
  const ref = useRef<HTMLInputElement>(null);
  const setTodos = (next: StepTodo[]) => onPatchSub({ todos: next.length ? next : undefined });
  // To-dos picked to ask the client about, in one email.
  const [asking, setAsking] = useState<string[]>([]);
  const toggleAsk = (id: string) => setAsking((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const waitingOn = todos.filter((t) => todoWaiting(t, messages) === "waiting").length;
  const addTodo = () => {
    const title = todoDraft.trim();
    if (!title) return;
    setTodos([...todos, { id: newId("td_"), title, done: false }]);
    setTodoDraft("");
  };
  const toggleTodo = (t: StepTodo) => {
    setTodos(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    if (!t.done && t.commentId) onTodoDone?.(t);
  };
  const show = inline || todos.length > 0 || clientItems.length > 0 || showTodos;
  const node = !show ? null : (
    <section aria-labelledby={inline ? undefined : headId} aria-label={inline ? "To do" : undefined} className={`flex flex-col ${inline ? "gap-1" : "gap-2"}`}>
      {!inline && <h3 id={headId} className="text-[17px] font-bold">To do{progress.total > 0 && <span className="font-normal text-muted"> · {progress.done} of {progress.total}</span>}{waitingOn > 0 && <span className="font-semibold text-sky-700 dark:text-sky-300"> · {waitingOn} waiting on {first}</span>}</h3>}
      {/* The questions picked so far, asked in one email. */}
      {asking.length > 0 && onAskTodos && (
        <div className="flex flex-wrap items-center gap-2 rounded-[5px] bg-sky-50 px-3 py-2 text-[16px] dark:bg-sky-500/10">
          <span className="min-w-0 flex-1 font-semibold">Ask {first} about {asking.length === 1 ? "this one" : `these ${asking.length}`}</span>
          <button onClick={() => { onAskTodos(asking); setAsking([]); }} className={inline ? "h-9 rounded-[5px] border bg-surface px-3 font-semibold text-accent hover:bg-background" : "h-9 rounded-[5px] bg-accent px-3 font-semibold text-white hover:opacity-90"}>Write the email</button>
          <button onClick={() => setAsking([])} className="h-9 rounded-[5px] px-2 text-muted hover:text-foreground">Cancel</button>
        </div>
      )}
      {clientItems.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {clientItems.map((c) => (
            <li key={c.id} className="flex items-start gap-2.5">
              <button onClick={() => onToggleClientItem?.(c.id)} aria-pressed={c.done} aria-label={c.done ? `Reopen ${c.title}` : `Mark ${c.title} done`}
                className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-2 ${c.done ? "border-accent bg-accent text-white" : "border-border hover:border-accent"}`}>{c.done && <I.check className="h-3.5 w-3.5" />}</button>
              <span className={`min-w-0 flex-1 text-[16px] [overflow-wrap:anywhere] ${c.done ? "text-muted line-through" : ""}`}>
                {c.title}<span className="ml-2 font-semibold text-sky-700 no-underline dark:text-sky-300">from {first}&apos;s portal</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {todos.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {todos.map((t) => (
            <li key={t.id} className={`group/todo flex items-start gap-2.5 rounded-[5px] ${asking.includes(t.id) ? "bg-sky-50 ring-1 ring-sky-300 dark:bg-sky-500/10" : ""}`}>
              <button onClick={() => toggleTodo(t)} aria-pressed={t.done} aria-label={t.done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-2 ${t.done ? "border-accent bg-accent text-white" : "border-border hover:border-accent"}`}>{t.done && <I.check className="h-3.5 w-3.5" />}</button>
              <span className={`min-w-0 flex-1 text-[16px] [overflow-wrap:anywhere] ${t.done ? "text-muted line-through" : ""}`}>
                {t.title}{t.fromClient && <span className="ml-2 font-semibold text-sky-700 no-underline dark:text-sky-300">from {first}</span>}
                {(() => {
                  const w8 = todoWaiting(t, messages);
                  return w8 === "waiting" ? <span className="ml-2 font-semibold text-sky-700 no-underline dark:text-sky-300">? Asked {first} {timeAgo(t.askedAt!)}</span>
                    : w8 === "answered" ? <span className="ml-2 font-semibold text-success no-underline">{first} answered</span> : null;
                })()}
              </span>
              {/* Ask the client about just this one (or several, picked together). */}
              {!t.done && onAskTodos && (
                <button onClick={() => toggleAsk(t.id)} aria-pressed={asking.includes(t.id)} title={`Ask ${first} about this`}
                  className={`shrink-0 rounded-[5px] px-1.5 text-[16px] font-semibold text-accent hover:bg-background ${asking.includes(t.id) ? "" : "opacity-0 focus:opacity-100 group-hover/todo:opacity-100"}`}>{asking.includes(t.id) ? "✓ Ask" : `Ask ${first}`}</button>
              )}
              <button onClick={() => setTodos(todos.filter((x) => x.id !== t.id))} title="Delete" aria-label={`Delete ${t.title}`}
                className="shrink-0 text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover/todo:opacity-100"><I.trash className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {/* Text typed here and not added yet reads as a box with Add beside
          it, never as a second copy of a to do (Derek, 2026-10-14: "Schedule
          email to bulk customers: unopened" sat under the real to do). */}
      <div className="flex items-center gap-2">
        <input ref={ref} value={todoDraft} onChange={(e) => setTodoDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTodo(); if (e.key === "Escape" && todoDraft) { e.stopPropagation(); setTodoDraft(""); } }}
          placeholder="+ Add a to do" aria-label="Add a to do" autoComplete="off"
          // On the task page no box until it is in use: the app colours every
          // border, a transparent one included.
          className={`min-w-0 flex-1 rounded-md py-1.5 text-[16px] outline-none placeholder:text-accent hover:bg-background focus:bg-background focus:placeholder:text-muted ${todoDraft ? "bg-background ring-1 ring-inset ring-accent" : ""} ${inline ? "-mx-2 px-2 focus:ring-1 focus:ring-inset focus:ring-accent" : "border border-transparent px-2 focus:border-accent"}`} />
        {todoDraft.trim() && <>
          <button onClick={addTodo} className="h-9 shrink-0 rounded-[5px] border bg-surface px-3 text-[16px] font-semibold text-accent hover:bg-background">Add</button>
          <button onClick={() => setTodoDraft("")} title="Clear" aria-label="Clear the to do being typed" className="h-9 shrink-0 rounded-[5px] px-2 text-muted hover:text-foreground">×</button>
        </>}
      </div>
    </section>
  );
  return { todos, show, showTodos, setShowTodos, ref, node };
}

export function StepPage({ task, sub, client, firstName, full, onToggleFull, onClose, onRename, onPatchSub, onMarkDone, onReopen, onDelete, onToTask,
  controls, setup, stepNo, onPrev, onNext, onCopyForClaude, meId, round, startWithChecklist = false, startWithDirections = false, startTalk, tone, nextPanel, outFor, doneActions, onSendHeldEmail, addOptions = [], onSendText, onSendEmail, onFullEmail, followBox, planBits, held, onCopyLink, onCopyPortalLink, onAskTodos, savedLinks = [], onAttachLinks, messages, actions, onSendChat, onAddNote, onTodoDone, clientItems = [], onToggleClientItem, files }: {
  task: Task;
  sub: Subtask;
  client: { name: string; color: string };
  /** What to call the client (clientFirstName): a person's first name, or a
   *  business's whole name. */
  firstName?: string;
  stage?: TaskStatus;
  isCurrent: boolean;
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
  onPatchSub: (patch: Partial<Subtask>) => void;
  onMarkDone: () => void;
  onReopen: () => void;
  /** Deletes the step; at the very bottom of its page (Derek, 2026-10-11). */
  onDelete?: () => void;
  /** Make this step its own task (Derek, 2026-10-13). */
  onToTask?: () => void;
  /** The step's sentence under its name, like the task's: its state, who has
   *  it, its due date and follow up, each a word to change. */
  controls?: React.ReactNode;
  /** A new step asks whose turn, by when and what first (StepSetup), in place
   *  of its sentence and its Add rows, until answered or skipped. */
  setup?: StepSetupProps | null;
  /** Opened from a set up's Directions: the directions box is out. */
  startWithDirections?: boolean;
  /** Where it sits in the steps, and the arrows to the one before and after
   *  (Derek, 2026-10-11: "can the arrows move them through the steps?"). */
  stepNo?: { at: number; total: number };
  onPrev?: () => void;
  onNext?: () => void;
  /** Which round of the review this is ("Review round 2"). */
  round?: string | null;
  /** Copies this step, with the task around it, for Claude. */
  onCopyForClaude?: () => void;
  /** Who is looking, so their own messages read "You → Derek". */
  meId?: string | null;
  /** Opened from "Create Checklist": the to-do box is out and ready. */
  startWithChecklist?: boolean;
  /** What's next, once this step is done: shown at the bottom of the page
   *  (Derek, 2026-10-13: "mark this done, then it pops open down below"). */
  nextPanel?: React.ReactNode;
  /** Hand this step, not done, to Claude to do (Derek, 2026-10-13: "I want
   *  Claude to do it"). */
  onGiveToClaude?: () => void;
  /** Finish the whole task from the bottom of the step. */
  onFinishTask?: () => void;
  /** Whose move it is, the same colour and sentence as the step's row. */
  tone?: { state?: string; say: string | null; word?: string; sayTone: string; rowTone: string };
  /** A Text or Chat step opens on that box, ready to write (2026-10-13). */
  startTalk?: "client" | "text" | "email";
  /** The client's waiting step: what is out with them, in place of adding work
   *  (nothing gets made while it is with them). */
  outFor?: React.ReactNode;
  /** In place of Mark done: how it ended, like "Derek approved" or "sent changes". */
  doneActions?: React.ReactNode;
  /** The links and files the step holds: their own row, apart from Actions. */
  files?: React.ReactNode;
  /** Sends the unsent email to the client held on this step, the way its
   *  window's Send does. Missing when there is none to send. */
  onSendHeldEmail?: () => void;
  /** What "Add client work" offers, besides a checklist and a text: a
   *  document, a review, an email (Derek, 2026-10-11). */
  addOptions?: { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void; tone?: { label: string; chip: string; text: string; dot: string } }[];
  canText?: boolean;
  onSendText?: (body: string) => void;
  /** Email the client from the step (Derek, 2026-10-11: "email, sms or chat,
   *  we need all the options"). */
  canEmail?: boolean;
  onSendEmail?: (subject: string, body: string) => void;
  /** The full email window (cc, files, AI), with what was typed here. */
  onFullEmail?: (subject: string, body: string) => void;
  /** A late client step's nudge, from the task page. */
  followBox?: React.ReactNode;
  /** What a plan's step makes and needs. */
  planBits?: React.ReactNode;
  /** What the step works on: its deliverables, links and files. */
  held?: React.ReactNode;
  /** Copies a link straight to this step, to send a teammate. */
  onCopyLink?: () => void;
  /** The client's portal, opened on this task (they don't see steps). */
  onCopyPortalLink?: () => void;
  /** The client's saved short links (quick links), to put on this step. */
  savedLinks?: { id: string; label: string; url: string; on: boolean }[];
  onAttachLinks?: (ids: string[]) => void;
  /** Ask the client about these to-dos: one email, the step stays put. */
  onAskTodos?: (todoIds: string[]) => void;
  messages: Message[];
  actions: TaskAction[];
  canChat: boolean;
  onSendChat?: (body: string) => void;
  onAddNote: (body: string) => void;
  /** A to-do ticked that came from a client's comment: the comment is done too. */
  onTodoDone?: (todo: StepTodo) => void;
  /** What the client sent from their portal for this step: they see each one ticked off there. */
  clientItems?: Subtask[];
  onToggleClientItem?: (id: string) => void;
}) {
  useEscapeToClose(onClose);
  const pageRef = useRef<HTMLDivElement>(null);
  // ← and → step through, unless typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // Only while this page is in front: a document or handoff window open
      // on top keeps its own keys (audit 2026-10-11).
      const front = document.activeElement;
      if (front && front !== document.body && !pageRef.current?.contains(front)) return;
      if (e.key === "ArrowLeft" && onPrev) { e.preventDefault(); onPrev(); }
      if (e.key === "ArrowRight" && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext]);
  const first = firstName ?? client.name.split(" ")[0];
  // A Personal to do is yours alone: its note is your own, not the team's.
  const own = task.clientId === PERSONAL_CLIENT_ID;
  const whatsNext = !sub.done && /: what's next\?$/.test(sub.title);
  const dir = useStepDirections({ sub, onPatchSub, startEditing: startWithDirections });
  const todo = useStepTodos({ sub, onPatchSub, messages, first, clientItems, onToggleClientItem, onTodoDone, onAskTodos, startOpen: startWithChecklist });
  // No box until a tab is picked (Derek, 2026-10-13: the conversation box was
  // what pulled the eye, away from the work). A tab again folds it.
  type Talk = "client" | "email" | "text" | "team";
  const [talk, setTalkState] = useState<Talk | null>(startTalk ?? null);
  const setTalk = (t: Talk) => { setTalkState((cur) => (cur === t ? null : t)); setFocusNext((f) => ({ box: "talk", n: (f?.n ?? 0) + 1 })); };
  const [subject, setSubject] = useState(`Re: ${task.title}`);
  // The saved links being picked, or null when the list is closed.
  const [linkPick, setLinkPick] = useState<string[] | null>(null);
  // Which Add menu is open (the + beside Actions, the rows' + More), or none.
  const [addOpen, setAddOpen] = useState<"main" | "compact" | "more" | null>(null);
  // Where the desktop menu sits, kept inside the window.
  const [addPos, setAddPos] = useState({ top: 0, left: 0 });
  const talkRef = useRef<HTMLTextAreaElement>(null);
  const todoRef = todo.ref;
  // Which box to put the cursor in next, set by a choice, done after drawing.
  const [focusNext, setFocusNext] = useState<{ box: "todo" | "talk"; n: number } | null>(startWithChecklist ? { box: "todo", n: 1 } : startTalk ? { box: "talk", n: 1 } : null);
  useEffect(() => {
    if (!focusNext) return;
    (focusNext.box === "todo" ? todoRef.current : talkRef.current)?.focus();
  }, [focusNext, todoRef]);
  // Everything "Add client work" offers: a checklist, the task's documents and
  // reviews and an email (from the task page), and a text.
  const options = [
    { key: "directions", label: "Directions", disabled: dir.open, note: dir.open ? "on this step" : undefined, onPick: dir.start },
    // The client's saved short links, picked from a list (Derek, 2026-10-12).
    ...(savedLinks.length && onAttachLinks ? [{ key: "links", label: "Saved links", note: `${savedLinks.length}`, onPick: () => { setLinkPick(savedLinks.filter((l) => l.on).map((l) => l.id)); } }] : []),
    { key: "checklist", label: "Checklist", onPick: () => { todo.setShowTodos(true); setFocusNext((f) => ({ box: "todo", n: (f?.n ?? 0) + 1 })); } },
    ...addOptions,
  ] as { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void; tone?: { label: string; chip: string; text: string; dot: string } }[];
  // What the step's name says it needs, as one button before + Add (Derek,
  // 2026-10-13; one thing per step, 2026-10-14): it does what picking that
  // item from + Add does, and goes once the step holds that kind of work.
  const holdsKind = (k: StepSuggestKind) =>
    k === "checklist" ? todo.show
    : k === "text" ? sub.draftMessage?.channel === "sms"
    : (sub.holds ?? []).includes(k);
  const optionFor = (k: StepSuggestKind) => options.find((o) => o.key === k);
  const named = whatsNext ? [] : suggestStepActions(sub.title, first);
  const suggestions = sub.done || sub.onClient || outFor !== undefined ? [] : named
    .filter((x) => !holdsKind(x.kind) && optionFor(x.kind) && !optionFor(x.kind)!.disabled)
    .map((x) => ({ ...x, onPick: optionFor(x.kind)!.onPick }));
  // The step's email is written and everything else its name asks for is on
  // it: finishing is sending (Derek, 2026-10-13: "Send the email to Ryan").
  const sendReady = !!onSendHeldEmail && holdsKind("email")
    && named.every((x) => x.kind === "email" || !optionFor(x.kind) || holdsKind(x.kind));
  // Light, never dark: the only dark button on a step is the one that
  // finishes it (Derek, 2026-10-14). Outlined with a ring, its kind's icon.
  const suggestButtons = (compact: boolean) => suggestions.map((x) => {
    const Icon = ADD_ICON[x.kind];
    return (
      <button key={x.kind} onClick={x.onPick} className={`inline-flex ${compact ? "h-8 px-2.5" : "h-10 px-3"} items-center gap-1.5 rounded-[5px] bg-surface text-[16px] font-semibold text-accent ring-1 ring-inset ring-border hover:bg-background hover:ring-accent`}>
        {Icon && <Icon className="h-4 w-4 shrink-0" />}{x.label}
      </button>
    );
  });
  const [draft, setDraft] = useState("");
  const nextRef = useRef<HTMLElement | null>(null);
  const hasNext = !!nextPanel;
  useEffect(() => { if (hasNext) nextRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [hasNext]);

  // What was said while this step ran, newest first under the box you write
  // in (Derek, 2026-10-12: "flip the conversation so the latest is at the top").
  const w = stepWindow(task.subtasks, sub.id, task.createdAt);
  const said = [
    ...messages.filter((m) => inWindow(m.at, w) && m.channel !== "call").map((m) => ({ key: `m_${m.id}`, at: m.at, kind: "message" as const, m })),
    ...actions.filter((a) => !!a.body.trim() && !a.parentId && inWindow(a.at, w)).map((a) => ({ key: `a_${a.id}`, at: a.at, kind: "action" as const, a })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  // One line for what was said: "2 emails, 1 text · last from Pamela, 2h ago".
  // Texts open by default: they have no box in Actions the way an email does
  // (Derek, 2026-10-13). Null until someone folds or opens it by hand.
  const [showSaidPick, setShowSaid] = useState<boolean | null>(null);
  const saidMessages = said.flatMap((x) => (x.kind === "message" ? [x.m] : []));
  const showSaid = showSaidPick ?? saidMessages.some((m) => m.channel === "sms");
  const saidNotes = said.filter((x) => x.kind === "action");
  const saidSummary = (() => {
    const n = (c: string) => saidMessages.filter((m) => m.channel === c).length;
    const parts = [[n("email"), "email"], [n("sms"), "text"], [n("chat"), "chat"]].filter(([k]) => (k as number) > 0).map(([k, w]) => `${k} ${w}${k === 1 ? "" : "s"}`);
    if (saidNotes.length) parts.push(`${saidNotes.length} team ${saidNotes.length === 1 ? "note" : "notes"}`);
    const last = saidMessages[0];
    if (!parts.length) return "None yet";
    return `${parts.join(", ")}${last ? ` · last ${last.direction === "inbound" ? `from ${first}` : "from us"}, ${timeAgo(last.at)}` : ""}`;
  })();

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    if (talk === "client" && onSendChat) onSendChat(body);
    else if (talk === "email" && onSendEmail) { if (!subject.trim()) return; onSendEmail(subject.trim(), body); }
    else if (talk === "text" && onSendText) onSendText(body);
    else onAddNote(body);
    setDraft("");
  };

  // The links in an email (the review link above all), kept clickable: the
  // text alone lost them (Derek, 2026-10-11).
  const linksOf = (html: string) => [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((x) => ({ href: x[1].replace(/&amp;/g, "&"), label: htmlToText(x[2]).trim() || x[1] }))
    .filter((l) => /^https?:\/\//.test(l.href));
  const toneOf = (m: Message) => CHANNEL_TONE[m.channel === "sms" ? "sms" : m.channel === "email" ? "email" : "chat"];
  // Nothing said yet: only the Note to the team link, no heading and no "None
  // yet" (Derek, 2026-10-13); they come back with the first message or note.
  const anySaid = saidMessages.length > 0 || saidNotes.length > 0;
  const conversation = (
    <section aria-labelledby={anySaid ? "step-talk" : undefined} aria-label={anySaid ? undefined : "Messages on this step"} className="flex min-w-0 flex-col gap-3">
      {/* Read only, folded (Derek, 2026-10-13: "we shouldn't be writing in
          those boxes"; the client is written to through Actions, as a
          draft held on the step). The only box here is a note to the team. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {anySaid && <button onClick={() => setShowSaid(!showSaid)} aria-expanded={showSaid}
          className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-left sm:w-auto sm:flex-nowrap">
          {/* On a phone the heading keeps its line and the summary takes the
              next one, whole (Derek, 2026-10-13); from sm up, one line. */}
          <h3 id="step-talk" className="shrink-0 text-[17px] font-bold">Messages on this step</h3>
          <span className="order-last min-w-0 basis-full text-[16px] text-muted sm:order-none sm:basis-auto sm:truncate">{saidSummary}</span>
          <I.chevron className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${showSaid ? "-rotate-90" : "rotate-180"}`} />
        </button>}
        <button onClick={() => setTalk("team")} className="text-[16px] font-semibold text-accent hover:underline">{talk === "team" ? "Close the note" : own ? "Add a note" : "Note to the team"}</button>
      </div>
      {/* The chat from when this step was a handoff, kept to read (Derek,
          2026-10-12: handoffs are steps now). */}
      {(sub.handoff?.thread?.length ?? 0) > 0 && (
        <details className="order-last rounded-[5px] bg-background px-3 py-2 text-[16px]">
          <summary className="cursor-pointer font-semibold text-muted">Earlier handoff chat ({sub.handoff!.thread!.length})</summary>
          <div className="mt-2 flex flex-col gap-2">
            {sub.handoff!.thread!.map((m) => (
              <div key={m.id} className={m.kind === "event" ? "text-muted" : ""}>
                <span className="font-semibold">{m.authorId ? userById(m.authorId)?.name ?? "Someone" : "Someone"}</span>
                <span className="text-muted"> · {timeAgo(m.at)}</span>
                <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</div>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className={showSaid && said.length ? "order-last flex flex-col gap-3" : "hidden"}>
        {said.map((x) => {
          if (x.kind === "message") {
            const m = x.m;
            const mine = m.direction === "outbound";
            // Who wrote to whom, so our own messages never read as the client's.
            const sender = mine ? (m.createdBy && m.createdBy === meId ? "You" : m.createdBy ? userById(m.createdBy)?.name.split(" ")[0] ?? "Us" : "Us") : first;
            const who = mine ? `${sender} → ${first}` : `${first} → ${meId ? "You" : "us"}`;
            const text = htmlToText(m.body).trim();
            return (
              <div key={x.key} className="flex gap-2.5">
                {mine && m.createdBy ? <Avatar id={m.createdBy} size={30} /> : (
                  <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: client.color }}>{initialsOf(client.name)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[16px]">
                    <span className="font-semibold">{who}</span>
                    <span className={`rounded-[5px] px-2 font-medium ${toneOf(m).surface} ${toneOf(m).label}`}>{m.channel === "email" ? "Email" : m.channel === "sms" ? "Text" : "Chat"}</span>
                    <span className="text-muted">{timeAgo(m.at)}</span>
                  </div>
                  {m.subject && <div className="text-[16px] font-semibold">{m.subject}</div>}
                  {/* The first lines, the rest one click away. */}
                  {text && <CollapsibleText text={text} className="text-[16px]" maxLines={2} maxChars={180} />}
                  {linksOf(m.body).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {linksOf(m.body).map((l, i) => (
                        <a key={i} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[16px] font-medium text-accent hover:bg-background">
                          <span className="min-w-0 truncate">{l.label}</span><span aria-hidden>↗</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }
          const a = x.a;
          const note = a.kind === "note" || a.kind === "team";
          return (
            <div key={x.key} className="flex gap-2.5">
              <Avatar id={a.authorId} size={30} />
              <div className={`min-w-0 flex-1 rounded-[5px] px-3 py-2 ${note ? CHANNEL_TONE.note.surface : "bg-background"}`}>
                <div className="flex flex-wrap items-center gap-x-2 text-[16px]">
                  <span className="font-semibold">{a.authorId ? userById(a.authorId)?.name ?? "Someone" : "Someone"}</span>
                  <span className="text-muted">{note ? "Team only" : a.kind} · {timeAgo(a.at)}</span>
                </div>
                <CollapsibleText text={a.body} className="text-[16px]" maxLines={6} maxChars={500} />
              </div>
            </div>
          );
        })}
      </div>
      {talk && <div className={`rounded-lg p-2 ${talk === "team" ? CHANNEL_TONE.note.surface : talk === "text" ? CHANNEL_TONE.sms.surface : talk === "email" ? CHANNEL_TONE.email.surface : CHANNEL_TONE.chat.surface}`}>
        {talk === "email" && (
          <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" placeholder="Subject"
            className="mb-1 w-full border-b bg-transparent px-2 py-1 text-[16px] font-semibold outline-none" />
        )}
        <label htmlFor={`step-msg-${sub.id}`} className="sr-only">{talk === "team" ? (own ? "Note" : "Note for the team") : `Message ${first}`}</label>
        <textarea ref={talkRef} id={`step-msg-${sub.id}`} value={draft} onChange={(e) => setDraft(e.target.value)}
          // An email is written in lines: Enter is a new line there, ⌘ Enter sends.
          // Enter adds a team note; anything to the client takes the Send
          // button or ⌘ Enter, so one keypress never reaches them by mistake.
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (talk === "team" || e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          rows={talk === "email" ? 5 : 2}
          placeholder={talk === "team" ? (own ? "A note about this step" : "Note for the team, about this step") : talk === "text" ? `Text ${first} about this step` : talk === "email" ? `Email ${first} about this step` : `Chat with ${first} about this step`}
          className="w-full resize-none bg-transparent px-2 py-1 text-[16px] outline-none" />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[16px] text-muted">{talk === "team" ? (own ? "Only you see this." : "Only your team sees this.") : <span className="hidden sm:inline">Sent when you press Send. Shows below, newest first.</span>}
            {talk === "email" && onFullEmail && <> <button onClick={() => { onFullEmail(subject, draft); setDraft(""); }} className="font-semibold text-accent underline decoration-dotted underline-offset-4">Full email</button></>}
          </span>
          <button onClick={send} disabled={!draft.trim()} className="h-9 rounded-lg bg-accent px-4 text-[16px] font-semibold text-white disabled:opacity-40">Send</button>
        </div>
      </div>}
    </section>
  );

  const empty = !held && !todo.show;
  // The one way to add to a step (Derek, 2026-10-11): a quick list to start
  // with while it is empty, then a button.
  // Once the step holds client work, the + sits beside its heading instead
  // (Derek, 2026-10-11: "reclaim that space").
  // "more": the + More at the end of an empty step's rows, with what the
  // rows leave out.
  const addMenu = (compact: boolean, items = options, more = false) => {
    const which = more ? "more" : compact ? "compact" : "main";
    const open = addOpen === which;
    const label = more ? "More to add to this step" : "Add to this step";
    const item = (o: (typeof items)[number]) => (
      <button key={o.key} role="menuitem" disabled={o.disabled} onClick={() => { setAddOpen(null); o.onPick(); }}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[16px] hover:bg-background disabled:opacity-50">
        <span className="min-w-0 truncate">{o.label}</span>
        {o.tone && <span className="shrink-0 rounded-[5px] px-1.5 font-semibold" style={{ background: o.tone.chip, color: o.tone.text }}>{o.tone.label}</span>}
        {o.note && <span className="min-w-0 flex-1 truncate text-right text-muted">{o.note}</span>}
      </button>
    );
    return (
      <div className="relative">
        <button onClick={(e) => {
          // Desktop: fixed under the button, kept inside the window both ways.
          const r = e.currentTarget.getBoundingClientRect();
          const w = Math.min(300, window.innerWidth - 16);
          const h = items.length * 44 + 14;
          setAddPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4 });
          setAddOpen(open ? null : which);
        }}
          aria-haspopup="menu" aria-expanded={open} title={label} aria-label={label}
          className={more ? "inline-flex h-10 items-center gap-1.5 rounded-[5px] px-2.5 text-[16px] font-semibold text-accent hover:bg-background"
            : compact ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-surface text-accent hover:bg-background"
            : "inline-flex h-10 items-center gap-1.5 rounded-[5px] border bg-surface px-3 text-[16px] font-semibold text-accent hover:bg-background"}><I.plus className="h-4 w-4" />{more ? <span>More</span> : !compact && <span className={suggestions.length ? "hidden sm:inline" : ""}>Add</span>}</button>
        {open && (<>
          <div className="fixed inset-0 z-30 hidden sm:block" onClick={() => setAddOpen(null)} />
          <div role="menu" aria-label={label} style={{ top: addPos.top, left: addPos.left }}
            className="fixed z-40 hidden max-h-[calc(100vh-16px)] w-[min(300px,calc(100vw-16px))] overflow-y-auto rounded-lg border bg-surface p-1.5 shadow-lg sm:block">
            {items.map(item)}
          </div>
          {/* A phone: a sheet at the bottom; anchored, it ran off the left edge (2026-10-14). */}
          <MenuSheet label={label} onClose={() => setAddOpen(null)}>{items.map(item)}</MenuSheet>
        </>)}
      </div>
    );
  };
  // One Add button, not a wall of them (Derek, 2026-10-13: "this is getting
  // messy"): the same list opens from it. What the step's name suggests sits
  // before it. No line explaining Add (Derek, 2026-10-13: remove it).
  const quickStart = (
    <section aria-label="Add to this step" className="flex flex-wrap items-center gap-3">
      {suggestButtons(false)}
      {addMenu(false)}
    </section>
  );
  // An empty open step (Derek, 2026-10-14): what its name suggests first,
  // light, then the Add menu's own choices in three labelled rows, each doing what
  // picking it from + Add does. A suggested one isn't shown twice.
  const suggested = new Set<string>(suggestions.map((x) => x.kind));
  const { rows: addRowList, rest: addRest } = addRowsOf(options, first, suggested);
  const addRows = (
    <section aria-label="Add to this step" className="flex flex-col gap-3">
      {suggestions.length > 0 && <div className="flex flex-wrap items-center gap-3">{suggestButtons(false)}</div>}
      <div className="flex flex-col gap-1">
        {addRowList.map((r, i) => (
          <div key={r.label} role="group" aria-label={r.label} className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
            <span className="mr-2 shrink-0 text-[16px] text-muted sm:min-w-[10rem]">{r.label}</span>
            {r.items.map((o) => {
              const Icon = ADD_ICON[o.key];
              const short = ADD_SHORT[o.key] ?? o.label;
              // A document already made elsewhere keeps its name and where it sits, as in the menu.
              const says = [o.label !== short && o.label, o.note].filter(Boolean).join(", ");
              return (
                <button key={o.key} disabled={o.disabled} onClick={o.onPick} title={says || undefined}
                  className="inline-flex h-10 items-center gap-1.5 rounded-[5px] px-2.5 text-[16px] font-semibold text-accent hover:bg-background disabled:opacity-50 disabled:hover:bg-transparent">
                  {Icon && <Icon className="h-4 w-4 shrink-0" />}{short}
                </button>
              );
            })}
            {i === addRowList.length - 1 && addRest.length > 0 && addMenu(false, addRest, true)}
          </div>
        ))}
      </div>
    </section>
  );
  // Why it is whose move, when the sentence's first word doesn't say it all.
  // A bare "Your turn" or "Claude's turn" is the sentence itself (2026-10-13).
  const reason = tone?.say && !sub.done && tone.say !== tone.word && !["Your turn", "Claude's turn"].includes(tone.say) ? tone.say : null;
  // The directions sit under the sentence the way the task shows its
  // description (Derek, 2026-10-13): muted text, four lines, Read more; a
  // click edits. Added from + Add like the rest (Derek, 2026-10-11); the ✳
  // above copies them for Claude.
  const directions = dir.node;

  // Drawn at the page level: inside the task drawer its own layer kept the
  // app's sidebar on top of the full page (Derek, 2026-10-11).
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {!full && <div className="fixed inset-0 z-[79] bg-black/30" onClick={onClose} />}
      <div ref={pageRef} role="dialog" aria-label={`Step: ${sub.title}`}
        className={`fixed z-[80] flex min-w-0 flex-col bg-surface ${full ? "inset-0" : "inset-y-0 right-0 w-full shadow-[-24px_0_48px_rgba(15,23,42,.18)] md:w-[min(760px,92vw)] md:rounded-l-2xl"}`}>
        {/* One line: a long task name shortens instead of pushing × down. */}
        {/* On a phone: back, the step arrows, one ⋯ menu and ×. Eight things
            in a row pushed the back link to nothing and the rest off screen
            (Derek, 2026-10-13). */}
        <div className="flex items-center gap-x-2 border-b px-2 py-2 text-[16px] sm:gap-x-3 sm:px-4">
          <button onClick={onClose} title={task.title} className="min-w-[3.5rem] flex-1 truncate rounded-[5px] px-2 py-1.5 text-left text-muted hover:bg-background hover:text-foreground">‹ {task.title}</button>
          {stepNo && stepNo.total > 1 && (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted">
              <button onClick={onPrev} disabled={!onPrev} title="Step before (←)" aria-label="Step before" className="rounded-lg p-1.5 hover:bg-background hover:text-foreground disabled:opacity-30"><I.chevron className="h-4 w-4" /></button>
              <span className="tabular-nums"><span className="hidden sm:inline">Step </span>{stepNo.at} of {stepNo.total}</span>
              <button onClick={onNext} disabled={!onNext} title="Step after (→)" aria-label="Step after" className="rounded-lg p-1.5 hover:bg-background hover:text-foreground disabled:opacity-30"><I.chevron className="h-4 w-4 rotate-180" /></button>
            </span>
          )}
          {/* Done, or nothing: the step is the stage (Derek, 2026-10-11). */}
          {sub.done
            ? <span className="hidden items-center gap-1.5 rounded-[5px] bg-background px-2 font-semibold sm:inline-flex"><I.check className="h-3.5 w-3.5" />Done</span>
 : null}
          <span className="sm:hidden">
            <ActionMenu label={<I.dots />} title="More" items={[
              onCopyPortalLink && { label: "Copy the client portal link", onClick: onCopyPortalLink },
              onCopyLink && { label: "Copy a link to this step", onClick: onCopyLink },
              onCopyForClaude && { label: "Copy this step for Claude", onClick: onCopyForClaude },
            ]} />
          </span>
          <span className="hidden items-center gap-x-3 sm:inline-flex">
          {onCopyPortalLink && <button onClick={onCopyPortalLink} title="Copy the client portal link (opens on this task; clients don't see steps)" aria-label="Copy the client portal link" className="inline-flex h-9 items-center gap-1 rounded-lg px-2 font-semibold text-muted hover:bg-background hover:text-foreground"><I.link /><span className="hidden sm:inline">Portal</span></button>}
          {onCopyLink && <button onClick={onCopyLink} title="Copy a link to this step" aria-label="Copy a link to this step" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-background hover:text-foreground"><I.link /></button>}
          {onCopyForClaude && <button onClick={onCopyForClaude} title="Copy this step for Claude" aria-label="Copy this step for Claude" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[18px] text-muted hover:bg-background hover:text-foreground"><span aria-hidden>✳</span></button>}
          <button onClick={onToggleFull} className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 font-semibold text-muted hover:bg-background hover:text-foreground">{full ? "Side panel" : "Open full page"}</button>
          </span>
          <button onClick={onClose} title="Close" aria-label="Close" className="shrink-0 rounded-lg p-2 text-muted hover:bg-background hover:text-foreground"><I.close /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-8 ${full ? "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:gap-10" : ""}`}>
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {/* No tick beside the title: the step is finished with the button at
                      the bottom, which then asks what's next (Derek, 2026-10-13). A
                      done step reopens from its Done line below. */}
                  {/* A "what's next?" step reads as that, its old name under it, and
                      the box names the next step (Derek, 2026-10-13: the last
                      step's whole instruction as its title was a mess). */}
                  <textarea value={whatsNext ? "" : sub.title} onChange={(e) => { if (!whatsNext || e.target.value.trim()) onRename(e.target.value); }} rows={1} aria-label="Step"
                    placeholder={whatsNext ? "What's next? Name the next step" : undefined}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    className="-mx-1 min-w-0 flex-1 resize-none rounded-md bg-transparent px-1 text-[20px] font-bold leading-tight outline-none [field-sizing:content] focus:bg-background sm:text-[24px]" />
                </div>
                {whatsNext && <div className="truncate text-[16px] text-muted" title={sub.title.replace(/: what's next\?$/, "")}>After: {sub.title.replace(/: what's next\?$/, "")}</div>}
                {/* Read like the task's header (Derek, 2026-10-13): the name,
                    one sentence ("● Your turn, assigned to Derek, due Oct 14,
                    follow up set a date"), then the directions in muted text. */}
                {setup ? (
                  // The rows fold into the sentence once answered.
                  <div className="mt-1 rounded-[5px] p-3 ring-1 ring-inset ring-border">
                    <StepSetup {...setup} meId={meId ?? null} autoFocus
                      lead={suggestions.map((x) => ({ key: x.kind, label: x.label, onPick: x.onPick }))}
                      rows={addRowList.map((r) => ({ label: r.label, items: r.items.map((o) => ({ key: o.key, label: o.label, disabled: o.disabled, title: [o.label !== (ADD_SHORT[o.key] ?? o.label) && o.label, o.note].filter(Boolean).join(", ") || undefined, onPick: o.onPick })) }))}
                      more={addRest.map((o) => ({ key: o.key, label: o.label, disabled: o.disabled, onPick: o.onPick }))}
                      onDone={(a, run) => setup.onDone(a, run)} />
                  </div>
                ) : controls}
                {/* Why it is whose move, when the sentence's first word doesn't
                    say it all ("Claude finished its part. Your turn", "Ryan
                    wrote", "Claude is working"): a line, no box, strong red
                    for your move, the step's own colour otherwise. */}
                {reason && (
                  <div className={`flex flex-wrap items-center gap-x-3 text-[16px] font-semibold leading-snug ${tone!.sayTone}`}>
                    <span>{reason}</span>
                    {/* The cloud session working it (lib/claudeCloud). */}
                    {sub.cloudSession?.url && <a href={sub.cloudSession.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:opacity-80">Watch Claude work ↗</a>}
                  </div>
                )}
                {sub.meeting && !sub.done && <JoinNowLine meeting={sub.meeting} />}
                {(sub.done || round) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] text-muted">
                    {round && <span className="font-semibold text-foreground">{round}</span>}
                    {sub.done && <span>{`${sub.outcome ?? "Done"}${sub.doneAt ? ` · ${timeAgo(sub.doneAt)}` : ""}`}</span>}
                    {sub.done && <button onClick={onReopen} className="font-semibold text-accent underline underline-offset-4 hover:opacity-80">Reopen this step</button>}
                  </div>
                )}
                {directions}
              </div>
              {followBox}
              {planBits}
              {setup ? null : outFor !== undefined ? outFor : empty && !files && !dir.open ? (sub.done || whatsNext ? quickStart : addRows) : null}
              {/* Saved links: tick the ones this step needs. */}
              {linkPick !== null && onAttachLinks && (
                <section aria-label="Saved links" className="flex flex-col gap-2 rounded-[5px] border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[17px] font-bold">Saved links</h3>
                    <button onClick={() => setLinkPick(null)} aria-label="Close" className="rounded px-1.5 text-muted hover:text-foreground">×</button>
                  </div>
                  <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
                    {savedLinks.map((l) => (
                      <li key={l.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-[5px] px-1.5 py-1 text-[16px] hover:bg-background">
                          <input type="checkbox" checked={linkPick.includes(l.id)} disabled={l.on}
                            onChange={() => setLinkPick((p) => (p ?? []).includes(l.id) ? (p ?? []).filter((x) => x !== l.id) : [...(p ?? []), l.id])}
                            className="h-4 w-4 accent-[var(--accent)]" />
                          <span className="min-w-0 flex-1 truncate font-medium">{l.label}</span>
                          <span className="min-w-0 max-w-[45%] truncate text-muted">{l.on ? "on this step" : l.url.replace(/^https?:\/\//, "")}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    const fresh = linkPick.filter((id) => !savedLinks.find((l) => l.id === id)?.on);
                    return (
                      <div className="flex items-center gap-2">
                        <button disabled={!fresh.length} onClick={() => { onAttachLinks(fresh); setLinkPick(null); }}
                          className="h-9 rounded-[5px] bg-accent px-3 text-[16px] font-semibold text-white disabled:opacity-40">Add {fresh.length || ""} {fresh.length === 1 ? "link" : "links"}</button>
                        <button onClick={() => setLinkPick(null)} className="h-9 rounded-[5px] px-2 text-[16px] text-muted hover:text-foreground">Cancel</button>
                      </div>
                    );
                  })()}
                </section>
              )}
              {todo.node}
              {/* Actions right under the to dos, even with no work on it yet. */}
              {!setup && outFor === undefined && !held && !(empty && !files && !dir.open) && <div className="flex flex-wrap items-center gap-3">{suggestButtons(false)}{addMenu(false)}</div>}
              {held && (
                <section aria-labelledby="step-works" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="step-works" className="text-[17px] font-bold">Actions</h3>
                    {outFor === undefined && !setup && <>{suggestButtons(true)}{addMenu(true)}</>}
                  </div>
                  {held}
                </section>
              )}
              {/* Links and files, apart from what does something (Derek,
                  2026-10-14); they come in by paste or drag (2026-10-11). */}
              {(files || held) && (
                <section aria-labelledby="step-files" className="flex flex-col gap-2">
                  {files && <h3 id="step-files" className="text-[17px] font-bold">Links and files</h3>}
                  {files}
                  <p className="hidden text-[16px] text-muted sm:block">Paste a link or drop a file anywhere on this page to add it here.</p>
                </section>
              )}
              {/* Finish here, then What's next opens in its place (2026-10-13). */}
              {nextPanel ? (
                <section ref={nextRef} aria-label="What's next" className="rounded-[5px] border-2 border-accent/30 bg-surface p-4 shadow-soft">{nextPanel}</section>
              ) : !sub.done && doneActions ? (
                // A waiting step's answer (approved, sent changes) and a
                // "what's next?" step's choices sit here too, where a step is
                // finished, not up top (Derek, 2026-10-13).
                <div className="border-t pt-4">{doneActions}</div>
              ) : !sub.done && !doneActions && !sub.onClient ? (
                <div className="border-t pt-4">
                  {/* One button while you work (Derek, 2026-10-13: "I'm done with
                      this step when you click it, then ask what you want to do
                      next"). The choices (start the next step, give it to Claude,
                      the task is finished) come after, in What's next; the
                      button says so (2026-10-14: "Done · what's next?"). */}
                  {sendReady ? (
                    <div className="flex flex-col items-start gap-2">
                      <button onClick={onSendHeldEmail} className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Send the email to {first}</button>
                      {/* Finishing without sending stays one click away. */}
                      <button onClick={onMarkDone} className="text-[16px] font-medium text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">Done, without sending</button>
                    </div>
                  ) : (
                    <button onClick={onMarkDone} aria-label="Done with this step, choose what's next" className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Done · what&apos;s next?</button>
                  )}
                </div>
              ) : null}
            </div>
            <div className={`min-w-0 ${full ? "mt-8 md:mt-0" : "mt-8"}`}>{conversation}</div>
          </div>
          {(onDelete || onToTask) && (
            <div className="mx-auto mt-10 flex w-full max-w-[1280px] flex-wrap justify-end gap-2 border-t px-4 pb-8 pt-4 sm:px-8">
              {onToTask && <button onClick={onToTask} title="Moves this step, its directions and to dos into a new task for the same client" className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Make it its own task</button>}
              {onDelete && <button onClick={onDelete} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[16px] font-medium text-muted hover:bg-danger-soft hover:text-danger"><I.trash className="h-4 w-4" /> Delete step</button>}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

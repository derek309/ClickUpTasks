"use client";

// A new step, set up as the step card reads (Derek, 2026-10-17: "add the
// title of the step, open description and checklist on creation, then have
// the assigning sentence below, under checklist add"; then: the task has the
// description, a step defaults to a checklist). Top to bottom: the name, the
// Checklist open with one to do to type, + Add ▾ (Description first, for a
// step that needs its own context, then a document, image, review, video,
// email and the rest), then the turn sentence ("Your turn, due Tomorrow",
// each word a picker) and the one button that follows whose turn it is
// (lib/newStepBox). No rows of buttons. Enter in the name moves to the first
// to do, Enter in a to do adds the next one, Tab moves through, Cmd+Enter
// saves, Escape cancels.
//
// Two places: + Add step on a task (its own button), and step 1 in the new
// task box (no name and no button: the box's own Add makes it).
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CLAUDE_ID, isLongTitle } from "@/lib/data";
import { descriptionLabel, turnWord } from "@/lib/stepThenNext";
import { canSaveNewStep, newStepButton, newStepWhen, type NewStepValue } from "@/lib/newStepBox";
import { impliedBy } from "@/lib/stepSetup";
import { TurnLine, type TurnChoice } from "./TurnLine";
import { OnThisStep } from "./OnThisStep";
import { ADD_ICON, ADD_SHORT, type SetupAction } from "./StepSetup";
import { friendlyDue } from "./GroupedList";
import { useEscapeToClose } from "./useEscapeToClose";

type Todo = { id: string; text: string };
const FIELD = "w-full min-w-0 rounded-[5px] bg-surface px-3 py-2 text-[16px] outline-none ring-1 ring-inset ring-border placeholder:text-muted focus:ring-2 focus:ring-accent";

/** A step's Checklist, open, to write in as it is made, and its Description
 *  once asked for (Derek, 2026-10-17: the task has the description, a step
 *  is a checklist of what needs doing in it). The new step box and What's
 *  next draw the same. One to do to type; Enter adds the next, Backspace in
 *  an empty one takes it off. */
export function StepWriteFields({ label = "Description", tone = null, description, onDescription, onTodos, descriptionOpen, onOpenDescription }: {
  label?: string;
  tone?: "client" | "claude" | null;
  description: string;
  onDescription: (d: string) => void;
  onTodos: (t: string[]) => void;
  /** The Description shows only once asked for (+ Add ▾ Description). */
  descriptionOpen: boolean;
  /** A quiet "+ Description" under the checklist, where there is no + Add. */
  onOpenDescription?: () => void;
}) {
  const uid = useId();
  // Opened by hand: the cursor goes into it.
  const openedAtStart = useRef(descriptionOpen);
  useEffect(() => {
    if (descriptionOpen && !openedAtStart.current) setTimeout(() => document.getElementById(`${uid}-description`)?.focus(), 0);
  }, [descriptionOpen, uid]);
  // Ids per box, the same on the server and in the browser.
  const seq = useRef(1);
  const blankTodo = (): Todo => ({ id: `t${seq.current++}`, text: "" });
  const [todos, setTodos] = useState<Todo[]>([{ id: "t0", text: "" }]);
  // The to do to put the cursor in once it is drawn (a new one is not yet).
  const focusNext = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(`${uid}-todo-${focusNext.current}`)?.focus();
    focusNext.current = null;
  });
  const focus = (id: string) => { const el = document.getElementById(`${uid}-todo-${id}`); if (el) el.focus(); else focusNext.current = id; };
  const put = (next: Todo[]) => { setTodos(next); onTodos(next.map((t) => t.text)); };
  const todoKey = (e: React.KeyboardEvent<HTMLInputElement>, t: Todo, i: number) => {
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!t.text.trim()) return;
      // The next one: a new line after this, or the empty one already there.
      const after = todos[i + 1];
      if (after && !after.text.trim()) { focus(after.id); return; }
      const n = blankTodo();
      put([...todos.slice(0, i + 1), n, ...todos.slice(i + 1)]);
      focus(n.id);
    } else if (e.key === "Backspace" && !t.text && todos.length > 1) {
      e.preventDefault();
      const next = todos.filter((x) => x.id !== t.id);
      put(next);
      focus((todos[i - 1] ?? next[0]).id);
    }
  };
  return (<>
    {descriptionOpen && <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`${uid}-description`} className={`text-[16px] font-semibold ${tone === "client" ? "text-amber-700 dark:text-amber-300" : tone === "claude" ? "text-violet-700 dark:text-violet-300" : ""}`}>{label}</label>
      <textarea id={`${uid}-description`} data-new-step="description" value={description} rows={3} onChange={(e) => onDescription(e.target.value)}
        placeholder="What it is and why. Links help." className={`${FIELD} resize-y leading-snug`} />
    </div>}
    <section aria-labelledby={`${uid}-check`} className="flex min-w-0 flex-col gap-1.5">
      <h3 id={`${uid}-check`} className="text-[16px] font-semibold">Checklist</h3>
      <ul className="flex flex-col gap-1.5">
        {todos.map((t, i) => (
          <li key={t.id} className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="h-[22px] w-[22px] shrink-0 rounded-[5px] border-2 border-border" />
            <input id={`${uid}-todo-${t.id}`} data-new-step={i === 0 ? "todo" : undefined} value={t.text} onChange={(e) => put(todos.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
              onKeyDown={(e) => todoKey(e, t, i)} placeholder="Add a to do" aria-label={`To do ${i + 1}`} autoComplete="off" enterKeyHint="next"
              className="min-w-0 flex-1 rounded-[5px] bg-transparent px-2 py-1.5 text-[16px] outline-none placeholder:text-muted hover:bg-background focus:bg-background focus:ring-1 focus:ring-inset focus:ring-accent" />
          </li>
        ))}
      </ul>
      {!descriptionOpen && onOpenDescription && (
        <button type="button" onClick={onOpenDescription} className="inline-flex min-h-9 items-center gap-1 self-start rounded-[5px] px-1 text-[16px] font-semibold text-accent hover:bg-background">+ Description</button>
      )}
    </section>
  </>);
}

export function NewStepBox({ title = "", onTitle, titleField = true, choices, whoInitial, whenInitial, today, meId, clientFirst, nameOf, actions, hideWho = false, hideWhen = false, onSave, onCancel, onChange, autoFocus = false, longHint = false }: {
  /** The step's name, held by the caller (the task's + Add step row types it). */
  title?: string;
  onTitle?: (t: string) => void;
  /** False where the name is typed outside the box (a desktop's + Add step
   *  row, or the new task box, where the task names it). */
  titleField?: boolean;
  /** Whose turn: You, teammates, Claude, the client by first name. */
  choices: { key: string; label: string }[];
  whoInitial: string | null;
  whenInitial: string;
  today: string;
  meId: string | null;
  clientFirst: string;
  nameOf: (id: string) => string;
  /** + Add ▾: a document, image, review, video, email, and the rest. */
  actions: SetupAction[];
  /** Your own list: nobody else's turn. */
  hideWho?: boolean;
  /** A queue list's step 1: its date comes when it reaches Now. */
  hideWhen?: boolean;
  /** Missing: no button (the new task box has its own Add). */
  onSave?: (v: NewStepValue, run?: () => void) => void;
  onCancel?: () => void;
  /** Told each change (the new task box reads it when it adds the task). */
  onChange?: (v: NewStepValue) => void;
  autoFocus?: boolean;
  /** Under the name: a name that is a whole request goes into the description. */
  longHint?: boolean;
}) {
  const uid = useId();
  const [description, setDescription] = useState("");
  const [descOpen, setDescOpen] = useState(false);
  const [todos, setTodos] = useState<string[]>([]);
  const [who, setWho] = useState<string | null>(whoInitial);
  const [when, setWhen] = useState(whenInitial);
  const [action, setAction] = useState<string | null>(null);
  const value = (p: Partial<NewStepValue> = {}): NewStepValue => {
    const v = { title, description, todos, who, when, action, ...p };
    return { ...v, when: newStepWhen(v.who, v.when, today) };
  };
  const tell = (p: Partial<NewStepValue>) => onChange?.(value(p));
  const focus = (part: "title" | "todo") => {
    const box = document.getElementById(`${uid}-box`);
    (part === "title" ? document.getElementById(`${uid}-title`) : box?.querySelector<HTMLElement>("[data-new-step=todo]"))?.focus();
  };
  useEffect(() => { if (autoFocus) focus(titleField ? "title" : "todo"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickWho = (k: string) => {
    setWho(k);
    if (k === CLAUDE_ID) setWhen(today);
    tell({ who: k, ...(k === CLAUDE_ID ? { when: today } : {}) });
  };
  const pickWhen = (d: string | null) => { if (!d) return; setWhen(d); tell({ when: d }); };
  const pickAction = (a: SetupAction) => {
    // Talking to the client is your turn, today (lib/stepSetup impliedBy).
    const imp = impliedBy(a.key, meId, today);
    setAction(a.key);
    if (imp.who && !hideWho) setWho(imp.who);
    if (imp.when && !hideWhen) setWhen(imp.when);
    tell({ action: a.key, ...(imp.who && !hideWho ? { who: imp.who } : {}), ...(imp.when && !hideWhen ? { when: imp.when } : {}) });
  };
  const dropAction = () => { setAction(null); tell({ action: null }); };

  const picked = action ? actions.find((a) => a.key === action) ?? null : null;
  const ready = canSaveNewStep(value(), meId);
  const save = () => {
    if (!onSave || !ready) return;
    onSave(value(), picked?.onPick);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSave) { e.preventDefault(); save(); }
  };
  // Escape cancels, after any menu or calendar opened over the box.
  useEscapeToClose(() => onCancel?.(), !!onCancel);

  const o = { meId, clientFirst, nameOf };
  const turn = who === "client" ? "client" : who === CLAUDE_ID ? "claude" : !who || who === meId ? "me" : "teammate";
  const desc = descriptionLabel(turn, clientFirst);
  const dot = who === "client" ? "#d97706" : who === CLAUDE_ID ? "#7c3aed" : !who || who === meId ? "#ef4444" : "#d97706";
  const turnChoices: TurnChoice[] = choices.map((c) => ({ ...c, on: c.key === who || (!who && c.key === meId) }));
  const Icon = picked ? ADD_ICON[picked.key] : null;
  return (
    <section id={`${uid}-box`} aria-label="New step" onKeyDown={onKeyDown} className="flex min-w-0 flex-col gap-4">
      {titleField && (
        <div className="flex min-w-0 items-center gap-2">
          {/* No "name" in its attributes: Safari offers contact AutoFill on one. */}
          <input id={`${uid}-title`} data-name value={title} onChange={(e) => { onTitle?.(e.target.value); onChange?.(value({ title: e.target.value })); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) { e.preventDefault(); focus("todo"); } }}
            placeholder="Name the step" aria-label="Step name" name="step-title" autoComplete="off" autoCorrect="on" enterKeyHint="next"
            className={`${FIELD} h-11 text-[17px] font-semibold placeholder:font-medium`} />
          {onCancel && <button type="button" onClick={onCancel} aria-label="Cancel" title="Cancel (Escape)" className="h-11 w-11 shrink-0 rounded-[5px] text-[20px] text-muted hover:bg-background hover:text-foreground">×</button>}
        </div>
      )}
      {longHint && isLongTitle(title) && <p className="-mt-2 text-[16px] text-muted">The full request goes into the step&apos;s description</p>}

      <StepWriteFields label={desc.label} tone={desc.tone} description={description} descriptionOpen={descOpen}
        onDescription={(d) => { setDescription(d); tell({ description: d }); }}
        onTodos={(t) => { setTodos(t); tell({ todos: t }); }} />

      {/* What it uses, once picked from + Add: put on it as it is saved. */}
      {(picked || actions.length > 0 || !descOpen) && (
        <div className="flex min-w-0 flex-col gap-1.5">
          {picked && (<>
            <h3 className="text-[16px] font-semibold">Using</h3>
            <div className="flex min-w-0 items-center gap-2 rounded-[5px] bg-surface px-3 py-2 ring-1 ring-inset ring-border">
              {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{ADD_SHORT[picked.key] ?? picked.label}</span>
              <button type="button" onClick={dropAction} aria-label={`Take ${ADD_SHORT[picked.key] ?? picked.label} off`} title="Take it off"
                className="h-9 w-9 shrink-0 rounded-[5px] text-[18px] text-muted hover:bg-background hover:text-danger">×</button>
            </div>
          </>)}
          {(actions.length > 0 || !descOpen) && (
            <OnThisStep first={clientFirst} hint={picked ? undefined : "description, doc, image, page, video, email"}
              onDescription={descOpen ? undefined : () => setDescOpen(true)}
              options={actions.map((a) => ({ key: a.key, label: a.label, disabled: a.disabled, onPick: () => pickAction(a) }))} />
          )}
        </div>
      )}

      {!(hideWho && hideWhen) && (
        <TurnLine word={turnWord(who, o)} choices={hideWho ? undefined : turnChoices} onPick={pickWho}
          lead={<span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: dot }} />}
          fixedDate={who === CLAUDE_ID && !hideWhen ? "today" : undefined}
          dateLead={hideWhen ? undefined : who === "client" ? "need by" : "due"} date={hideWhen ? undefined : when} onDate={hideWhen || who === CLAUDE_ID ? undefined : pickWhen}
          formatDate={friendlyDue} />
      )}

      {onSave && (
        <div className="flex flex-col-reverse gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-end">
          <button type="button" onClick={save} disabled={!ready} title="⌘ Enter"
            className="h-11 w-full rounded-[5px] bg-accent px-5 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-40 sm:w-auto">{newStepButton(who, o)}</button>
        </div>
      )}
    </section>
  );
}

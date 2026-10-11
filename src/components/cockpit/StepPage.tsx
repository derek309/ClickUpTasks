"use client";

// One step's own page (Derek, 2026-10-11, mockup
// https://claude.ai/artifact/HKJa1eM5eJZ2U3JVB78AaC): what the step works on,
// its to-do list, and what was said while it ran, with the client and with
// the team. It slides out over the task to look at something quickly and
// opens full page to work in, like a handoff. Messages to the client are
// ordinary messages; they show here because they were sent while the step
// ran (stepWindow), nothing is filed apart for the client.
import { useEffect, useRef, useState } from "react";
import {
  STATUS_META, htmlToText, timeAgo, userById, initialsOf, inWindow, stepWindow, todoProgress,
  type Message, type StepTodo, type Subtask, type Task, type TaskAction, type TaskStatus,
} from "@/lib/data";
import { I, Avatar, CollapsibleText, newId } from "./ui";
import { CHANNEL_TONE } from "./channelTone";
import { useEscapeToClose } from "./useEscapeToClose";

export function StepPage({ task, sub, client, stage, isCurrent, full, onToggleFull, onClose, onRename, onPatchSub, onMarkDone, onReopen, onDelete,
  controls, addOptions = [], canText = false, onSendText, followBox, planBits, held, handoff, messages, actions, canChat, onSendChat, onAddNote, onTodoDone, clientItems = [], onToggleClientItem }: {
  task: Task;
  sub: Subtask;
  client: { name: string; color: string };
  stage: TaskStatus;
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
  /** The step's date, who has it, its stage, attach and delete. */
  controls?: React.ReactNode;
  /** What "Add client work" offers, besides a checklist and a text: a
   *  document, a review, an email (Derek, 2026-10-11). */
  addOptions?: { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void }[];
  canText?: boolean;
  onSendText?: (body: string) => void;
  /** The current step's follow up, from the task page. */
  followBox?: React.ReactNode;
  /** What a plan's step makes and needs. */
  planBits?: React.ReactNode;
  /** What the step works on: its deliverables, links and files. */
  held?: React.ReactNode;
  /** A teammate's step: their handoff, one click away. */
  handoff?: React.ReactNode;
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
  const first = client.name.split(" ")[0];
  const todos = sub.todos ?? [];
  const own = todoProgress(todos);
  const progress = { done: own.done + clientItems.filter((c) => c.done).length, total: own.total + clientItems.length };
  const [todoDraft, setTodoDraft] = useState("");
  const [talk, setTalk] = useState<"client" | "text" | "team">(canChat ? "client" : "team");
  const [showTodos, setShowTodos] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const todoRef = useRef<HTMLInputElement>(null);
  const talkRef = useRef<HTMLTextAreaElement>(null);
  // Which box to put the cursor in next, set by a choice, done after drawing.
  const [focusNext, setFocusNext] = useState<{ box: "todo" | "talk"; n: number } | null>(null);
  useEffect(() => {
    if (!focusNext) return;
    (focusNext.box === "todo" ? todoRef.current : talkRef.current)?.focus();
  }, [focusNext]);
  // Everything "Add client work" offers: a checklist, the task's documents and
  // reviews and an email (from the task page), and a text.
  const options = [
    { key: "checklist", label: "Checklist", onPick: () => { setShowTodos(true); setFocusNext((f) => ({ box: "todo", n: (f?.n ?? 0) + 1 })); } },
    ...addOptions,
    ...(canText && onSendText ? [{ key: "text", label: "Send text", onPick: () => { setTalk("text"); setFocusNext((f) => ({ box: "talk", n: (f?.n ?? 0) + 1 })); } }] : []),
  ] as { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void }[];
  const [draft, setDraft] = useState("");

  const setTodos = (next: StepTodo[]) => onPatchSub({ todos: next.length ? next : undefined });
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

  // What was said while this step ran, oldest first, like a chat.
  const w = stepWindow(task.subtasks, sub.id, task.createdAt);
  const said = [
    ...messages.filter((m) => inWindow(m.at, w) && m.channel !== "call").map((m) => ({ key: `m_${m.id}`, at: m.at, kind: "message" as const, m })),
    ...actions.filter((a) => !!a.body.trim() && !a.parentId && inWindow(a.at, w)).map((a) => ({ key: `a_${a.id}`, at: a.at, kind: "action" as const, a })),
  ].sort((x, y) => x.at.localeCompare(y.at));

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    if (talk === "client" && onSendChat) onSendChat(body);
    else if (talk === "text" && onSendText) onSendText(body);
    else onAddNote(body);
    setDraft("");
  };

  const toneOf = (m: Message) => CHANNEL_TONE[m.channel === "sms" ? "sms" : m.channel === "email" ? "email" : "chat"];
  const conversation = (
    <section aria-labelledby="step-talk" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="step-talk" className="text-[17px] font-bold">Conversation on this step</h3>
        <div role="group" aria-label="Who to talk to" className="flex gap-1 rounded-lg bg-background p-1">
          {canChat && <button onClick={() => setTalk("client")} aria-pressed={talk === "client"} className={`h-9 rounded-md px-3 text-[16px] font-semibold ${talk === "client" ? "bg-surface shadow-soft" : "text-muted"}`}>With {first}</button>}
          {talk === "text" && <button aria-pressed className="h-9 rounded-md bg-surface px-3 text-[16px] font-semibold shadow-soft">Text</button>}
          <button onClick={() => setTalk("team")} aria-pressed={talk === "team"} className={`h-9 rounded-md px-3 text-[16px] font-semibold ${talk === "team" ? "bg-surface shadow-soft" : "text-muted"}`}>Team</button>
        </div>
      </div>
      {said.length === 0 && <p className="text-[16px] text-muted">Nothing said on this step yet.</p>}
      <div className="flex flex-col gap-3">
        {said.map((x) => {
          if (x.kind === "message") {
            const m = x.m;
            const mine = m.direction === "outbound";
            const who = mine ? (m.createdBy ? userById(m.createdBy)?.name ?? "Us" : "Us") : client.name;
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
                  {m.subject && <div className="text-[16px] font-medium">{m.subject}</div>}
                  {text && <CollapsibleText text={text} className="text-[16px]" maxLines={6} maxChars={500} />}
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
      <div className={`rounded-lg p-2 ${talk === "team" ? CHANNEL_TONE.note.surface : talk === "text" ? CHANNEL_TONE.sms.surface : CHANNEL_TONE.chat.surface}`}>
        <label htmlFor={`step-msg-${sub.id}`} className="sr-only">{talk === "team" ? "Note for the team" : `Message ${first}`}</label>
        <textarea ref={talkRef} id={`step-msg-${sub.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          placeholder={talk === "team" ? "Note for the team, about this step" : talk === "text" ? `Text ${first} about this step` : `Message ${first} about this step`}
          className="w-full resize-none bg-transparent px-2 py-1 text-[16px] outline-none" />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[16px] text-muted">{talk === "team" ? "Only your team sees this." : "Sent when you press Send. Shows under this step here."}</span>
          <button onClick={send} disabled={!draft.trim()} className="h-9 rounded-lg bg-accent px-4 text-[16px] font-semibold text-white disabled:opacity-40">Send</button>
        </div>
      </div>
    </section>
  );

  const hasTodos = todos.length > 0 || clientItems.length > 0 || showTodos;
  const empty = !held && todos.length === 0 && clientItems.length === 0 && !showTodos;
  // The one way to add to a step (Derek, 2026-10-11): a quick list to start
  // with while it is empty, then a button.
  const addButton = (
    <div className="relative">
      <button onClick={() => setAddOpen((o) => !o)} aria-haspopup="menu" aria-expanded={addOpen}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-[16px] font-semibold text-accent hover:bg-background"><I.plus className="h-4 w-4" /> Add client work</button>
      {addOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setAddOpen(false)} />
        <div role="menu" aria-label="Add client work" className="absolute left-0 top-full z-40 mt-1 w-[min(300px,calc(100vw-32px))] rounded-lg border bg-surface p-1.5 shadow-lg">
          {options.map((o) => (
            <button key={o.key} role="menuitem" disabled={o.disabled} onClick={() => { setAddOpen(false); o.onPick(); }}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[16px] hover:bg-background disabled:opacity-50">
              <span className="min-w-0 flex-1">{o.label}</span>{o.note && <span className="shrink-0 text-muted">{o.note}</span>}
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
  const quickStart = (
    <section aria-label="Add client work" className="flex flex-col gap-2">
      <h3 className="text-[17px] font-bold">Add client work</h3>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.key} disabled={o.disabled} onClick={o.onPick} title={o.note}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-[16px] font-medium hover:border-accent hover:bg-background disabled:opacity-50"><I.plus className="h-4 w-4 text-accent" /> {o.label}</button>
        ))}
      </div>
      <p className="text-[16px] text-muted">Or paste a link or drop a file anywhere on this page.</p>
    </section>
  );
  const todoList = !hasTodos ? null : (
    <section aria-labelledby="step-todo" className="flex flex-col gap-2">
      <h3 id="step-todo" className="text-[17px] font-bold">To do{progress.total > 0 && <span className="font-normal text-muted"> · {progress.done} of {progress.total}</span>}</h3>
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
            <li key={t.id} className="group/todo flex items-start gap-2.5">
              <button onClick={() => toggleTodo(t)} aria-pressed={t.done} aria-label={t.done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-2 ${t.done ? "border-accent bg-accent text-white" : "border-border hover:border-accent"}`}>{t.done && <I.check className="h-3.5 w-3.5" />}</button>
              <span className={`min-w-0 flex-1 text-[16px] [overflow-wrap:anywhere] ${t.done ? "text-muted line-through" : ""}`}>
                {t.title}{t.fromClient && <span className="ml-2 font-semibold text-sky-700 no-underline dark:text-sky-300">from {first}</span>}
              </span>
              <button onClick={() => setTodos(todos.filter((x) => x.id !== t.id))} title="Delete" aria-label={`Delete ${t.title}`}
                className="shrink-0 text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover/todo:opacity-100"><I.trash className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <input ref={todoRef} value={todoDraft} onChange={(e) => setTodoDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTodo(); }}
        placeholder="+ Add a to do" aria-label="Add a to do"
        className="rounded-md border border-transparent px-2 py-1.5 text-[16px] outline-none placeholder:text-accent hover:bg-background focus:border-accent focus:bg-background focus:placeholder:text-muted" />
    </section>
  );

  return (
    <>
      {!full && <div className="fixed inset-0 z-[79] bg-black/30" onClick={onClose} />}
      <div role="dialog" aria-label={`Step: ${sub.title}`}
        className={`fixed z-[80] flex min-w-0 flex-col bg-surface ${full ? "inset-0" : "inset-y-0 right-0 w-full shadow-[-24px_0_48px_rgba(15,23,42,.18)] md:w-[min(760px,92vw)] md:rounded-l-2xl"}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[16px]">
          <button onClick={onClose} className="min-w-0 max-w-[50%] truncate rounded-lg px-2 py-1.5 text-muted hover:bg-background hover:text-foreground">‹ {task.title}</button>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-background px-2 font-semibold"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_META[stage].dot }} />{STATUS_META[stage].label}</span>
          <button onClick={onToggleFull} className="rounded-lg px-2.5 py-1.5 font-semibold text-muted hover:bg-background hover:text-foreground">{full ? "Side panel" : "Open full page"}</button>
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-background hover:text-foreground"><I.close /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-8 ${full ? "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:gap-10" : ""}`}>
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-col gap-2">
                <textarea value={sub.title} onChange={(e) => onRename(e.target.value)} rows={1} aria-label="Step"
                  onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                  className="-mx-1 w-full resize-none rounded-md bg-transparent px-1 text-[24px] font-bold leading-tight outline-none [field-sizing:content] focus:bg-background" />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] text-muted">
                  <span>{sub.done ? `Done${sub.doneAt ? ` ${timeAgo(sub.doneAt)}` : ""}` : isCurrent ? "The current step" : "Comes later"}</span>
                  {sub.assigneeId && <span>· on {userById(sub.assigneeId)?.name ?? "a teammate"}</span>}
                </div>
                {controls}
                <div>
                  {sub.done
                    ? <button onClick={onReopen} className="h-10 rounded-lg border px-4 text-[16px] font-semibold hover:bg-background">Reopen this step</button>
                    : isCurrent && !followBox && <button onClick={onMarkDone} className="h-10 rounded-lg bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Mark done</button>}
                </div>
              </div>
              {followBox}
              {planBits}
              {empty ? quickStart : <div>{addButton}</div>}
              {todoList}
              {held && (
                <section aria-labelledby="step-works" className="flex flex-col gap-2">
                  <h3 id="step-works" className="text-[17px] font-bold">Client work</h3>
                  {held}
                  {/* Links and files come in by paste or drag (Derek, 2026-10-11). */}
                  <p className="text-[16px] text-muted">Paste a link or drop a file anywhere on this page to add it here.</p>
                </section>
              )}
              {handoff}
            </div>
            <div className={`min-w-0 ${full ? "mt-8 md:mt-0" : "mt-8"}`}>{conversation}</div>
          </div>
          {onDelete && (
            <div className="mx-auto mt-10 flex w-full max-w-[1280px] justify-end border-t px-4 pb-8 pt-4 sm:px-8">
              <button onClick={onDelete} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[16px] font-medium text-muted hover:bg-danger-soft hover:text-danger"><I.trash className="h-4 w-4" /> Delete step</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

"use client";

// One step's own page (Derek, 2026-10-11, mockup
// https://claude.ai/artifact/HKJa1eM5eJZ2U3JVB78AaC): what the step works on,
// its to-do list, and what was said while it ran, with the client and with
// the team. It slides out over the task to look at something quickly and
// opens full page to work in, like a handoff. Messages to the client are
// ordinary messages; they show here because they were sent while the step
// ran (stepWindow), nothing is filed apart for the client.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  htmlToText, timeAgo, userById, initialsOf, inWindow, stepWindow, todoProgress, todoWaiting,
  type Message, type StepTodo, type Subtask, type Task, type TaskAction, type TaskStatus,
} from "@/lib/data";
import { I, Avatar, CollapsibleText, newId } from "./ui";
import { ActionMenu } from "./ActionMenu";
import { CHANNEL_TONE } from "./channelTone";
import { useEscapeToClose } from "./useEscapeToClose";
import { RichTextEditor } from "./RichTextEditor";
import { safeMessageHtml } from "@/lib/safeHtml";

export function StepPage({ task, sub, client, isCurrent, full, onToggleFull, onClose, onRename, onPatchSub, onMarkDone, onReopen, onDelete,
  controls, stepNo, onPrev, onNext, onCopyForClaude, meId, round, startWithChecklist = false, startTalk, tone, nextPanel, onFinishTask, outFor, doneActions, addOptions = [], onSendText, onSendEmail, onFullEmail, followBox, planBits, held, onCopyLink, onCopyPortalLink, onAskTodos, savedLinks = [], onAttachLinks, messages, actions, onSendChat, onAddNote, onTodoDone, clientItems = [], onToggleClientItem }: {
  task: Task;
  sub: Subtask;
  client: { name: string; color: string };
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
  /** The step's date, who has it, its stage, attach and delete. */
  controls?: React.ReactNode;
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
  /** Finish the whole task from the bottom of the step. */
  onFinishTask?: () => void;
  /** Whose move it is, the same colour and sentence as the step's row. */
  tone?: { say: string | null; sayTone: string; rowTone: string };
  /** A Text or Chat step opens on that box, ready to write (2026-10-13). */
  startTalk?: "client" | "text" | "email";
  /** The client's waiting step: what is out with them, in place of adding work
   *  (nothing gets made while it is with them). */
  outFor?: React.ReactNode;
  /** In place of Mark done: how it ended, like "Derek approved" or "sent changes". */
  doneActions?: React.ReactNode;
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
  const first = client.name.split(" ")[0];
  const todos = sub.todos ?? [];
  const own = todoProgress(todos);
  const progress = { done: own.done + clientItems.filter((c) => c.done).length, total: own.total + clientItems.length };
  const [todoDraft, setTodoDraft] = useState("");
  // No box until a tab is picked (Derek, 2026-10-13: the conversation box was
  // what pulled the eye, away from the work). A tab again folds it.
  type Talk = "client" | "email" | "text" | "team";
  const [talk, setTalkState] = useState<Talk | null>(startTalk ?? null);
  const setTalk = (t: Talk) => { setTalkState((cur) => (cur === t ? null : t)); setFocusNext((f) => ({ box: "talk", n: (f?.n ?? 0) + 1 })); };
  const [subject, setSubject] = useState(`Re: ${task.title}`);
  const [showTodos, setShowTodos] = useState(startWithChecklist);
  const [dirOpen, setDirOpen] = useState(!!sub.notes && htmlToText(sub.notes).trim() !== "");
  // The saved links being picked, or null when the list is closed.
  const [linkPick, setLinkPick] = useState<string[] | null>(null);
  // Directions read as text once written; new ones open ready to type.
  const [dirEditing, setDirEditing] = useState(!(sub.notes && htmlToText(sub.notes).trim()));
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
  const [addOpen, setAddOpen] = useState(false);
  const todoRef = useRef<HTMLInputElement>(null);
  const talkRef = useRef<HTMLTextAreaElement>(null);
  // Which box to put the cursor in next, set by a choice, done after drawing.
  const [focusNext, setFocusNext] = useState<{ box: "todo" | "talk"; n: number } | null>(startWithChecklist ? { box: "todo", n: 1 } : startTalk ? { box: "talk", n: 1 } : null);
  useEffect(() => {
    if (!focusNext) return;
    (focusNext.box === "todo" ? todoRef.current : talkRef.current)?.focus();
  }, [focusNext]);
  // Everything "Add client work" offers: a checklist, the task's documents and
  // reviews and an email (from the task page), and a text.
  const options = [
    { key: "directions", label: "Directions", disabled: dirOpen, note: dirOpen ? "on this step" : undefined, onPick: () => { setDirRemoved(null); setDirOpen(true); setDirEditing(true); } },
    // The client's saved short links, picked from a list (Derek, 2026-10-12).
    ...(savedLinks.length && onAttachLinks ? [{ key: "links", label: "Saved links", note: `${savedLinks.length}`, onPick: () => { setLinkPick(savedLinks.filter((l) => l.on).map((l) => l.id)); } }] : []),
    { key: "checklist", label: "Checklist", onPick: () => { setShowTodos(true); setFocusNext((f) => ({ box: "todo", n: (f?.n ?? 0) + 1 })); } },
    ...addOptions,
  ] as { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void; tone?: { label: string; chip: string; text: string; dot: string } }[];
  const [draft, setDraft] = useState("");
  const nextRef = useRef<HTMLElement | null>(null);
  const hasNext = !!nextPanel;
  useEffect(() => { if (hasNext) nextRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [hasNext]);
  const whatsNext = !sub.done && /: what's next\?$/.test(sub.title);

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

  // What was said while this step ran, newest first under the box you write
  // in (Derek, 2026-10-12: "flip the conversation so the latest is at the top").
  const w = stepWindow(task.subtasks, sub.id, task.createdAt);
  const said = [
    ...messages.filter((m) => inWindow(m.at, w) && m.channel !== "call").map((m) => ({ key: `m_${m.id}`, at: m.at, kind: "message" as const, m })),
    ...actions.filter((a) => !!a.body.trim() && !a.parentId && inWindow(a.at, w)).map((a) => ({ key: `a_${a.id}`, at: a.at, kind: "action" as const, a })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  // One line for what was said: "2 emails, 1 text · last from Pamela, 2h ago".
  const [showSaid, setShowSaid] = useState(false);
  const saidMessages = said.flatMap((x) => (x.kind === "message" ? [x.m] : []));
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
  const conversation = (
    <section aria-labelledby="step-talk" className="flex min-w-0 flex-col gap-3">
      {/* Read only, folded (Derek, 2026-10-13: "we shouldn't be writing in
          those boxes"; the client is written to through Actions, as a
          draft held on the step). The only box here is a note to the team. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => setShowSaid((o) => !o)} aria-expanded={showSaid} disabled={!saidMessages.length && !saidNotes.length}
          className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default">
          <h3 id="step-talk" className="text-[17px] font-bold">Messages on this step</h3>
          <span className="min-w-0 truncate text-[16px] text-muted">{saidSummary}</span>
          {(saidMessages.length > 0 || saidNotes.length > 0) && <I.chevron className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${showSaid ? "-rotate-90" : "rotate-180"}`} />}
        </button>
        <button onClick={() => setTalk("team")} className="text-[16px] font-semibold text-accent hover:underline">{talk === "team" ? "Close the note" : "Note to the team"}</button>
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
        <label htmlFor={`step-msg-${sub.id}`} className="sr-only">{talk === "team" ? "Note for the team" : `Message ${first}`}</label>
        <textarea ref={talkRef} id={`step-msg-${sub.id}`} value={draft} onChange={(e) => setDraft(e.target.value)}
          // An email is written in lines: Enter is a new line there, ⌘ Enter sends.
          // Enter adds a team note; anything to the client takes the Send
          // button or ⌘ Enter, so one keypress never reaches them by mistake.
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (talk === "team" || e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          rows={talk === "email" ? 5 : 2}
          placeholder={talk === "team" ? "Note for the team, about this step" : talk === "text" ? `Text ${first} about this step` : talk === "email" ? `Email ${first} about this step` : `Chat with ${first} about this step`}
          className="w-full resize-none bg-transparent px-2 py-1 text-[16px] outline-none" />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[16px] text-muted">{talk === "team" ? "Only your team sees this." : <span className="hidden sm:inline">Sent when you press Send. Shows below, newest first.</span>}
            {talk === "email" && onFullEmail && <> <button onClick={() => { onFullEmail(subject, draft); setDraft(""); }} className="font-semibold text-accent underline decoration-dotted underline-offset-4">Full email</button></>}
          </span>
          <button onClick={send} disabled={!draft.trim()} className="h-9 rounded-lg bg-accent px-4 text-[16px] font-semibold text-white disabled:opacity-40">Send</button>
        </div>
      </div>}
    </section>
  );

  const hasTodos = todos.length > 0 || clientItems.length > 0 || showTodos;
  const empty = !held && todos.length === 0 && clientItems.length === 0 && !showTodos;
  // The one way to add to a step (Derek, 2026-10-11): a quick list to start
  // with while it is empty, then a button.
  // Once the step holds client work, the + sits beside its heading instead
  // (Derek, 2026-10-11: "reclaim that space").
  const addMenu = (compact: boolean) => (
    <div className="relative">
      <button onClick={() => setAddOpen((o) => !o)} aria-haspopup="menu" aria-expanded={addOpen} title="Add to this step" aria-label="Add to this step"
        className={compact ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-surface text-accent hover:bg-background"
          : "inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-[16px] font-semibold text-accent hover:bg-background"}><I.plus className="h-4 w-4" />{!compact && " Add"}</button>
      {addOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setAddOpen(false)} />
        <div role="menu" aria-label="Add to this step" className="absolute left-0 top-full z-40 mt-1 w-[min(300px,calc(100vw-32px))] rounded-lg border bg-surface p-1.5 shadow-lg">
          {options.map((o) => (
            <button key={o.key} role="menuitem" disabled={o.disabled} onClick={() => { setAddOpen(false); o.onPick(); }}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[16px] hover:bg-background disabled:opacity-50">
              <span className="min-w-0 truncate">{o.label}</span>
              {o.tone && <span className="shrink-0 rounded-[5px] px-1.5 font-semibold" style={{ background: o.tone.chip, color: o.tone.text }}>{o.tone.label}</span>}
              {o.note && <span className="min-w-0 flex-1 truncate text-right text-muted">{o.note}</span>}
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
  // One Add button, not a wall of them (Derek, 2026-10-13: "this is getting
  // messy"): the same list opens from it.
  const quickStart = (
    <section aria-label="Add to this step" className="flex flex-wrap items-center gap-3">
      {addMenu(false)}
      <span className="text-[16px] text-muted">An email, a text, a document, a checklist or directions<span className="hidden sm:inline">, or paste a link or drop a file anywhere on this page</span>.</span>
    </section>
  );
  const todoList = !hasTodos ? null : (
    <section aria-labelledby="step-todo" className="flex flex-col gap-2">
      <h3 id="step-todo" className="text-[17px] font-bold">To do{progress.total > 0 && <span className="font-normal text-muted"> · {progress.done} of {progress.total}</span>}{waitingOn > 0 && <span className="font-semibold text-sky-700 dark:text-sky-300"> · {waitingOn} waiting on {first}</span>}</h3>
      {/* The questions picked so far, asked in one email. */}
      {asking.length > 0 && onAskTodos && (
        <div className="flex flex-wrap items-center gap-2 rounded-[5px] bg-sky-50 px-3 py-2 text-[16px] dark:bg-sky-500/10">
          <span className="min-w-0 flex-1 font-semibold">Ask {first} about {asking.length === 1 ? "this one" : `these ${asking.length}`}</span>
          <button onClick={() => { onAskTodos(asking); setAsking([]); }} className="h-9 rounded-[5px] bg-accent px-3 font-semibold text-white hover:opacity-90">Write the email</button>
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
                  className={`shrink-0 rounded-[5px] px-1.5 text-[15px] font-semibold text-accent hover:bg-background ${asking.includes(t.id) ? "" : "opacity-0 focus:opacity-100 group-hover/todo:opacity-100"}`}>{asking.includes(t.id) ? "✓ Ask" : `Ask ${first}`}</button>
              )}
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
                  {/* The tick the step lines use, in place of a Mark done button
                      (Derek, 2026-10-11). The client's own step is answered below instead. */}
                  {/* Any open step can be ticked, not only the current one. */}
                  {(sub.done || !doneActions) && (
                    <button onClick={sub.done ? onReopen : onMarkDone} aria-pressed={sub.done}
                      title={sub.done ? "Done. Click to reopen this step" : "Mark this step done"} aria-label={sub.done ? "Reopen this step" : "Mark this step done"}
                      className={`group/tick flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${sub.done ? "bg-accent text-white hover:opacity-80" : "text-accent ring-2 ring-inset ring-accent hover:bg-accent hover:text-white"}`}>
                      {/* A ring, not a border: globals.css recolours every border. */}
                      <I.check className={`h-4 w-4 ${sub.done ? "" : "opacity-30 group-hover/tick:opacity-100"}`} />
                    </button>
                  )}
                  {/* A "what's next?" step reads as that, its old name under it, and
                      the box names the next step (Derek, 2026-10-13: the last
                      step's whole instruction as its title was a mess). */}
                  <textarea value={whatsNext ? "" : sub.title} onChange={(e) => { if (!whatsNext || e.target.value.trim()) onRename(e.target.value); }} rows={1} aria-label="Step"
                    placeholder={whatsNext ? "What's next? Name the next step" : undefined}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    className="-mx-1 min-w-0 flex-1 resize-none rounded-md bg-transparent px-1 text-[20px] font-bold leading-tight outline-none [field-sizing:content] focus:bg-background sm:text-[24px]" />
                </div>
                {whatsNext && <div className="truncate text-[16px] text-muted" title={sub.title.replace(/: what's next\?$/, "")}>After: {sub.title.replace(/: what's next\?$/, "")}</div>}
                {(sub.done || !isCurrent || round) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] text-muted">
                    {round && <span className="font-semibold text-foreground">{round}</span>}
                    {(sub.done || !isCurrent) && <span>{sub.done ? `${sub.outcome ?? "Done"}${sub.doneAt ? ` · ${timeAgo(sub.doneAt)}` : ""}` : "Comes later"}</span>}
                  </div>
                )}
                {/* Whose move it is, as on the step's row (2026-10-13). */}
                {tone?.say && !sub.done && <div className={`rounded-[5px] px-3 py-2 text-[16px] font-semibold ${tone.rowTone} ${tone.sayTone}`}>{tone.say}</div>}
                {controls}
                {!sub.done && isCurrent && doneActions && <div>{doneActions}</div>}
              </div>
              {followBox}
              {planBits}
              {outFor !== undefined ? outFor : empty && !dirOpen ? quickStart : held ? null : <div>{addMenu(false)}</div>}
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
              {/* Directions: what we want on this step, added from + Add like
                  the rest (Derek, 2026-10-11). The ✳ above copies it for Claude. */}
              {!dirOpen && dirRemoved !== null && (
                <p className="text-[16px] text-muted">Directions deleted. <button onClick={() => { if (dirRemoved) onPatchSub({ notes: dirRemoved }); setDirRemoved(null); setDirOpen(true); setDirEditing(true); }} className="font-semibold text-accent underline underline-offset-4">Undo</button></p>
              )}
              {dirOpen && (
                <section aria-labelledby="step-directions" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id="step-directions" className="text-[17px] font-bold">Directions</h3>
                    {/* Read, or write in (Derek, 2026-10-12: "no way to save or
                        close the directions"). They save as you type; Done closes. */}
                    {dirEditing
                      ? <button onClick={() => { if (dirTimer.current) { clearTimeout(dirTimer.current); dirTimer.current = null; dirSave.current?.(); } setDirEditing(false); }} className="ml-auto h-9 rounded-[5px] bg-accent px-3 text-[16px] font-semibold text-white hover:opacity-90">Done</button>
                      : <button onClick={() => setDirEditing(true)} className="ml-auto h-9 rounded-[5px] px-3 text-[16px] font-semibold text-accent hover:bg-background">Edit</button>}
                    <button onClick={removeDirections} title="Delete the directions" aria-label="Delete the directions" className="rounded-lg p-2 text-muted hover:bg-background hover:text-danger"><I.trash className="h-4 w-4" /></button>
                  </div>
                  {!dirEditing ? (
                    <div role="button" tabIndex={0} onClick={() => setDirEditing(true)} onKeyDown={(e) => { if (e.key === "Enter") setDirEditing(true); }} title="Click to edit"
                      className="rte-content cursor-text rounded-[5px] px-1 py-0.5 text-[16px] hover:bg-background" dangerouslySetInnerHTML={{ __html: safeMessageHtml(sub.notes ?? "") }} />
                  ) : (
                  <RichTextEditor key={`step-dir-${sub.id}`} value={sub.notes ?? ""} autoFocus
                    onChange={(html) => {
                      if (dirTimer.current) clearTimeout(dirTimer.current);
                      dirSave.current = () => onPatchSub({ notes: htmlToText(html).trim() ? html : undefined });
                      dirTimer.current = setTimeout(() => { dirTimer.current = null; dirSave.current?.(); }, 600);
                    }}
                    placeholder="What we want on this step: what to make, what to change, where things are…" />
                  )}
                  {dirEditing && <p className="text-[16px] text-muted">Saves as you type.</p>}
                </section>
              )}
              {todoList}
              {held && (
                <section aria-labelledby="step-works" className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3 id="step-works" className="text-[17px] font-bold">Actions</h3>
                    {outFor === undefined && addMenu(true)}
                  </div>
                  {held}
                  {/* Links and files come in by paste or drag (Derek, 2026-10-11). */}
                  <p className="hidden text-[16px] text-muted sm:block">Paste a link or drop a file anywhere on this page to add it here.</p>
                </section>
              )}
              {/* Finish here, then What's next opens in its place (2026-10-13). */}
              {nextPanel ? (
                <section ref={nextRef} aria-label="What's next" className="rounded-[5px] border-2 border-accent/30 bg-surface p-4 shadow-soft">{nextPanel}</section>
              ) : !sub.done && !doneActions && !sub.onClient ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <button onClick={onMarkDone} className="inline-flex h-11 items-center gap-2 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90"><I.check className="h-4 w-4" /> Mark this step done</button>
                  {onFinishTask && <button onClick={onFinishTask} className="h-11 rounded-[5px] border px-4 text-[16px] font-semibold hover:bg-background">The task is finished</button>}
                </div>
              ) : null}
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
    </>,
    document.body,
  );
}

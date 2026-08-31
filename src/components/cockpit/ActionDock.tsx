"use client";

import { useEffect, useRef, useState } from "react";
import {
  Attachment, Contact, Message, Task, TaskAction, TaskActionKind, TaskStatus, htmlToText,
  TASK_ACTION_META, TASK_ACTION_ORDER, STATUS_META, STATUS_ORDER,
  User, addDaysIso, TODAY, formatDue, daysUntilDue,
} from "@/lib/data";
import { I, newId } from "./ui";
// Plain fetch reaches this route without a session and gets a 401 back.
import { authedFetch } from "@/lib/supabase";

// The floating action dock.
//
// Everything you can DO to a task from one bar, and every action records
// itself and then asks what happens next. That second half is the whole
// point: the old activity feed logged what the app did to a task, so a task
// could be worked on for a week and still end up with nothing scheduled.
//
// Collapsed it is one line: the commitment you already made, and a button.
// Eleven chips permanently on screen made the bar the loudest thing in the
// drawer for something you do a few times a day.

const ICON: Record<TaskActionKind, string> = {
  note: "📝", team: "👥", chat: "🗨", email: "✉", sms: "💬", call: "☎", met: "👥", meeting: "📅",
};

// Named offsets rather than a date picker for the common cases. Picking
// "in 3 days" off a calendar means counting squares; naming it does not.
function whenOptions(due: string | null): { label: string; date: string }[] {
  const opts = [
    { label: "Tomorrow", date: addDaysIso(TODAY, 1) },
    { label: "In 3 days", date: addDaysIso(TODAY, 3) },
    { label: "Next week", date: addDaysIso(TODAY, 7) },
  ];
  // Offering a check-back after the promised date is offering to be late on
  // purpose, so those options are dropped rather than shown and ignored.
  return due ? opts.filter((o) => o.date <= due) : opts;
}

export function ActionDock({
  task, client, contact, actions, messages, me, users, onLog, onSetNextStepDone, onPatch, onAddComment, onOpenCompose, onSendDm, taskLink, askNextStepFor, onAskNextStepHandled, pushToast,
}: {
  task: Task;
  client: { name: string } | null;
  contact: Contact | null;
  actions: TaskAction[];
  // Read only, for answering questions from the task's own record.
  messages?: Message[];
  me: User | null;
  users: User[];
  onLog: (a: TaskAction) => void;
  onSetNextStepDone: (id: string, done: boolean) => void;
  onPatch: (patch: Partial<Task>) => void;
  onAddComment: (body: string, attachments?: Attachment[]) => void;
  // Opens the drawer's real composer, the one with attachments, cc/bcc,
  // scheduling and AI drafting. The dock used to render its own plain
  // textarea, which meant two ways to send the same message with the poorer
  // one in front.
  onOpenCompose?: (channel: "activity" | "chat" | "email" | "sms") => void;
  // Set once a message has actually gone out. The dock reopens on it to ask
  // what happens next, so sending stops being a dead end.
  // A real DM, not an @mention comment on the task. The mention notified
  // correctly but the message lived on the task, so it never showed up in the
  // one place that teammate actually reads.
  onSendDm?: (userId: string, body: string) => void;
  taskLink?: () => string;
  askNextStepFor?: { kind: TaskActionKind; body: string } | null;
  onAskNextStepHandled?: () => void;
  pushToast: (msg: string) => void;
}) {
  const [view, setView] = useState<"closed" | "menu" | "askTask" | TaskActionKind>("closed");
  const [body, setBody] = useState("");
  const [teammate, setTeammate] = useState<string | null>(null);
  const [nextStep, setNextStep] = useState("");
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [stage, setStage] = useState<TaskStatus | null>(null);
  // Explicit, rather than inferring "wanted" from the text being non-empty.
  // Setting nextStep to a space to force the panel open trimmed straight back
  // to empty, so the link did nothing.
  const [quickNote, setQuickNote] = useState("");
  const postQuickNote = () => {
    const text = quickNote.trim();
    if (!text) return;
    // No companion comment. The action IS the note; writing both put the same
    // sentence in the feed twice, once as "Left a note" and once as a bare
    // comment underneath it.
    onLog({ id: newId("ta_"), taskId: task.id, kind: "note", authorId: me?.id ?? null,
      body: text, at: new Date().toISOString(), nextStep: null, nextStepDue: null, nextStepDoneAt: null });
    setQuickNote("");
    pushToast("Note added");
  };
  const [wantNext, setWantNext] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [thread, setThread] = useState<{ q: string; a: string }[]>([]);
  const [aiReason, setAiReason] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const open = view !== "closed" && view !== "menu" && view !== "askTask";

  // Opening a panel clears it here, in the handler, rather than in an effect
  // watching `view`. A half-typed email must not leak into the next action
  // you take, and doing it on the event avoids a cascading render.
  const openPanel = (v: "closed" | "menu" | "askTask" | TaskActionKind) => {
    // These three have a real composer already. The dock hands off and gets
    // out of the way; onMessageSent brings it back to ask what's next.
    if ((v === "chat" || v === "email" || v === "sms") && onOpenCompose) { onOpenCompose(v); setView("closed"); return; }
    setView(v);
    setBody(""); setNextStep(""); setNextDue(null); setStage(null); setAiReason("");
    setWantNext(v !== "closed" && v !== "menu" && v !== "askTask" ? TASK_ACTION_META[v as TaskActionKind].needsNextStep : false);
    setTeammate(users.find((u) => u.id !== me?.id)?.id ?? null);
  };
  // Reopens the dock straight into "what's next?" for a message that just
  // sent. Deferred a frame because it lands during the composer's own render.
  useEffect(() => {
    if (!askNextStepFor) return;
    const r = requestAnimationFrame(() => {
      setView(askNextStepFor.kind);
      setBody(askNextStepFor.body); setNextStep(""); setNextDue(null); setStage(null); setAiReason("");
      setWantNext(true);
      onAskNextStepHandled?.();
    });
    return () => cancelAnimationFrame(r);
  }, [askNextStepFor, onAskNextStepHandled]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => bodyRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [view, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && view !== "closed") { e.stopPropagation(); setView("closed"); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [view]);

  const suggest = async (kind: TaskActionKind) => {
    setAiBusy(true);
    try {
      const res = await authedFetch("/api/ai/next-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title, description: task.description, clientName: client?.name ?? "",
          kind: TASK_ACTION_META[kind].verb, note: body, due: task.due, today: TODAY,
          history: actions.slice(0, 8).map((a) => `${a.at.slice(0, 10)} ${TASK_ACTION_META[a.kind].verb}: ${a.body.slice(0, 160)}`),
        }),
      });
      const j = await res.json();
      if (!res.ok) { pushToast(j?.error ?? "Couldn't get a suggestion."); return; }
      if (!j.nextStep) { pushToast("Nothing left to schedule, by the look of it."); return; }
      setNextStep(j.nextStep);
      setNextDue(j.nextStepDue ?? null);
      setAiReason(j.reason ?? "");
    } catch { pushToast("Couldn't reach the AI."); }
    finally { setAiBusy(false); }
  };

  // Reads the transcript, keeps the record, throws the transcript away. Four
  // thousand words of "yeah, right, mm-hm" in the activity feed buries every
  // other entry around it; what the meeting decided does not.
  const summariseMeeting = async () => {
    const text = body.trim();
    if (!text) { pushToast("Paste the transcript first."); return; }
    setSummarising(true);
    try {
      const res = await authedFetch("/api/ai/meeting", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, title: task.title, clientName: client?.name ?? "", due: task.due, today: TODAY }),
      });
      const j = await res.json();
      if (!res.ok) { pushToast(j?.error ?? "Couldn't read that transcript."); return; }
      setBody(j.summary);
      if (j.nextStep) { setNextStep(j.nextStep); setNextDue(j.nextStepDue ?? null); setWantNext(true); }
      pushToast("Summarised — edit anything before you log it");
    } catch { pushToast("Couldn't reach the AI."); }
    finally { setSummarising(false); }
  };

  // Everything written on this task, oldest first, as plain text. Built here
  // rather than server-side because the client already holds all of it and
  // re-fetching it would be a second source of truth for what "this task
  // says", which is the one thing the answer has to be grounded in.
  const taskRecord = (): string => {
    const parts: string[] = [
      `Title: ${task.title}`,
      client?.name ? `Client: ${client.name}` : "",
      task.due ? `Due: ${task.due}` : "",
      htmlToText(task.description).trim() ? `Description:\n${htmlToText(task.description).trim()}` : "",
      task.subtasks.length ? `Checklist:\n${task.subtasks.map((x) => `${x.done ? "[x]" : "[ ]"} ${x.title}`).join("\n")}` : "",
      task.attachments.length ? `Attachments:\n${task.attachments.map((a) => `${a.name}${a.url ? ` (${a.url})` : ""}`).join("\n")}` : "",
    ];
    const entries = [
      ...actions.map((a) => ({ at: a.at, text: `[${a.at.slice(0, 10)}] ${TASK_ACTION_META[a.kind].verb}: ${a.body}${a.nextStep ? `\nNext step: ${a.nextStep}` : ""}` })),
      ...(messages ?? []).map((m) => ({ at: m.at, text: `[${m.at.slice(0, 10)}] ${m.direction === "inbound" ? "Received" : "Sent"} ${m.channel}${m.subject ? ` — ${m.subject}` : ""}:\n${htmlToText(m.body).trim()}` })),
      ...task.comments.filter((c) => c.kind !== "event").map((c) => ({ at: c.at, text: `[${c.at.slice(0, 10)}] Note: ${c.body}` })),
    ].sort((x, y) => x.at.localeCompare(y.at));
    return [...parts.filter(Boolean), entries.length ? `History:\n${entries.map((e) => e.text).join("\n\n")}` : ""].filter(Boolean).join("\n\n");
  };

  const askTask = async (q: string) => {
    const question = q.trim();
    if (!question) return;
    setAsking(true);
    setAsk("");
    try {
      const res = await authedFetch("/api/ai/ask-task", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: taskRecord(), history: thread.slice(-4) }),
      });
      const j = await res.json();
      if (!res.ok) { pushToast(j?.error ?? "Couldn't answer that."); setAsk(question); return; }
      setThread((t) => [...t, { q: question, a: j.answer }]);
    } catch { pushToast("Couldn't reach the AI."); setAsk(question); }
    finally { setAsking(false); }
  };

  const commit = (kind: TaskActionKind) => {
    const text = body.trim();
    if (kind === "note" && !text) { pushToast("Write the note first."); return; }

    if (kind === "team" && teammate) {
      if (!text) { pushToast("Write the message first."); return; }
      // Goes to their DM thread, with the task quoted and linked so the
      // message stands on its own in a place that has no other context.
      const link = taskLink?.();
      // Built as two halves rather than one filtered list: filter(Boolean)
      // ate the blank separator line, so the message ran straight into the
      // "Re:" with no break.
      const ref = [`Re: ${task.title}${client?.name ? ` · ${client.name}` : ""}`, link].filter(Boolean).join("\n");
      const quoted = `${text}\n\n${ref}`;
      if (onSendDm) onSendDm(teammate, quoted);
      else onAddComment(`@${users.find((u) => u.id === teammate)?.name ?? ""} ${text}`.trim());
    }

    onLog({
      id: newId("ta_"), taskId: task.id, kind, authorId: me?.id ?? null,
      body: text, at: new Date().toISOString(),
      nextStep: nextStep.trim() || null,
      nextStepDue: nextStep.trim() ? nextDue : null,
      nextStepDoneAt: null,
    });

    // The next step's date IS the follow-up date. Two separate "when does
    // this come back" fields would drift apart within a week.
    const patch: Partial<Task> = {};
    if (nextStep.trim() && nextDue) patch.followUpAt = nextDue;
    if (stage && stage !== task.status) patch.status = stage;
    if (Object.keys(patch).length) onPatch(patch);

    pushToast(`${TASK_ACTION_META[kind].verb}${nextStep.trim() ? ` · next step ${nextDue ? formatDue(nextDue) : "set"}` : ""}`);
    setView("closed");
  };

  const nextStepPanel = (kind: TaskActionKind) => (
    <div className="mt-2.5 rounded-[10px] border bg-background p-3 shadow-[inset_0_2px_5px_rgba(20,24,40,.06)]">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-[19px] w-[19px] items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">2</span>
        <span className="text-[14px] font-bold">What&apos;s next?</span>
        <button onClick={() => suggest(kind)} disabled={aiBusy}
          className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[13px] text-muted hover:bg-surface hover:text-foreground disabled:opacity-50">
          <I.bolt /> {aiBusy ? "Thinking…" : "Suggest"}
        </button>
      </div>
      <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="What do you do next?"
        className="w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
      {aiReason && <div className="mt-1.5 text-[13px] text-muted">{aiReason}</div>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Check back</span>
        {whenOptions(task.due).map((o) => (
          <button key={o.label} onClick={() => setNextDue(o.date)}
            className={`rounded-md border px-2 py-1 text-[13px] ${nextDue === o.date ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}
            title={formatDue(o.date)}>{o.label}</button>
        ))}
        <label className={`cursor-pointer rounded-md border px-2 py-1 text-[13px] ${nextDue && !whenOptions(task.due).some((o) => o.date === nextDue) ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>
          {nextDue && !whenOptions(task.due).some((o) => o.date === nextDue) ? formatDue(nextDue) : "Pick a date"}
          <input type="date" value={nextDue ?? ""} onChange={(e) => setNextDue(e.target.value || null)} className="sr-only" />
        </label>
        <span className="ml-3 text-[12px] font-semibold uppercase tracking-wide text-muted">Stage</span>
        {STATUS_ORDER.filter((s) => s !== "done").map((s) => (
          <button key={s} onClick={() => setStage(s)}
            className={`rounded-md border px-2 py-1 text-[13px] ${(stage ?? task.status) === s ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{STATUS_META[s].label}</button>
        ))}
      </div>
    </div>
  );

  const header = (kind: TaskActionKind) => (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[15px] font-semibold">
        <button onClick={() => openPanel("menu")} title="Back" className="rounded px-1 text-[19px] leading-none text-muted hover:text-foreground">‹</button>
        <span aria-hidden>{ICON[kind]}</span> {actionLabel(kind)}
      </span>
      <button onClick={() => openPanel("closed")} className="rounded px-1 text-muted hover:text-foreground">✕</button>
    </div>
  );

  const bodyBox = (placeholder: string) => (
    <textarea ref={bodyRef} rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder}
      className="w-full resize-none rounded-[9px] border bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent" />
  );

  const commitRow = (kind: TaskActionKind, label: string) => (
    <div className="mt-2.5 flex flex-wrap items-center gap-3">
      <button onClick={() => commit(kind)} className="rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90">{label}</button>
      {wantNext && (
        <button onClick={() => { setWantNext(false); setNextStep(""); setNextDue(null); setAiReason(""); }} className="text-[13px] text-muted underline underline-offset-[3px] hover:text-foreground">No next step needed</button>
      )}
    </div>
  );

  // Naming the person turns a generic verb into the actual thing you are
  // about to do (Derek: "make this email client name sms client name call
  // client name"). Falls back to the client, then to a bare verb, so a task
  // with no contact still reads as an instruction rather than a blank.
  const who = contact?.name ?? client?.name ?? "";
  const actionLabel = (k: TaskActionKind) => {
    if (!who) return TASK_ACTION_META[k].label;
    if (k === "chat") return `Chat ${who}`;
    if (k === "email") return `Email ${who}`;
    if (k === "sms") return `Text ${who}`;
    if (k === "call") return `Call ${who}`;
    if (k === "meeting") return `Book ${who}`;
    return TASK_ACTION_META[k].label;
  };

  const openStep = actions.find((a) => a.nextStep && !a.nextStepDoneAt) ?? null;
  const stepLate = openStep?.nextStepDue ? (daysUntilDue(openStep.nextStepDue) ?? 0) < 0 : false;

  // Absolute, not fixed: fixed positions against the viewport, so left-0 put
  // the dock's left edge under the app's own sidebar and clipped it. The
  // drawer is itself position:fixed, which makes it the containing block, so
  // absolute here means "the drawer's bottom-left".
  //
  // The right inset lives on this container rather than as a margin on the
  // inner box. As a margin it fought mx-auto and shoved the dock left instead
  // of centring it in the narrower space.
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 z-30 px-4 pb-4 sm:px-8 lg:px-12"
      style={{ right: "var(--dock-right, 0px)" }}>
      <div className="pointer-events-auto mx-auto w-full max-w-4xl rounded-[14px] border bg-surface/95 p-3 shadow-[0_12px_32px_rgba(20,24,40,.14),0_2px_6px_rgba(20,24,40,.08)] backdrop-blur-md">

        {view === "closed" && (
          <div className="flex flex-wrap items-center gap-3">
            {openStep ? (
              <>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${stepLate ? "text-danger" : "text-amber-700"}`}>
                    Next step{openStep.nextStepDue ? ` · ${stepLate ? `${Math.abs(daysUntilDue(openStep.nextStepDue) ?? 0)} days late` : formatDue(openStep.nextStepDue)}` : ""}
                  </span>
                  <span className="truncate text-[15px] font-semibold">{openStep.nextStep}</span>
                </span>
                <button onClick={() => onSetNextStepDone(openStep.id, true)}
                  className="rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-background">Mark done</button>
              </>
            ) : (
              // Was dead text saying nothing was scheduled, which is a fact
              // you can already see and can't act on. A note is the cheapest
              // useful thing to do to a task, so the empty state offers it
              // rather than reporting emptiness.
              <input value={quickNote} onChange={(e) => setQuickNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); postQuickNote(); } }}
                placeholder="Jot a quick note…"
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted hover:border-border focus:border-accent focus:bg-surface" />
            )}
            {/* One button, two jobs. Start typing a note and it becomes the
                way to post it, because a second button that only matters
                while you are typing would sit dead the rest of the time
                (Derek: "keep log action but if you type in then changes to
                quick note"). */}
            <button onClick={() => (quickNote.trim() ? postQuickNote() : openPanel("menu"))}
              className="ml-auto shrink-0 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90">
              {quickNote.trim() ? "Add note" : "＋ Log action"}
            </button>
          </div>
        )}

        {view === "menu" && (
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[15px] font-semibold">What are you doing?</span>
              <button onClick={() => openPanel("closed")} className="rounded px-1 text-muted hover:text-foreground">✕</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => openPanel("askTask")}
                className="inline-flex items-center gap-1.5 rounded-[5px] border border-dashed px-3 py-1.5 text-[14px] font-semibold text-muted hover:bg-background hover:text-foreground">
                <span aria-hidden>💡</span> Ask about this task
              </button>
              {TASK_ACTION_ORDER.map((k) => (
                <button key={k} onClick={() => openPanel(k)}
                  className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#b9cde3] bg-accent-soft px-3 py-1.5 text-[14px] font-semibold text-accent hover:bg-accent hover:text-white">
                  <span aria-hidden>{ICON[k]}</span> {actionLabel(k)}
                </button>
              ))}
            </div>
          </div>
        )}

        {view === "note" && (
          <div>
            {header("note")}
            <div className="mb-1.5 text-[13px] text-muted">Internal. The client never sees this.</div>
            {bodyBox("Note for the team…")}
            {wantNext ? nextStepPanel("note") : (
              <button onClick={() => setWantNext(true)} className="mt-2 text-[13px] text-accent underline underline-offset-[3px]">Add a next step</button>
            )}
            {commitRow("note", "Post note")}
          </div>
        )}

        {view === "team" && (
          <div>
            {header("team")}
            <div className="mb-1.5 text-[13px] text-muted">Goes to their chat with a link back to this task.</div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {users.filter((u) => u.id !== me?.id).map((u) => (
                <button key={u.id} onClick={() => setTeammate(u.id)}
                  className={`rounded-[5px] border px-2.5 py-1 text-[13px] ${teammate === u.id ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{u.name}</button>
              ))}
            </div>
            {bodyBox("What do you need from them?")}
            {wantNext ? nextStepPanel("team") : (
              <button onClick={() => setWantNext(true)} className="mt-2 text-[13px] text-accent underline underline-offset-[3px]">Add a next step</button>
            )}
            {commitRow("team", "Send")}
          </div>
        )}

        {(view === "chat" || view === "email" || view === "sms") && (
          <div>
            {header(view)}
            <div className="mb-1.5 text-[13px] text-muted">Sent{contact ? ` to ${contact.name}` : ""}. It is in the feed above.</div>
            {body && <div className="mb-2 line-clamp-2 rounded-[9px] border bg-background px-3 py-2 text-[14px] text-muted">{body}</div>}
            {nextStepPanel(view)}
            {commitRow(view, "Save next step")}
          </div>
        )}

        {view === "call" && (
          <div>
            {header("call")}
            <div className="flex flex-wrap items-center gap-3">
              {contact?.phone ? (
                <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-2 rounded-[9px] bg-success px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90">
                  ☎ Call {contact.name} · {contact.phone}
                </a>
              ) : <span className="text-[14px] text-muted">No phone number on this contact.</span>}
            </div>
            <div className="mt-2.5">{bodyBox("How did it go?")}</div>
            {nextStepPanel("call")}
            {commitRow("call", "Log the call")}
          </div>
        )}

        {view === "askTask" && (
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                <button onClick={() => openPanel("menu")} title="Back" className="rounded px-1 text-[19px] leading-none text-muted hover:text-foreground">‹</button>
                <span aria-hidden>💡</span> Ask about this task
              </span>
              <button onClick={() => { setThread([]); setView("closed"); }} className="rounded px-1 text-muted hover:text-foreground">✕</button>
            </div>
            {thread.length === 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {["What is this for?", "What are the specs?", "What did we agree?", "What is outstanding?"].map((q) => (
                  <button key={q} onClick={() => askTask(q)} disabled={asking}
                    className="rounded-[5px] border border-dashed px-2.5 py-1 text-[13px] text-muted hover:bg-background hover:text-foreground disabled:opacity-50">{q}</button>
                ))}
              </div>
            ) : (
              <div className="mb-2 max-h-64 space-y-2.5 overflow-y-auto pr-1">
                {thread.map((t, i) => (
                  <div key={i}>
                    <div className="text-[14px] font-semibold">{t.q}</div>
                    <div className="mt-0.5 whitespace-pre-wrap text-[15px]">{t.a}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input value={ask} onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); askTask(ask); } }}
                placeholder={asking ? "Reading the task…" : "Ask anything about this task…"} disabled={asking}
                className="min-w-0 flex-1 rounded-[9px] border bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent disabled:opacity-60" />
              <button onClick={() => askTask(ask)} disabled={asking || !ask.trim()}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-40">{asking ? "…" : "Ask"}</button>
            </div>
            {/* Nothing here is logged. A question you asked yourself is not a
                thing that happened to the task, and putting it in the feed
                would bury the things that did. */}
            <div className="mt-1.5 text-[13px] text-muted">Answers come from this task only, and aren&apos;t saved to it.</div>
          </div>
        )}

        {view === "met" && (
          <div>
            {header("met")}
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span>Paste the transcript or your notes. Only the record is kept.</span>
              <button onClick={summariseMeeting} disabled={summarising}
                className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[13px] hover:bg-background hover:text-foreground disabled:opacity-50">
                <I.bolt /> {summarising ? "Reading…" : "Summarise"}
              </button>
            </div>
            <textarea ref={bodyRef} rows={6} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={"Paste a meeting transcript, or write what was decided…"}
              className="w-full resize-y rounded-[9px] border bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent" />
            {nextStepPanel("met")}
            {commitRow("met", "Log the meeting")}
          </div>
        )}

        {view === "meeting" && (
          <div>
            {header("meeting")}
            <div className="mb-1.5 text-[13px] text-muted">Records the meeting and what it commits you to.</div>
            {bodyBox("When is it, and what is it for?")}
            {nextStepPanel("meeting")}
            {commitRow("meeting", "Log the meeting")}
          </div>
        )}
      </div>
    </div>
  );
}

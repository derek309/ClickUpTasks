"use client";

import { useEffect, useRef, useState } from "react";
import {
  Attachment, Contact, MessageChannel, Task, TaskAction, TaskActionKind, TaskStatus,
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
  note: "📝", team: "👥", chat: "🗨", email: "✉", sms: "💬", call: "☎", meeting: "📅",
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
  task, client, contact, actions, me, users, onLog, onSetNextStepDone, onPatch, onAddComment, onSendMessage, pushToast,
}: {
  task: Task;
  client: { name: string } | null;
  contact: Contact | null;
  actions: TaskAction[];
  me: User | null;
  users: User[];
  onLog: (a: TaskAction) => void;
  onSetNextStepDone: (id: string, done: boolean) => void;
  onPatch: (patch: Partial<Task>) => void;
  onAddComment: (body: string, attachments?: Attachment[]) => void;
  onSendMessage?: (channel: MessageChannel, subject: string, body: string) => void;
  pushToast: (msg: string) => void;
}) {
  const [view, setView] = useState<"closed" | "menu" | TaskActionKind>("closed");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [teammate, setTeammate] = useState<string | null>(null);
  const [nextStep, setNextStep] = useState("");
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [stage, setStage] = useState<TaskStatus | null>(null);
  // Explicit, rather than inferring "wanted" from the text being non-empty.
  // Setting nextStep to a space to force the panel open trimmed straight back
  // to empty, so the link did nothing.
  const [wantNext, setWantNext] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReason, setAiReason] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const open = view !== "closed" && view !== "menu";

  // Opening a panel clears it here, in the handler, rather than in an effect
  // watching `view`. A half-typed email must not leak into the next action
  // you take, and doing it on the event avoids a cascading render.
  const openPanel = (v: "closed" | "menu" | TaskActionKind) => {
    setView(v);
    setBody(""); setSubject(""); setNextStep(""); setNextDue(null); setStage(null); setAiReason("");
    setWantNext(v !== "closed" && v !== "menu" ? TASK_ACTION_META[v as TaskActionKind].needsNextStep : false);
    setTeammate(users.find((u) => u.id !== me?.id)?.id ?? null);
  };
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

  const commit = (kind: TaskActionKind) => {
    const text = body.trim();
    if (kind === "note" && !text) { pushToast("Write the note first."); return; }

    if (kind === "email" || kind === "sms" || kind === "chat") {
      if (!text) { pushToast("Write the message first."); return; }
      if (!onSendMessage) { pushToast("This client has no linked contact to message."); return; }
      onSendMessage(kind as MessageChannel, subject, text);
    }
    if (kind === "note") onAddComment(text);
    if (kind === "team" && teammate) {
      // Reuses the comment path so the existing @mention notification fires,
      // rather than inventing a second way to ping a teammate.
      const name = users.find((u) => u.id === teammate)?.name;
      onAddComment(name ? `@${name} ${text}` : text);
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
        <span aria-hidden>{ICON[kind]}</span> {TASK_ACTION_META[kind].label}
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

  const openStep = actions.find((a) => a.nextStep && !a.nextStepDoneAt) ?? null;
  const stepLate = openStep?.nextStepDue ? (daysUntilDue(openStep.nextStepDue) ?? 0) < 0 : false;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-4 sm:px-8 lg:px-12">
      <div className="pointer-events-auto mx-auto w-full max-w-4xl rounded-[14px] border bg-surface/95 p-3 shadow-[0_12px_32px_rgba(20,24,40,.14),0_2px_6px_rgba(20,24,40,.08)] backdrop-blur-md"
        style={{ marginRight: "var(--dock-right, 0px)" }}>

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
              <span className="text-[14px] text-muted">Nothing scheduled on this task.</span>
            )}
            <button onClick={() => openPanel("menu")} className="ml-auto rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90">＋ Log action</button>
          </div>
        )}

        {view === "menu" && (
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[15px] font-semibold">What are you doing?</span>
              <button onClick={() => openPanel("closed")} className="rounded px-1 text-muted hover:text-foreground">✕</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TASK_ACTION_ORDER.map((k) => (
                <button key={k} onClick={() => openPanel(k)}
                  className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#b9cde3] bg-accent-soft px-3 py-1.5 text-[14px] font-semibold text-accent hover:bg-accent hover:text-white">
                  <span aria-hidden>{ICON[k]}</span> {TASK_ACTION_META[k].label}
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
            <div className="mb-1.5 text-[13px] text-muted">Posts to the task and notifies them.</div>
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

        {(view === "email" || view === "sms" || view === "chat") && (
          <div>
            {header(view)}
            <div className="mb-1.5 text-[13px] text-muted">
              {contact ? <>To <b className="text-foreground">{contact.name}</b>{view === "email" && contact.email ? ` <${contact.email}>` : view === "sms" && contact.phone ? ` ${contact.phone}` : ""}</> : "No linked contact for this client."}
            </div>
            {view === "email" && (
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
                className="mb-1.5 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
            )}
            {bodyBox(view === "email" ? "Write the email…" : view === "sms" ? "Write the text…" : "Message the client…")}
            {nextStepPanel(view)}
            {commitRow(view, `Send & log`)}
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

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Attachment, Contact, Message, Task, TaskAction, TaskActionKind, TaskStatus, htmlToText,
  TASK_ACTION_META, TASK_ACTION_ORDER, CLIENT_FACING_ACTIONS, STATUS_META, pickableStatuses, linkSpans, prettyLinkName,
  User, addBusinessDaysIso, TODAY, formatDue, daysUntilDue, TaskSize, SIZE_META, SIZE_ORDER, sizeLabel, userById,
  Priority, PRIORITY_META, manualPriorityOptions, delegationTitle, type DelegateSpec, type ClientLink,
} from "@/lib/data";
import { I, newId, DateChip } from "./ui";
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

// One string, because the group's label is also how the code recognises it.
const GET_HELP = "Get help";
const ICON: Record<TaskActionKind, string> = {
  note: "📝", team: "👥", chat: "🗨", email: "✉", sms: "💬", call: "☎", met: "🗓", meeting: "📅", delegate: "🤝",
};

// Named offsets rather than a date picker for the common cases. Picking
// "in 3 days" off a calendar means counting squares; naming it does not.
function whenOptions(due: string | null): { label: string; date: string }[] {
  const opts = [
    { label: "Tomorrow", date: addBusinessDaysIso(TODAY, 1) },
    // Business days throughout: "check back in 3 days" from a Thursday landing
    // on a Sunday means two extra days of silence and a task that reads as
    // overdue by Monday.
    { label: "In 3 days", date: addBusinessDaysIso(TODAY, 3) },
    { label: "Next week", date: addBusinessDaysIso(TODAY, 5) },
    { label: "In 2 weeks", date: addBusinessDaysIso(TODAY, 10) },
  ];
  // Offering a check-back after the promised date is offering to be late on
  // purpose, so those options are dropped rather than shown and ignored.
  return due ? opts.filter((o) => o.date <= due) : opts;
}

export function ActionDock({
  task, client, contact, actions, messages, me, users, onLog, onSetNextStepDone, onPatch, onAddComment, onOpenCompose, canMessageClient = true, onSendDm, onDelegate, clientLinks = [], taskLink, askNextStepFor, onAskNextStepHandled, pushToast,
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
  /** May this person contact this client at all. False hides every outbound action. */
  canMessageClient?: boolean;
  // Set once a message has actually gone out. The dock reopens on it to ask
  // what happens next, so sending stops being a dead end.
  // A real DM, not an @mention comment on the task. The mention notified
  // correctly but the message lived on the task, so it never showed up in the
  // one place that teammate actually reads.
  onSendDm?: (userId: string, body: string) => void;
  /** Hands the task over: the checklist item, the dates, the sizing, the
   *  stage and the ping, all written by whoever owns the task list. */
  onDelegate?: (spec: DelegateSpec) => void;
  /** The client's saved links, offered one tap at a time when delegating. */
  clientLinks?: ClientLink[];
  taskLink?: () => string;
  askNextStepFor?: { kind: TaskActionKind; body: string } | null;
  onAskNextStepHandled?: () => void;
  pushToast: (msg: string) => void;
}) {
  const [view, setView] = useState<"closed" | "menu" | "askTask" | TaskActionKind>("closed");
  const [body, setBody] = useState("");
  const [teammate, setTeammate] = useState<string | null>(null);
  // Delegation's own fields. Their due is deliberately separate from the
  // follow-up date every other action sets: one is when they owe it, the
  // other is when it lands back on you, and collapsing them into one date
  // means one of the two people is planning off the wrong day.
  const [delegateTitle, setDelegateTitle] = useState("");
  const [theirDue, setTheirDue] = useState<string | null>(null);
  const [delegatePriority, setDelegatePriority] = useState<Priority | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  // The paste box is a chip until you want it. A permanently open input sat
  // in the row looking like a field you had to fill in.
  const [addingLink, setAddingLink] = useState(false);
  // The suggestion card is the default; "Change it" opens the fields. Editing
  // one field should not throw away the other three, so this is one flag over
  // the whole card rather than a mode per row.
  const [editingNext, setEditingNext] = useState(false);
  // Type to filter the menu. Nine choices is past the point where scanning
  // beats typing two letters, and the filter costs nothing when you would
  // rather click: an empty box is the full menu.
  const [menuQ, setMenuQ] = useState("");
  const [menuIdx, setMenuIdx] = useState(0);
  const menuInputRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState<TaskSize | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [nextStep, setNextStep] = useState("");
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [stage, setStage] = useState<TaskStatus | null>(null);
  // Explicit, rather than inferring "wanted" from the text being non-empty.
  // Setting nextStep to a space to force the panel open trimmed straight back
  // to empty, so the link did nothing.
  const taskRef = useRef(task);
  // Updated on commit, not during render: writing a ref while rendering is a
  // side effect in the render path. The reads that matter happen well after
  // commit anyway (a title fetch resolving hundreds of ms later).
  useEffect(() => { taskRef.current = task; }, [task]);
  const [quickNote, setQuickNote] = useState("");
  // A link written into a note is a link on the task, so it joins the
  // Attachments panel as well as staying in the note (Derek: a link added in
  // a log wasn't attached). Deduped on URL, so writing the same link twice,
  // or mentioning one that is already attached, adds nothing.
  //
  // Returns the patch rather than applying it, so a caller that is already
  // patching the task can fold it into one write instead of two.
  const attachmentsFrom = (text: string): Partial<Task> | null => {
    // Read through the ref: an attachment array built from a stale copy of
    // the task deletes anything added since it was captured.
    const current = taskRef.current.attachments;
    const have = new Set(current.map((a) => a.url).filter(Boolean));
    const found: Attachment[] = [];
    for (const { href } of linkSpans(text)) {
      if (have.has(href)) continue;
      have.add(href);
      found.push({ id: newId("at_"), name: prettyLinkName(href), kind: "link", size: "", url: href });
    }
    return found.length ? { attachments: [...current, ...found] } : null;
  };

  const postQuickNote = () => {
    const text = quickNote.trim();
    if (!text) return;
    // No companion comment. The action IS the note; writing both put the same
    // sentence in the feed twice, once as "Left a note" and once as a bare
    // comment underneath it.
    onLog({ id: newId("ta_"), taskId: task.id, kind: "note", authorId: me?.id ?? null,
      body: text, at: new Date().toISOString(), nextStep: null, nextStepDue: null, nextStepDoneAt: null });
    const links = attachmentsFrom(text);
    if (links) onPatch(links);
    setQuickNote("");
    pushToast(links ? "Note added · link attached" : "Note added");
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
    setMenuQ(""); setMenuIdx(0);
    // Seeded here too, not only on the reopen-after-send path. Opening the
    // dock from the menu left this null, so the card said "Unassigned" about
    // a task that has an owner.
    setSize(null); setAssignee(task.assigneeId ?? null); setEditingNext(false);
    setWantNext(v !== "closed" && v !== "menu" && v !== "askTask" ? TASK_ACTION_META[v as TaskActionKind].needsNextStep : false);
    // Whoever owns the task is who a question about it usually goes to, so
    // they start selected rather than whoever happens to sort first.
    setTeammate(task.assigneeId && task.assigneeId !== me?.id ? task.assigneeId : users.find((u) => u.id !== me?.id)?.id ?? null);
    // Delegating starts blank rather than inheriting the task's own dates:
    // the whole point is deciding when THEY owe it.
    setDelegateTitle("");
    setTheirDue(null); setDelegatePriority(task.priority === "none" ? "normal" : task.priority);
    setLinks([]); setLinkDraft(""); setAddingLink(false);
  };
  const openPanelRef = useRef(openPanel);
  useEffect(() => { openPanelRef.current = openPanel; });

  const suggest = (kind: TaskActionKind) => suggestFor(kind, body);
  const suggestFor = async (kind: TaskActionKind, note: string) => {
    setAiBusy(true);
    try {
      const res = await authedFetch("/api/ai/next-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title, description: task.description, clientName: client?.name ?? "",
          kind: TASK_ACTION_META[kind].verb, note, due: task.due, today: TODAY,
          status: task.status,
          // Only asked for when nobody has estimated it. An estimate someone
          // already made is theirs; overwriting it with a guess is worse than
          // having no guess at all.
          needsSize: !task.size && !task.sizeHours,
          history: actions.slice(0, 8).map((a) => `${a.at.slice(0, 10)} ${TASK_ACTION_META[a.kind].verb}: ${a.body.slice(0, 160)}`),
        }),
      });
      const j = await res.json();
      if (!res.ok) { pushToast(j?.error ?? "Couldn't get a suggestion."); return; }
      if (!j.nextStep) { pushToast("Nothing left to schedule, by the look of it."); return; }
      setNextStep(j.nextStep);
      setNextDue(j.followUpAt ?? null);
      if (j.status) setStage(j.status as TaskStatus);
      if (j.size) setSize(j.size as TaskSize);
      setAiReason(j.reason ?? "");
    } catch { pushToast("Couldn't reach the AI."); }
    finally { setAiBusy(false); }
  };
  // Reached through a ref by the auto-suggest effect below. useCallback would
  // have done the same job but the React compiler cannot preserve it here, and
  // a plain function in the dependency list re-runs the effect every render.
  const suggestRef = useRef(suggestFor);
  useEffect(() => { suggestRef.current = suggestFor; });

  // Reopens the dock straight into "what's next?" for a message that just
  // sent. Deferred a frame because it lands during the composer's own render.
  useEffect(() => {
    if (!askNextStepFor) return;
    const r = requestAnimationFrame(() => {
      setView(askNextStepFor.kind);
      setBody(askNextStepFor.body); setNextStep(""); setNextDue(null); setStage(null); setAiReason("");
      setSize(null); setAssignee(task.assigneeId ?? null); setEditingNext(false);
      setWantNext(true);
      onAskNextStepHandled?.();
      // Asked automatically rather than waiting for a Suggest click. The
      // moment a message goes out is exactly when the next step is knowable,
      // and it is also the moment someone is most likely to close the panel
      // and move on.
      void suggestRef.current(askNextStepFor.kind, askNextStepFor.body);
    });
    return () => cancelAnimationFrame(r);
    // task.assigneeId is deliberately out of the list: this effect seeds the
    // panel when it opens, and re-running it because someone reassigned the
    // task underneath would throw away what is typed in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askNextStepFor, onAskNextStepHandled]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => bodyRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [view, open]);

  // Read through a ref so the shortcut effect does not re-bind on every
  // render just because the group arrays are rebuilt each time.
  const menuOrderRef = useRef<TaskActionKind[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view !== "closed") { e.stopPropagation(); setView("closed"); return; }
      // Only on the menu itself, and never while something is being typed
      // into — a "3" in a note is a 3, not a shortcut.
      if (view !== "menu" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const list = menuOrderRef.current;
      if (e.key >= "1" && e.key <= String(Math.min(9, list.length))) {
        e.preventDefault();
        openPanelRef.current(list[Number(e.key) - 1]);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [view]);


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

  const commit = (kind: TaskActionKind, done = false) => {
    const text = body.trim();
    if (kind === "note" && !text) { pushToast("Write the note first."); return; }
    // There is always a next step until the work is marked done (Derek:
    // "there should always be a next until it's marked done"). A task with
    // nothing scheduled is how ninety-odd of them ended up with no date, so
    // saving without one is refused rather than quietly allowed.
    if (wantNext && !done && !nextStep.trim()) { pushToast("Say what happens next, or mark it done."); setEditingNext(true); return; }

    // Refused rather than logged. With nobody picked the branch below never
    // ran, so the message reached no one while the feed still said
    // "Messaged" — five of them are sitting in the log having gone nowhere.
    // A send with no addressee is not a send.
    if (kind === "team" && !teammate) { pushToast("Pick who this goes to."); return; }
    // Delegating writes real state, so it refuses to half happen: without a
    // person, an instruction and a date they owe it by, there is no handoff,
    // only a note that reads like one.
    if (kind === "delegate") {
      if (!teammate) { pushToast("Pick who you are handing it to."); return; }
      if (!text) { pushToast("Say what they need to do."); return; }
      if (!theirDue) { pushToast("Give them a date to have it by."); return; }
      if (!onDelegate) { pushToast("Delegating is not available here."); return; }
      onDelegate({
        toId: teammate, title: delegateTitle, instructions: text, theirDue, followUpAt: nextDue,
        size: size ?? task.size ?? null, priority: delegatePriority ?? task.priority, links,
      });
      onLog({
        id: newId("ta_"), taskId: task.id, kind, authorId: me?.id ?? null,
        toId: teammate, parentId: null,
        body: [text, ...links].filter(Boolean).join("\n"),
        at: new Date().toISOString(),
        // The next step is theirs, and so is its date: what you are waiting
        // on is them, not your own follow-up. Your follow-up is on the task.
        nextStep: `${userById(teammate)?.name ?? "They"} to finish this`,
        nextStepDue: theirDue,
        nextStepDoneAt: null,
      });
      // Their chat, with the task quoted, the same way a team message lands.
      if (onSendDm) {
        const link = taskLink?.();
        const ref = [`Re: ${task.title}${client?.name ? ` · ${client.name}` : ""}`, link].filter(Boolean).join("\n");
        onSendDm(teammate, [`Handing this to you, due ${formatDue(theirDue)}.`, text, ...links, ref].filter(Boolean).join("\n\n"));
      }
      pushToast(`Delegated to ${userById(teammate)?.name ?? "them"} · due ${formatDue(theirDue)}`);
      setView("closed");
      return;
    }
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

    // A sent message is already in the feed as a Message row carrying its own
    // body. Logging an action with that same body printed the whole email
    // twice, once on send and again when the next step was saved. The action
    // still gets logged, because the next step has to hang on something, but
    // it carries no body of its own.
    const sent = kind === "email" || kind === "sms" || kind === "chat";
    // A date on its own is a real commitment: "follow up in 3 days" says
    // everything even with the sentence left blank. Gating the date on the
    // text meant picking "In 3 days" and saving did nothing at all.
    const scheduled = !!nextStep.trim() || !!nextDue;
    // With nothing scheduled and nothing to say, a sent message needs no
    // action row: the Message row is the whole record.
    if (!sent || scheduled) {
      onLog({
        id: newId("ta_"), taskId: task.id, kind, authorId: me?.id ?? null,
        // The addressee, so the feed can say who it went to rather than
        // just that a message happened.
        toId: kind === "team" ? teammate : null, parentId: null,
        body: sent ? "" : text, at: new Date().toISOString(),
        nextStep: nextStep.trim() || null,
        nextStepDue: nextDue,
        nextStepDoneAt: null,
      });
    }

    // The next step's date IS the follow-up date. Two separate "when does
    // this come back" fields would drift apart within a week.
    const patch: Partial<Task> = { ...(attachmentsFrom(text) ?? {}) };
    if (nextDue) patch.followUpAt = nextDue;
    if (done) patch.status = "done";
    else if (stage && stage !== task.status) patch.status = stage;
    // Only ever written when nobody had estimated it. A size someone set by
    // hand stays theirs.
    if (size && !task.size && !task.sizeHours) patch.size = size;
    if (assignee !== null && assignee !== task.assigneeId) patch.assigneeId = assignee;
    if (Object.keys(patch).length) onPatch(patch);

    pushToast(done
      ? `${TASK_ACTION_META[kind].verb} · marked done`
      : `${TASK_ACTION_META[kind].verb}${nextDue ? ` · follow up ${formatDue(nextDue)}` : nextStep.trim() ? " · next step set" : ""}`);
    setView("closed");
  };

  // What's next, as one thing to agree with rather than four fields to fill.
  //
  // Claude reads the task and proposes the whole move: the step, the day you
  // pick it back up, the stage it now sits in, who owns it, and how long it
  // will take when nobody has said yet. The fast path is agreeing. "Change
  // it" opens every field at once, because editing one of them should not
  // throw away the other four.
  //
  // There is no "no next step needed" here on purpose (Derek: "there should
  // always be a next until it's marked done"). A task with nothing scheduled
  // is how ninety-odd tasks ended up with no date on them. The only way out
  // is saying the work is finished, which is a different claim and gets its
  // own button.
  const sizeIsSet = !!task.size || !!task.sizeHours || !!size;
  const shownSize = size ?? task.size ?? null;
  const assigneeName = assignee ? (userById(assignee)?.name ?? "Unassigned") : "Unassigned";

  const fieldRow = (label: string, children: React.ReactNode) => (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="w-[76px] shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );

  // A labelled block: the label on its own line above what it labels. The
  // dock's inline fieldRow works for one or two rows; seven of them wrapped
  // every label to two lines and left nothing to read down.
  const block = (label: React.ReactNode, children: React.ReactNode, spacing = "mb-2.5") => (
    <div className={spacing}>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
      {children}
    </div>
  );

  // The same four business-day offsets plus a picker, used by both dates in
  // the delegate panel. `after` keeps a follow-up from being offered before
  // the date they were given.
  const dateChips = (value: string | null, set: (d: string | null) => void, after: string | null) => {
    const opts = whenOptions(after);
    const custom = !!value && !opts.some((o) => o.date === value);
    return (
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o) => (
          <button key={o.label} onClick={() => set(o.date)} title={formatDue(o.date)}
            className={`rounded-md border px-2 py-1.5 text-[13px] ${value === o.date ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{o.label}</button>
        ))}
        <DateChip value={value} onChange={set} label={custom ? formatDue(value!) : "Pick"}
          className={`rounded-md border px-2 py-1.5 text-[13px] ${custom ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`} />
      </div>
    );
  };

  const nextStepPanel = (kind: TaskActionKind) => (
    <div className="mt-2.5 rounded-[10px] border bg-background p-3 shadow-[inset_0_2px_5px_rgba(20,24,40,.06)]">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[14px] font-bold">What&apos;s next?</span>
        {aiBusy && <span className="inline-flex items-center gap-1 text-[13px] text-accent"><I.bolt /> Claude is reading the task…</span>}
        {!aiBusy && !editingNext && (
          <button onClick={() => suggest(kind)} className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[13px] text-muted hover:bg-surface hover:text-foreground">
            <I.bolt /> Suggest again
          </button>
        )}
      </div>

      {/* The suggestion, whole. One thing to agree with. */}
      {!editingNext ? (
        <div className="rounded-[9px] border border-accent bg-surface p-3">
          <div className="text-[15px] font-medium leading-snug">{nextStep || (aiBusy ? "…" : "Say what you do next")}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
            <span>Follow up <b className="font-semibold text-foreground">{nextDue ? formatDue(nextDue) : "not set"}</b></span>
            <span aria-hidden>·</span>
            <span>Stage <b className="font-semibold text-foreground">{STATUS_META[stage ?? task.status].label}</b></span>
            <span aria-hidden>·</span>
            <span>Assigned to <b className="font-semibold text-foreground">{assigneeName}</b></span>
            {shownSize && (<><span aria-hidden>·</span><span>Takes <b className="font-semibold text-foreground">{sizeLabel({ size: shownSize })}</b></span></>)}
          </div>
          {aiReason && <div className="mt-1.5 text-[13px] text-muted">{aiReason}</div>}
          {/* Asked, not assumed. A task nobody has sized is counted at four
              hours in the plan, which is a number the plan invents rather
              than one anyone stands behind. */}
          {!sizeIsSet && !aiBusy && (
            <div className="mt-2 rounded-md border border-dashed px-2 py-1.5 text-[13px] text-muted">
              Nobody has said how long this takes. Pick one and the plan can place it.
            </div>
          )}
          <button onClick={() => setEditingNext(true)} className="mt-2 text-[13px] font-medium text-accent underline underline-offset-[3px]">Change it</button>
        </div>
      ) : (
        <>
          <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="What do you do next?"
            className="w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
          {aiReason && <div className="mt-1.5 text-[13px] text-muted">{aiReason}</div>}
          {fieldRow("Follow up", (
            <>
              {whenOptions(task.due).map((o) => (
                <button key={o.label} onClick={() => setNextDue(o.date)}
                  className={`rounded-md border px-2 py-1 text-[13px] ${nextDue === o.date ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}
                  title={formatDue(o.date)}>{o.label}</button>
              ))}
              <DateChip value={nextDue} onChange={setNextDue}
                label={nextDue && !whenOptions(task.due).some((o) => o.date === nextDue) ? formatDue(nextDue) : "Pick a date"}
                className={`rounded-md border px-2 py-1 text-[13px] ${nextDue && !whenOptions(task.due).some((o) => o.date === nextDue) ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`} />
            </>
          ))}
          {fieldRow("Stage", pickableStatuses(task.status).filter((st) => st !== "done").map((st) => (
            <button key={st} onClick={() => setStage(st)}
              className={`rounded-md border px-2 py-1 text-[13px] ${(stage ?? task.status) === st ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{STATUS_META[st].label}</button>
          )))}
          {fieldRow("Owner", (
            <select value={assignee ?? ""} onChange={(e) => setAssignee(e.target.value || null)}
              className="rounded-md border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent">
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          ))}
          {fieldRow("Takes", SIZE_ORDER.map((sz) => (
            <button key={sz} onClick={() => setSize(sz)} title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
              className={`rounded-md border px-2 py-1 text-[13px] ${shownSize === sz ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{SIZE_META[sz].label}</button>
          )))}
        </>
      )}
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

  // "Nothing to do next" is gone. The only way to leave a task with nothing
  // scheduled is to say the work is finished, which is a different claim and
  // gets its own button rather than hiding behind a dismissive link.
  const commitRow = (kind: TaskActionKind, label: string) => (
    <div className="mt-2.5 flex flex-wrap items-center gap-3">
      <button onClick={() => commit(kind)} className="rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90">{label}</button>
      {(wantNext || nextDue) && (
        <button onClick={() => commit(kind, true)} title="Nothing follows this, the task is finished"
          className="rounded-lg border px-3 py-2 text-[14px] font-medium text-muted hover:bg-background hover:text-foreground">This finishes it</button>
      )}
    </div>
  );

  // Naming the person turns a generic verb into the actual thing you are
  // about to do (Derek: "make this email client name sms client name call
  // client name"). Falls back to the client, then to a bare verb, so a task
  // with no contact still reads as an instruction rather than a blank.
  const who = contact?.name ?? client?.name ?? "";
  // Full label, for the panel header once you are inside an action: there the
  // name is the whole point, because it says who you are about to write to.
  const actionLabel = (k: TaskActionKind) => {
    if (!who) return TASK_ACTION_META[k].label;
    if (k === "chat") return `Chat ${who}`;
    if (k === "email") return `Email ${who}`;
    if (k === "sms") return `Text ${who}`;
    if (k === "call") return `Call ${who}`;
    if (k === "meeting") return `Book ${who}`;
    return TASK_ACTION_META[k].label;
  };
  // Bare verb, for the menu: the name is said once in the group heading above
  // these, so printing it on five buttons only made them wider.
  const MENU_LABEL: Partial<Record<TaskActionKind, string>> = {
    chat: "Chat", email: "Email", sms: "Text", call: "Call",
    // Same word, opposite ends of time. One already happened and one has not,
    // and only one of them needs a slot picked.
    met: "Log a meeting", meeting: "Book a meeting",
  };
  const menuLabel = (k: TaskActionKind) => MENU_LABEL[k] ?? TASK_ACTION_META[k].label;

  // Grouped by who it reaches, because that is the question you answer before
  // picking anything: does this stay inside the team, or does it go to the
  // client. Nine buttons in one undifferentiated wrap made a note to yourself
  // and a text to a client read as the same kind of thing.
  // Split off CLIENT_FACING_ACTIONS rather than written out again, so the
  // permission rule that hides client contact from a VA lives in exactly one
  // place. A second hardcoded list is a rule that drifts.
  // Delegate is not a record of something that happened, so it sits with Ask
  // AI under Get help: both are the same move, getting the work off your own
  // hands. One is a person, one is not.
  const INTERNAL_ACTIONS = TASK_ACTION_ORDER.filter((k) => !CLIENT_FACING_ACTIONS.has(k) && k !== "delegate");
  const CLIENT_ACTIONS = TASK_ACTION_ORDER.filter((k) => CLIENT_FACING_ACTIONS.has(k));
  const menuGroups: { label: string; kinds: TaskActionKind[] }[] = [
    { label: "Just record it", kinds: INTERNAL_ACTIONS },
    { label: who ? `Reach ${who}` : "Reach the client", kinds: canMessageClient ? CLIENT_ACTIONS : [] },
    // Nobody to hand it to means no point offering it.
    { label: GET_HELP, kinds: users.some((u) => u.id !== me?.id) ? ["delegate"] : [] },
  ];
  // Numbered in the order they are drawn, so the digit on screen is the digit
  // you press. Nine choices is a lot to hunt through when you use the same
  // three every day.
  const menuOrder: TaskActionKind[] = menuGroups.flatMap((g) => g.kinds);
  // "ask" rides in the same match list as the actions, so typing "as" and
  // pressing Enter reaches it like everything else rather than it being the
  // one item the keyboard cannot get to.
  const menuQl = menuQ.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(menuQl);
  // Declared before shownGroups, which reads it. It used to sit below, and
  // the only reason that ever worked is that the filter short-circuits: with
  // any entry in the Get help group, askShown is never evaluated. A VA whose
  // roster holds nobody else has no Delegate entry, so the group is empty,
  // the filter falls through to askShown in its temporal dead zone, and
  // "Cannot access 'askShown' before initialization" took the whole app down
  // on every task. Michaella lost an afternoon to it.
  const askShown = !menuQl || matches("ask ai");
  const shownGroups = menuGroups
    .map((g) => ({ ...g, kinds: g.kinds.filter((k) => !menuQl || matches(menuLabel(k)) || matches(TASK_ACTION_META[k].label)) }))
    // Get help still draws when the filter kills Delegate but not Ask AI.
    .filter((g) => g.kinds.length > 0 || (g.label === GET_HELP && askShown));
  // Flat, in draw order: what ↑/↓ walks and what Enter opens. Ask AI is drawn
  // first inside the Get help group, so it takes that group's place here
  // rather than trailing the whole menu.
  const menuHits: (TaskActionKind | "ask")[] = shownGroups.flatMap((g) =>
    g.label === GET_HELP ? [...(askShown ? ["ask" as const] : []), ...g.kinds] : g.kinds);
  const openHit = (h: TaskActionKind | "ask") => openPanel(h === "ask" ? "askTask" : h);

  // Kept current in an effect rather than during render, so the shortcut
  // handler always sees what is actually drawn without the effect re-binding
  // on every render.
  useEffect(() => { menuOrderRef.current = menuOrder; });

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
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 text-[15px] font-semibold">What are you doing?</span>
              {/* Filter, not search: it narrows the same menu in place rather
                  than replacing it with a list of results, so the grouping
                  and the number keys survive typing. */}
              <input ref={menuInputRef} autoFocus value={menuQ}
                onChange={(e) => { setMenuQ(e.target.value); setMenuIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMenuIdx((i) => Math.min(i + 1, menuHits.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMenuIdx((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === "Enter") { e.preventDefault(); if (menuHits[menuIdx]) openHit(menuHits[menuIdx]); return; }
                  // Digits are shortcuts only while the box is empty. Once you
                  // are typing, a number is a number — and nothing in this
                  // menu starts with one, so nothing is lost.
                  if (!menuQ && e.key >= "1" && e.key <= "9") {
                    const k = menuOrder[Number(e.key) - 1];
                    if (k) { e.preventDefault(); openPanel(k); }
                  }
                }}
                placeholder="or type to filter…"
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-[14px] outline-none focus:border-accent" />
              <button onClick={() => openPanel("closed")} className="shrink-0 rounded px-1 text-muted hover:text-foreground">✕</button>
            </div>
            {shownGroups.map((g) => (
              <div key={g.label} className="mb-2.5">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">{g.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {/* Not the one pale item in the row: dashed grey read as
                      unavailable rather than as the AI one. */}
                  {g.label === GET_HELP && askShown && (
                    <button onClick={() => openPanel("askTask")} onMouseEnter={() => setMenuIdx(menuHits.indexOf("ask"))}
                      className={`inline-flex items-center gap-1.5 rounded-[7px] border border-accent px-3 py-1.5 text-[15px] font-semibold hover:bg-accent hover:text-white ${menuHits[menuIdx] === "ask" ? "bg-accent text-white" : "text-accent"}`}>
                      <span aria-hidden className="w-[17px] text-center">✦</span> Ask AI
                    </button>
                  )}
                  {g.kinds.map((k) => (
                    <button key={k} onClick={() => openPanel(k)} onMouseEnter={() => setMenuIdx(menuHits.indexOf(k))}
                      className={`inline-flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[15px] hover:border-accent hover:bg-accent-soft ${menuHits[menuIdx] === k ? "border-accent bg-accent-soft" : "bg-surface"}`}>
                      <span aria-hidden className="w-[17px] text-center opacity-80">{ICON[k]}</span> {menuLabel(k)}
                      {/* The digit is only true while the box is empty, so it
                          stops claiming to be a shortcut once it is not. */}
                      {!menuQ && <span aria-hidden className="rounded border px-1 text-[11px] leading-4 text-muted">{menuOrder.indexOf(k) + 1}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {menuHits.length === 0 && (
              <div className="text-[14px] text-muted">Nothing matches “{menuQ.trim()}”.</div>
            )}
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
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
              To{!teammate && <span className="ml-1 font-medium normal-case tracking-normal text-danger">pick someone</span>}
            </div>
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
            {body && <div className="mb-2 max-h-16 overflow-hidden rounded-[9px] border bg-background px-3 py-2 text-[13px] leading-snug text-muted">{body.split("\n").slice(0, 2).join(" ").slice(0, 160)}…</div>}
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

        {view === "delegate" && (
          <div>
            {header("delegate")}
            <div className="mb-2.5 text-[13px] text-muted">They get the task on their list and a message. It stays yours.</div>

            {/* Stacked labels, not the dock's inline 76px column: with seven
                fields the inline labels wrapped to two lines each and the
                rows ran together (Derek: "it's too messy, smashed
                together"). A label above its own row reads as a form. */}
            {block(<>To{!teammate && <span className="ml-1 font-medium normal-case tracking-normal text-danger">pick someone</span>}</>, (
              <div className="flex flex-wrap gap-1.5">
                {users.filter((u) => u.id !== me?.id).map((u) => (
                  <button key={u.id} onClick={() => setTeammate(u.id)}
                    className={`rounded-md border px-2.5 py-1.5 text-[13px] ${teammate === u.id ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{u.name}</button>
                ))}
              </div>
            ))}

            {/* Named, not derived. The generated name is a decent guess at
                what to call a brief, and a guess is a poor thing to read on
                a row every day (Derek: "add delegation title"). Left blank it
                still falls back to the guess. */}
            {block("Call it", (
              <input value={delegateTitle} onChange={(e) => setDelegateTitle(e.target.value)}
                placeholder={body.trim() ? delegationTitle(body) : "Name this handoff"}
                className="w-full rounded-[9px] border bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent" />
            ))}

            {block("What they need to do", bodyBox("Everything they need to know to do it."))}

            {block("Links they will need", (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  {links.map((l) => (
                    <button key={l} onClick={() => setLinks((ls) => ls.filter((x) => x !== l))} title={l}
                      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-[13px] font-medium text-accent">
                      <span className="truncate">🔗 {prettyLinkName(l)}</span> <span aria-hidden className="text-muted">×</span>
                    </button>
                  ))}
                  {addingLink ? (
                    <input autoFocus value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)}
                      onBlur={() => { if (!linkDraft.trim()) setAddingLink(false); }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { setLinkDraft(""); setAddingLink(false); return; }
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const v = linkDraft.trim();
                        if (v && !links.includes(v)) setLinks((ls) => [...ls, v]);
                        setLinkDraft(""); setAddingLink(false);
                      }}
                      placeholder="Paste a link, then Enter"
                      className="min-w-[200px] flex-1 rounded-md border bg-surface px-2.5 py-1 text-[13px] outline-none focus:border-accent" />
                  ) : (
                    <button onClick={() => setAddingLink(true)}
                      className="rounded-md border border-dashed px-2 py-1 text-[13px] font-medium text-muted hover:border-accent hover:text-accent">＋ Paste a link</button>
                  )}
                </div>
                {/* One tap beats retyping a URL that is already saved, which
                    is the reason nobody attaches them. */}
                {clientLinks.some((l) => !links.includes(l.url)) && (
                  <div className="mt-2 rounded-[10px] border bg-background px-2.5 py-2">
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">From this client, one tap to add</div>
                    <div className="flex flex-wrap gap-1.5">
                      {clientLinks.filter((l) => !links.includes(l.url)).map((l) => (
                        <button key={l.url} onClick={() => setLinks((ls) => [...ls, l.url])} title={l.url}
                          className="max-w-[220px] truncate rounded-md border bg-surface px-2 py-1 text-[13px] font-medium text-accent hover:border-accent hover:bg-accent-soft">🔗 {l.label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ))}

            {/* The two dates side by side, because the whole point is that
                they are different dates doing different jobs. */}
            <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
              {block(<>They owe it{!theirDue && <span className="ml-1 font-medium normal-case tracking-normal text-danger">pick a date</span>}</>,
                dateChips(theirDue, setTheirDue, null), "mb-0")}
              {block("You follow up", dateChips(nextDue, setNextDue, theirDue), "mb-0")}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
              {block("Takes", (
                <div className="flex flex-wrap gap-1.5">
                  {SIZE_ORDER.map((sz) => (
                    <button key={sz} onClick={() => setSize(sz)} title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
                      className={`rounded-md border px-2 py-1.5 text-[13px] ${shownSize === sz ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{SIZE_META[sz].label}</button>
                  ))}
                </div>
              ), "mb-0")}
              {block("Priority", (
                <div className="flex flex-wrap gap-1.5">
                  {manualPriorityOptions(delegatePriority ?? task.priority).map((pr) => (
                    <button key={pr} onClick={() => setDelegatePriority(pr)}
                      className={`rounded-md border px-2 py-1.5 text-[13px] ${(delegatePriority ?? task.priority) === pr ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{PRIORITY_META[pr].label}</button>
                  ))}
                </div>
              ), "mb-0")}
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-3 border-t pt-3">
              <button onClick={() => commit("delegate")} className="rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white hover:opacity-90">Delegate</button>
              <span className="text-[13px] text-muted">Moves the task to the Delegated stage.</span>
            </div>
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

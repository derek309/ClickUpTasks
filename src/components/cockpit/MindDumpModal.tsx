"use client";

// Dump what is in your head, let AI split it into tasks, review and create
// the lot (Derek, 2026-09-04: "we can just mind dump into it, and then it
// will create the task for us").
//
// Two ways in, because a dump is sometimes one thing and sometimes twenty
// (Derek, 2026-09-09: "sometimes we have to just add a task quickly, other
// times we want to add a list of tasks"):
//  - Quick add — a grammar pass, one task, created immediately. No review
//    screen, because there's only one thing to look at and it's already on
//    screen in the textarea.
//  - Split into tasks — the AI reads the whole dump for every distinct
//    action item, and its output is never written straight to the database:
//    it lands in an editable list first, with every row individually
//    droppable, because a parse that quietly invents or merges an action
//    item is worse than no parse at all when it's already a real task by the
//    time you notice.
//
// Three things this owes the person using it:
//  1. Room. It fills the screen rather than sitting in a small box, because
//     the whole point is pasting a wall of notes into it (Derek: "make sure
//     the pop-up box uses a lot of space on the screen").
//  2. Answered dates. Due and follow-up arrive already set, so the fast path
//     is dump then click. The chips are only there for when the default is
//     wrong.
//  3. A visible guardrail. Wording a client asked for exactly is shown as its
//     own locked block and is never what the AI rewrote — see `verbatim` in
//     api/ai/parse-tasks.
import { useEffect, useRef, useState } from "react";
import {
  users, PRIORITY_META, manualPriorityOptions, formatDue, TODAY, addBusinessDaysIso, dateQuickPicks,
  SIZE_META, SIZE_ORDER, SIZING_ON, userById, type Priority, type TaskSize,
} from "@/lib/data";
import { verbatimTaskRow, linesToRows, applyDumpDefaults, type TaskRow, type StepOneSetup } from "@/lib/quickAddRow";
import { rankTeammates, whoChoices } from "@/lib/stepSetup";
import { suggestStepActions } from "@/lib/stepSuggest";
import { defaultQueueAt, previewPlace, queueAtWords, deadlineWords, type QueueAt } from "@/lib/newTaskQueue";
import type { QTask, QueueSettings } from "../../../mcp/queue.mjs";
import { I, DateChip, SearchableSelect } from "./ui";
import { useEscapeToClose } from "./useEscapeToClose";
import { StepSetup, addRowsOf, type SetupAction, type SetupAnswer } from "./StepSetup";
import { InlineAssignee } from "./GroupedList";

/** A row on its way to a task. Lives in lib/quickAddRow so the two no-AI
 *  paths can build one without importing a React component; re-exported here
 *  because every caller already knows it by this name. The `verbatim` field is
 *  the client's own words, held apart from description so it can be shown
 *  locked and written in as a blockquote rather than blended into AI prose. */
export type ParsedRow = TaskRow;

// A dump with no date in it still has to land somewhere real. Three business
// days out to do it, and the follow-up is TODAY: whatever you just dumped is
// what you are thinking about right now, so it belongs in today's list rather
// than waiting a day to resurface (Derek, 2026-09-04: "default do in 3 days
// and follow up today").
export const DEFAULT_DUE = () => addBusinessDaysIso(TODAY, 3);

// A word in the sentence that is a picker, like the task page's.
// A small text action beside the one dark button.
const LINK = "inline-flex min-h-10 items-center text-[16px] font-medium text-accent underline decoration-dotted underline-offset-4 hover:text-foreground disabled:opacity-40";
const WORD = "cursor-pointer appearance-none [field-sizing:content] bg-transparent font-semibold text-foreground underline decoration-dotted underline-offset-4 outline-none hover:text-accent";

/** A date in the sentence: the quick picks by name, or any date. */
function DayWord({ value, onChange, label }: { value: string | null; onChange: (d: string | null) => void; label: string }) {
  const pick = useRef<HTMLInputElement | null>(null);
  const picks = dateQuickPicks();
  const named = picks.find((p) => p.date === value);
  return (
    <span className="relative inline-block">
      <select aria-label={label} value={value ?? ""} className={`${WORD} text-accent`}
        onChange={(e) => {
          if (e.target.value === "__pick") { const el = pick.current; if (el) { try { el.showPicker(); } catch { el.click(); } } return; }
          onChange(e.target.value || null);
        }}>
        {value && !named && <option value={value}>{formatDue(value)}</option>}
        {picks.map((p) => <option key={p.label} value={p.date}>{p.label.toLowerCase()} ({formatDue(p.date)})</option>)}
        <option value="">not set</option>
        <option value="__pick">pick a date…</option>
      </select>
      <input ref={pick} type="date" tabIndex={-1} aria-hidden value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0" />
    </span>
  );
}
// Due in three business days, checked on tomorrow (Derek, 2026-10-13: "if it's
// due in 3 days, make the follow up tomorrow"), the next business day.
export const DEFAULT_FOLLOW_UP = () => addBusinessDaysIso(TODAY, 1);

type PastedFile = { file: File; url: string; row: number };

export function MindDumpModal({ clientName, listName, destinationHint, suggestedDue, busy, needsClient, clients, companyFor, defaultClientId, onPickClient, onParse, onAiAdd, onCreate, onCancel, meId = null, clientFirst = null, canMessage = false, hasPhone = false, queue = null, personal = false }: {
  clientName: string;
  /** Whoever is creating it: step 1's turn starts as theirs. */
  meId?: string | null;
  /** The client's first name, as the steps say it; null with no client
   *  (your own list, a list in Projects). */
  clientFirst?: string | null;
  /** Your own Personal list: it is yours, so no owner and no Whose turn. */
  personal?: boolean;
  /** The client can be emailed and chatted with from the app. */
  canMessage?: boolean;
  hasPhone?: boolean;
  /** The list it lands on is a queue (mcp/queue.mjs): its settings and tasks. */
  queue?: { settings: QueueSettings; tasks: QTask[] } | null;
  listName: string;
  /** True when the composer was opened with no client on screen (the header on
   *  Tasks). Nothing can be created until one is picked. */
  needsClient?: boolean;
  clients?: { id: string; name: string }[];
  companyFor?: (id: string) => string | undefined;
  defaultClientId?: string | null;
  onPickClient?: (id: string) => void;
  // Named so the header can say where these land without this component
  // knowing anything about groups, clients or lists.
  destinationHint?: string;
  // The bucket you opened it from wins over the three day default: clicking
  // the plus on "Tomorrow" and getting a task due Tuesday reads as a bug.
  // Null when the group has no date of its own.
  suggestedDue: string | null;
  busy: boolean;
  onParse: (text: string) => Promise<ParsedRow[] | null>;
  // Ask AI: hands back one already-cleaned row and nothing else — the modal
  // builds it into a full task with the current defaults and creates it right
  // away, skipping the review screen entirely.
  onAiAdd: (text: string) => Promise<ParsedRow | null>;
  onCreate: (rows: ParsedRow[], files: { file: File; row: number }[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [files, setFiles] = useState<PastedFile[]>([]);
  // The defaults for the whole dump. Every task the AI finds starts on these
  // and can be moved individually on the review step.
  const [due, setDue] = useState<string | null>(suggestedDue ?? DEFAULT_DUE());
  const [followUpAt, setFollowUpAt] = useState<string | null>(DEFAULT_FOLLOW_UP());
  const [owner, setOwner] = useState<string | null>(null); // null = whoever is creating
  const [priority, setPriority] = useState<Priority>("normal");
  // A priority only sticks once it has actually been chosen: until then the
  // value in the box is just the default, and the task keeps the automatic,
  // date derived priority every other task in the app has.
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [size, setSize] = useState<TaskSize | null>(null);
  // Step 1 set up in the box (Derek, 2026-10-14): whose turn (you to start
  // with), by when, and the action, the same rows as everywhere (StepSetup).
  // A teammate's or Claude's turn is the handoff "Give step 1 to" made.
  const [stepWho, setStepWho] = useState<string | null>(meId);
  const [stepWhen, setStepWhen] = useState<string>(() => addBusinessDaysIso(TODAY, 1));
  const [whenSet, setWhenSet] = useState(false);
  // A queue list: where in the line, null while it follows the priority, and
  // the one date it can carry, a deadline.
  const [queueAt, setQueueAt] = useState<QueueAt | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const deadlinePick = useRef<HTMLInputElement | null>(null);
  const [clientId, setClientId] = useState<string>(defaultClientId ?? "");
  const dumpRef = useRef<HTMLTextAreaElement | null>(null);
  // Which button is waiting on its request — busy alone can't tell the two
  // apart since both routes through the same in-flight flag one level up.
  const [pending, setPending] = useState<"quick" | "split" | null>(null);
  // The split failed (the AI was slow or down): say so beside the buttons,
  // with a way to keep the text as one task, so nothing typed is stuck
  // (Derek, 2026-10-07).
  const [splitFailed, setSplitFailed] = useState(false);

  useEscapeToClose(onCancel);

  // Object URLs are per-file and live as long as the modal does; revoking on
  // unmount rather than per render keeps the thumbnails from going blank
  // between the two stages.
  useEffect(() => () => { files.forEach((f) => URL.revokeObjectURL(f.url)); }, [files]);

  // Paste an image straight in. Clipboard files arrive alongside the text, so
  // this only adds them and lets the textarea handle the words itself.
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) return;
    setFiles((fs) => [...fs, ...pasted.map((file) => ({ file, url: URL.createObjectURL(file), row: 0 }))]);
  };
  const onDrop = (e: React.DragEvent) => {
    const dropped = Array.from(e.dataTransfer.files);
    if (!dropped.length) return;
    e.preventDefault();
    setFiles((fs) => [...fs, ...dropped.map((file) => ({ file, url: URL.createObjectURL(file), row: 0 }))]);
  };

  // The defaults every row is finished with, wherever it came from.
  const placeAt: QueueAt = queueAt ?? defaultQueueAt(priority);
  // Step 1's date waits for Now on a queue list, unless it is placed now.
  const askWhen = !queue || placeAt === "now";
  const defaults = (step?: { who: string | null; when: string; action: string | null }) => {
    const who = step ? step.who : stepWho;
    const member = who && who !== meId && who !== "client" ? who : null;
    const step1: StepOneSetup = { who: who === meId ? null : who, when: askWhen ? (step?.when ?? stepWhen) : null, whenSet: askWhen && (whenSet || (!!step && step.when !== stepWhen)), action: step?.action ?? null };
    // A queue list has no due or follow up: the line dates it, or its deadline.
    return queue
      ? { due: deadline, followUpAt: null, assignee: owner, priority, priorityTouched, size, delegateTo: member, step1, queueAt, deadline: !!deadline }
      : { due, followUpAt, assignee: owner, priority, priorityTouched, size, delegateTo: member, step1 };
  };
  const attachAll = () => files.map((f) => ({ file: f.file, row: 0 }));
  const blocked = !text.trim() || busy || (needsClient && !clientId);

  // Add: no network, no model, no rewrite. The whole reason this exists
  // (Derek, 2026-09-28: "just created without changing the name"). An action
  // picked in step 1's rows adds it the same way, with step 1 holding it.
  const addAsTyped = (step?: { who: string | null; when: string; action: string | null }) => {
    if (blocked) return;
    // Several lines are the whole request: it all goes to step 1's directions
    // with a short name (lib/tidyTitle), not split into a name and a
    // description (Derek, 2026-10-13).
    const row = text.trim().includes("\n") ? { ...verbatimTaskRow(text), title: text.trim(), description: "" } : verbatimTaskRow(text);
    onCreate(applyDumpDefaults([row], defaults(step)), attachAll());
  };

  // One per line: the same promise, for a list that is already a list. No AI,
  // but it still goes through the review step, because a paste can carry lines
  // nobody meant as tasks.
  const splitByLine = () => {
    if (blocked) return;
    const made = linesToRows(text);
    if (!made.length) return;
    setRows(applyDumpDefaults(made, defaults()));
  };

  const read = async () => {
    setPending("split");
    setSplitFailed(false);
    const parsed = await onParse(text);
    setPending(null);
    if (!parsed) { setSplitFailed(true); return; }
    // The AI answers what is in the text. Everything it was not asked to
    // guess at (follow-up, size) and everything the defaults already answer
    // is filled in here, so no row arrives half made.
    // The chosen defaults are what every task starts on. The AI only moves
    // priority when the text actually said so (its prompt reserves "urgent"
    // for wording like urgent or ASAP), so a whole dump does not come back
    // flagged just because the model felt strongly about it.
    setRows(applyDumpDefaults(parsed, defaults()));
  };

  // Same default fill as `read`, just for the one row and skipping straight
  // to onCreate — quick add's whole point is that nothing stands between
  // typing and a task existing.
  const aiAdd = async () => {
    setPending("quick");
    const r = await onAiAdd(text);
    setPending(null);
    if (!r) return;
    onCreate(applyDumpDefaults([r], defaults()), attachAll());
  };

  // Enter is the fast path, and only while the text is one line: pasting
  // twenty lines and hitting Enter should not quietly make one task of the
  // lot. Shift and Enter is always a new line.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (text.includes("\n")) return;
    e.preventDefault();
    addAsTyped();
  };

  // The business name rides along as `sub` so it is both visible and
  // searchable: two clients can share a first name, the company never does.
  const clientOptions = [...(clients ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name, sub: companyFor?.(c.id) }));

  const patch = (i: number, p: Partial<ParsedRow>) => setRows((rs) => rs?.map((r, n) => (n === i ? { ...r, ...p } : r)) ?? rs);
  const kept = rows?.filter((r) => r.keep && r.title.trim()) ?? [];

  // Files follow their row through the untick: a file parked on a row nobody
  // is creating would otherwise vanish silently.
  const create = () => {
    const keepIdx = new Map<number, number>();
    rows?.forEach((r, i) => { if (r.keep && r.title.trim()) keepIdx.set(i, keepIdx.size); });
    const mapped = files
      .filter((f) => keepIdx.has(f.row))
      .map((f) => ({ file: f.file, row: keepIdx.get(f.row)! }));
    onCreate(kept, mapped);
  };

  // One shared list of named dates (see DATE_QUICK_PICKS in lib/data) so the
  // dump, the list view and the action dock all offer the same days.
  const dayChips = (value: string | null, set: (d: string | null) => void) => {
    const picks = dateQuickPicks();
    const named = picks.some((p) => p.date === value);
    return (
      <>
        {picks.map(({ label, date }) => (
          <button key={label} onClick={() => set(value === date ? null : date)} title={formatDue(date)}
            className={`rounded-md border px-2.5 py-1 text-[14px] ${value === date ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`}>{label}</button>
        ))}
        <DateChip value={value} onChange={set}
          label={value && !named ? formatDue(value) : "Pick a date"}
          className={`rounded-md border px-2.5 py-1 text-[14px] ${value && !named ? "border-accent bg-accent text-white" : "bg-surface text-muted hover:bg-background"}`} />
      </>
    );
  };

  const fieldLabel = (t: string) => <span className="w-[80px] shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted">{t}</span>;

  // Where each choice would put it in the line, for the picker's words:
  // "next up (2nd)", "at the bottom (9th)".
  const placeWords: Record<QueueAt, number | null> = { now: null, next: null, bottom: null };
  if (queue) {
    const draft: QTask = { id: "new-task", title: text, status: "todo", due: deadline, deadline: !!deadline, queuePos: null, createdAt: "9999", priority, assigneeId: meId, subtasks: [] };
    for (const at of ["next", "bottom"] as const) placeWords[at] = previewPlace(queue.tasks, queue.settings, draft, queueAt === null && at === defaultQueueAt(priority) ? null : at, TODAY).place;
  }
  const openDeadline = () => { const el = deadlinePick.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } };

  // Step 1's rows: Whose turn as everywhere (You, two teammates most picked,
  // Claude, the client; TaskDrawer setupOf), then what the action is.
  const firstOf = (id: string) => userById(id)?.name.split(" ")[0] ?? "Someone";
  let picks: Record<string, number> = {};
  try { picks = JSON.parse(localStorage.getItem("cut.setup.whoPicks") ?? "{}"); } catch { /* none kept */ }
  const whoRaw = whoChoices(meId, rankTeammates(users.map((u) => u.id), picks, meId), canMessage && !!clientFirst);
  const first = clientFirst ?? "them";
  const whoList = whoRaw.map((c) => ({ key: c.key, label: c.kind === "me" ? "You" : c.kind === "claude" ? "Claude" : c.kind === "client" ? (whoRaw.some((o) => o.kind === "teammate" && firstOf(o.key).toLowerCase() === first.toLowerCase()) ? `${first} (client)` : first) : c.kind === "else" ? "Someone else" : firstOf(c.key) }));
  // Which action a tap picked: the set up hands back the action's own run,
  // and each run is known by its key.
  const keyOf = new Map<() => void, string>();
  const act = (key: string, label: string, show = true): SetupAction[] => {
    if (!show) return [];
    const run = () => {};
    keyOf.set(run, key);
    return [{ key, label, onPick: run }];
  };
  const options: SetupAction[] = [
    ...act("directions", "Directions"), ...act("checklist", "To dos"),
    ...act("email", `Email ${first}`, canMessage), ...act("text", `Text ${first}`, canMessage && hasPhone), ...act("chat", "Chat in the portal", canMessage),
    ...(!personal ? [...act("doc", "Document"), ...act("image", "Image"), ...act("page", "HTML review"), ...act("video", "Video")] : []),
  ];
  const lead = suggestStepActions(text, first).flatMap((x) => { const o = options.find((y) => y.key === x.kind); return o ? [{ ...o, label: x.label }] : []; });
  const grouped = addRowsOf(options, first, new Set(lead.map((x) => x.key)));

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onCancel} />
      {/* Sized to what is in it, capped at the window. Five lines when it
          opens, growing as you type until it has used the screen, and only
          then scrolling (Derek: "make the box grow to use the full window
          space and only scroll after it's hit the max"). Height is never
          forced: no flex-1 anywhere on this column, because a basis-0 child
          contributes nothing to an auto height and the panel would snap back
          to full screen. */}
      <div className="fixed inset-x-3 top-3 z-50 mx-auto flex max-h-[calc(100vh-1.5rem)] max-w-[1180px] flex-col rounded-2xl border bg-surface shadow-xl sm:inset-x-8 sm:top-1/2 sm:max-h-[calc(100vh-3rem)] sm:-translate-y-1/2">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold">{rows === null ? "What needs doing?" : `${rows.length} task${rows.length === 1 ? "" : "s"} found`}</h2>
            <p className="mt-0.5 truncate text-[14px] text-muted">
              {rows === null
                ? `${destinationHint ?? `${clientName} · ${listName}`}${queue ? " · a queue" : `${due ? ` · due ${formatDue(due)}` : ""}${followUpAt ? `, follow up ${formatDue(followUpAt)}` : ""}`}`
                : "Edit anything that is off, and untick what you do not want."}
            </p>
          </div>
          <button onClick={onCancel} className="shrink-0 rounded-md p-1 text-muted hover:bg-background" title="Close"><I.close /></button>
        </div>

        {rows === null ? (
          <>
            <div className="flex min-h-0 flex-col overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
              {/* field-sizing:content makes the box track what is typed.
                  `rows` does NOT survive as a minimum next to it (Chrome
                  sizes to the placeholder instead, which measured 3 lines),
                  so the five line floor is an explicit min-height: 5 lines at
                  16px/1.625 plus the padding. Above that it grows, and the
                  panel's max-h is what eventually stops it and hands the
                  overflow to this element's own scrollbar. */}
              {/* One line to start with, growing as you type until it has used
                  the screen and only then scrolling. It used to open five lines
                  tall, which is a box that expects a wall of text before you
                  have decided to write one. */}
              <textarea ref={dumpRef} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
                onKeyDown={onKey}
                onDragOver={(e) => e.preventDefault()} onDrop={onDrop} autoFocus rows={1}
                placeholder={"What needs doing? Type it and press Enter."}
                className="min-h-[3rem] w-full shrink-0 resize-none overflow-y-auto rounded-xl border bg-background px-4 py-3 text-[16px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted focus:border-accent" />
              <p className="mt-1.5 shrink-0 text-[14px] text-muted">
                Enter adds it as you typed it. Shift and Enter for a new line. Paste an image or drop a file in and it rides along.
              </p>

              {files.length > 0 && (
                <div className="mt-3 flex shrink-0 flex-wrap gap-2">
                  {files.map((f, i) => (
                    <span key={i} className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[14px]">
                      {f.file.type.startsWith("image/")
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={f.url} alt="" className="h-7 w-9 rounded object-cover" />
                        : <I.clip className="text-muted" />}
                      <span className="max-w-[180px] truncate">{f.file.name || "Pasted image"}</span>
                      <button onClick={() => setFiles((fs) => fs.filter((_, n) => n !== i))} title="Remove" className="text-muted hover:text-danger"><I.close /></button>
                    </span>
                  ))}
                </div>
              )}

              {needsClient && (
                <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {fieldLabel("Client")}
                  <SearchableSelect value={clientId} options={clientOptions} onChange={(v) => { setClientId(v); onPickClient?.(v); }}
                    placeholder="Pick a client" searchPlaceholder="Search clients…"
                    className="w-full rounded-md border bg-surface px-2.5 py-1.5 text-[16px] sm:w-auto sm:min-w-[220px] sm:py-1" />
                  {!clientId && <span className="text-[16px] text-muted">Pick who this is for and it is remembered next time.</span>}
                </div>
              )}

              {/* The task page's own sentence, always showing (Derek, 2026-10-13:
                  "don't hide the details, convert it into the sentence we have
                  on the task so it's all consistent"). Each word is a picker.
                  On a queue list it says where the task joins the line
                  instead of a due date and a follow up (Derek, 2026-10-14). */}
              <p className="mt-3 shrink-0 text-[16px] leading-loose text-muted">
                {/* Your own list is yours: no owner to pick (Derek, 2026-10-14). */}
                {!personal && <>On{" "}
                <select value={owner ?? ""} onChange={(e) => setOwner(e.target.value || null)} aria-label="Owner" className={WORD}>
                  <option value="">me</option>
                  {clientFirst && <option value="client">waiting on {clientName}</option>}
                  {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>,{" "}</>}
                <select value={priority} onChange={(e) => { setPriority(e.target.value as Priority); setPriorityTouched(true); }} aria-label="Priority"
                  title={priorityTouched ? "Set by hand, so it stays put" : "Left alone it follows the due date"} className={WORD}>
                  {manualPriorityOptions(priority).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
                </select>
                {SIZING_ON && <>,{" "}
                  <select value={size ?? ""} onChange={(e) => setSize((e.target.value || null) as TaskSize | null)} aria-label="How long" className={WORD}>
                    <option value="">not sized</option>
                    {SIZE_ORDER.map((sz) => <option key={sz} value={sz}>{SIZE_META[sz].label}</option>)}
                  </select></>},{" "}
                {queue ? (<>
                  joins the line{" "}
                  <span className="whitespace-nowrap">
                    <select value={placeAt} onChange={(e) => setQueueAt(e.target.value as QueueAt)} aria-label="Where in the line"
                      title={queueAt ? "Picked by hand" : "Follows the priority until you pick"} className={WORD}>
                      {(["now", "next", "bottom"] as const).map((at) => <option key={at} value={at}>{queueAtWords(at, placeWords[at])}</option>)}
                    </select>
                    <I.chevron className="ml-0.5 inline h-3.5 w-3.5 -rotate-90 align-middle text-foreground" />
                  </span>
                  {deadline && <>,{" "}
                    <span className="whitespace-nowrap">
                      <button type="button" onClick={openDeadline} className={`${WORD} text-accent`} title="Its due date is a real deadline: the queue never clears it">{deadlineWords(deadline)}</button>
                      <button type="button" onClick={() => setDeadline(null)} aria-label="Remove the deadline" title="Remove the deadline" className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-[5px] align-middle text-muted hover:bg-background hover:text-danger">×</button>
                    </span>
                  </>}
                  {!deadline && <>{" "}
                    <button type="button" onClick={openDeadline} className="whitespace-nowrap text-[16px] text-accent underline decoration-dotted underline-offset-4 hover:text-foreground">+ Add a deadline</button>
                  </>}
                  <input ref={deadlinePick} type="date" tabIndex={-1} aria-hidden value={deadline ?? ""} onChange={(e) => setDeadline(e.target.value || null)}
                    className="pointer-events-none absolute h-0 w-0 opacity-0" />
                </>) : (<>
                  due <DayWord value={due} onChange={setDue} label="Due" />, follow up <DayWord value={followUpAt} onChange={setFollowUpAt} label="Follow up" />
                </>)}
              </p>
              {/* Step 1, set up here as it is everywhere (StepSetup): whose
                  turn, you to start with, by when, and the action, the name's
                  suggestion first. Picking an action adds the task with step 1
                  holding it (Derek, 2026-10-14). */}
              <div className="mt-3 shrink-0 border-t pt-3">
                <p className="mb-2 text-[16px] font-semibold text-foreground">Step 1</p>
                <StepSetup who={whoList} whoInitial={meId} nameOf={firstOf}
                  someoneElse={(label, pick) => <InlineAssignee value={null} noFace label={label} onChange={(id) => { if (id) pick(id); }} />}
                  whenInitial={stepWhen} today={TODAY} meId={meId} lead={lead} rows={grouped.rows} preset={null}
                  hide={[...(personal ? ["who" as const] : []), ...(askWhen ? [] : ["when" as const])]} skip={false}
                  onAnswer={(a: SetupAnswer) => { if (a.who !== stepWho) setStepWho(a.who); if (a.when !== stepWhen) { setStepWhen(a.when); setWhenSet(true); } }}
                  onDone={(a: SetupAnswer, run?: () => void) => {
                    if (!run) return;
                    const action = keyOf.get(run) ?? null;
                    if (blocked) { dumpRef.current?.focus(); return; }
                    addAsTyped({ who: a.who, when: a.when, action });
                  }} />
              </div>
            </div>
            {/* One dark button, Add, as typed. The rest are words beside it
                (Derek, 2026-10-14): a list one per line, the AI's split, and
                the AI's tidy of one task. */}
            <div className="shrink-0 space-y-2 border-t px-4 py-3 sm:px-6 sm:py-3.5">
              {splitFailed && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[5px] bg-highlight-soft px-3.5 py-2.5 text-[16px]">
                  <span className="min-w-0 flex-1 font-semibold text-highlight">The AI couldn&apos;t split that just now. Your text is still here.</span>
                  <button onClick={() => { setSplitFailed(false); addAsTyped(); }} disabled={blocked}
                    className="rounded-[5px] border bg-surface px-3.5 py-2 font-semibold hover:bg-background disabled:opacity-40">Add as one task</button>
                  <button onClick={read} disabled={blocked}
                    className="rounded-[5px] border bg-surface px-3.5 py-2 font-medium hover:bg-background disabled:opacity-40">Try again</button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button onClick={() => addAsTyped()} disabled={blocked} title="Created exactly as you typed it. No AI, nothing rewritten. (Enter)"
                  className="h-11 rounded-[5px] bg-accent px-6 text-[16px] font-semibold text-white disabled:opacity-40 max-sm:w-full">
                  Add
                </button>
                <button onClick={splitByLine} disabled={blocked} title="One task per line, worded exactly as you wrote them. No AI."
                  className={LINK}>Add several, one per line</button>
                <button onClick={read} disabled={blocked} title="AI reads the whole thing for every distinct action, then you review before anything is created"
                  className={LINK}>{pending === "split" ? "Reading…" : "Ask AI to split"}</button>
                <button onClick={aiAdd} disabled={blocked} title="One task: AI tidies the wording and reads a date, an owner and a priority out of it"
                  className={LINK}>{pending === "quick" ? "Tidying…" : "Tidy with AI"}</button>
                <button onClick={onCancel} className="ml-auto min-h-10 rounded-[5px] px-3.5 text-[16px] font-medium text-muted hover:bg-background">Cancel</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 overflow-y-auto px-6 py-4">
              <div className="space-y-2.5">
                {rows.map((r, i) => (
                  <div key={i} className={`rounded-xl border p-3.5 transition ${r.keep ? "" : "opacity-45"}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => patch(i, { keep: !r.keep })} title={r.keep ? "Don't create this one" : "Create this one"}
                        className={`mt-1.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${r.keep ? "border-accent bg-accent text-white" : "border-border"}`}>
                        {r.keep && <I.check />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <input value={r.title} onChange={(e) => patch(i, { title: e.target.value })}
                          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[17px] font-semibold outline-none hover:border-border focus:border-accent focus:bg-background" />
                        <textarea value={r.description} onChange={(e) => patch(i, { description: e.target.value })} rows={2}
                          placeholder="Directions for step 1…"
                          className="mt-1 w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] text-muted outline-none placeholder:text-muted/60 hover:border-border focus:border-accent focus:bg-background" />

                        {r.verbatim && <VerbatimBlock value={r.verbatim} onChange={(v) => patch(i, { verbatim: v })} />}

                        <div className="mt-2.5 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">{fieldLabel("Due")}{dayChips(r.due, (d) => patch(i, { due: d }))}</div>
                          <div className="flex flex-wrap items-center gap-2">{fieldLabel("Follow up")}{dayChips(r.followUpAt, (d) => patch(i, { followUpAt: d }))}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {fieldLabel("Details")}
                            <select value={r.assignee ?? ""} onChange={(e) => patch(i, { assignee: e.target.value || null })}
                              className="rounded-md border bg-background px-2.5 py-1 text-[14px] outline-none">
                              <option value="">Me</option>
                              <option value="client">⏳ Waiting on {clientName}</option>
                              {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                            </select>
                            <select value={r.priority} onChange={(e) => patch(i, { priority: e.target.value as Priority })}
                              className="rounded-md border bg-background px-2.5 py-1 text-[14px] outline-none">
                              {manualPriorityOptions(r.priority).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
                            </select>
                            {/* Optional on purpose. Nobody can honestly size a
                                task the AI just read out of a paragraph, and
                                an unsized task already counts as half a day
                                in the planner. */}
                            {SIZING_ON && <select value={r.size ?? ""} onChange={(e) => patch(i, { size: (e.target.value || null) as TaskSize | null })}
                              className={`rounded-md border bg-background px-2.5 py-1 text-[14px] outline-none ${r.size ? "" : "text-muted"}`}>
                              <option value="">How long?</option>
                              {SIZE_ORDER.map((sz) => <option key={sz} value={sz}>{SIZE_META[sz].label}</option>)}
                            </select>}
                          </div>
                        </div>

                        {files.some((f) => f.row === i) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {files.map((f, n) => f.row !== i ? null : (
                              <span key={n} className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1 text-[13px]">
                                {f.file.type.startsWith("image/")
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={f.url} alt="" className="h-6 w-8 rounded object-cover" />
                                  : <I.clip className="text-muted" />}
                                <span className="max-w-[150px] truncate">{f.file.name || "Pasted image"}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* One place to say which task each pasted file belongs to.
                  They all start on the first task, because that is right more
                  often than dropping them and always cheaper to fix than an
                  attachment that quietly went nowhere. */}
              {files.length > 0 && (
                <div className="mt-4 rounded-xl border bg-background/50 p-3.5">
                  <p className="mb-2 text-[14px] font-semibold">Where do the files go?</p>
                  <div className="space-y-2">
                    {files.map((f, n) => (
                      <div key={n} className="flex flex-wrap items-center gap-2">
                        {f.file.type.startsWith("image/")
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={f.url} alt="" className="h-7 w-10 rounded border object-cover" />
                          : <I.clip className="text-muted" />}
                        <span className="max-w-[220px] truncate text-[14px]">{f.file.name || "Pasted image"}</span>
                        <select value={f.row} onChange={(e) => setFiles((fs) => fs.map((x, m) => (m === n ? { ...x, row: Number(e.target.value) } : x)))}
                          className="min-w-0 max-w-[420px] flex-1 rounded-md border bg-surface px-2.5 py-1 text-[14px] outline-none">
                          {rows.map((r, i) => <option key={i} value={i}>{r.title || `Task ${i + 1}`}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3.5">
              <button onClick={() => setRows(null)} className="rounded-lg px-3 py-2 text-[15px] font-medium text-muted hover:bg-background hover:text-foreground">Back to the text</button>
              <span className="flex items-center gap-2">
                <button onClick={onCancel} className="rounded-lg border px-3.5 py-2 text-[15px] font-medium hover:bg-background">Cancel</button>
                <button onClick={create} disabled={kept.length === 0}
                  className="rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-40">
                  Create {kept.length} task{kept.length === 1 ? "" : "s"}
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// The client's words, shown as theirs. Locked by default rather than merely
// styled: the failure this exists to stop is a stray keystroke or a tidy-up
// pass changing copy someone was given word for word. Unlocking is one click,
// because "impossible to edit" would just send people back to the task
// drawer to do it there.
function VerbatimBlock({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-highlight/40 bg-highlight-soft px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-wide text-highlight">Their words, kept exactly</span>
        <button onClick={() => setEditing((e) => !e)} className="text-[13px] text-muted underline underline-offset-[3px] hover:text-foreground">
          {editing ? "Lock it back" : "Edit anyway"}
        </button>
      </div>
      {editing ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3}
          className="w-full resize-y rounded-md border bg-surface px-2 py-1 text-[15px] outline-none focus:border-accent" />
      ) : (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{value}</p>
      )}
    </div>
  );
}

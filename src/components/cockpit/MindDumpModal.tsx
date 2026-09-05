"use client";

// Dump what is in your head, let AI split it into tasks, review and create
// the lot (Derek, 2026-09-04: "we can just mind dump into it, and then it
// will create the task for us").
//
// Two stages on purpose. The AI's output is never written straight to the
// database: it lands in an editable list first, with every row individually
// droppable, because a parse that quietly invents or merges an action item is
// worse than no parse at all when it's already a real task by the time you
// notice.
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
  SIZE_META, SIZE_ORDER, type Priority, type TaskSize,
} from "@/lib/data";
import { I, DateChip } from "./ui";

export type ParsedRow = {
  title: string;
  description: string;
  // The client's own words, straight from the dump. Held apart from
  // description so it can be shown as locked and written into the task as a
  // blockquote rather than blended into prose the AI wrote.
  verbatim: string;
  assignee: string | null;
  due: string | null;
  followUpAt: string | null;
  size: TaskSize | null;
  priority: Priority;
  keep: boolean;
};

// A dump with no date in it still has to land somewhere real. Three business
// days out to do it, and the follow-up is TODAY: whatever you just dumped is
// what you are thinking about right now, so it belongs in today's list rather
// than waiting a day to resurface (Derek, 2026-09-04: "default do in 3 days
// and follow up today").
export const DEFAULT_DUE = () => addBusinessDaysIso(TODAY, 3);
export const DEFAULT_FOLLOW_UP = () => TODAY;

type PastedFile = { file: File; url: string; row: number };

export function MindDumpModal({ clientName, listName, destinationHint, suggestedDue, busy, onParse, onCreate, onCancel }: {
  clientName: string;
  listName: string;
  // Named so the header can say where these land without this component
  // knowing anything about groups, clients or lists.
  destinationHint?: string;
  // The bucket you opened it from wins over the three day default: clicking
  // the plus on "Tomorrow" and getting a task due Tuesday reads as a bug.
  // Null when the group has no date of its own.
  suggestedDue: string | null;
  busy: boolean;
  onParse: (text: string) => Promise<ParsedRow[] | null>;
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
  const dumpRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

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

  const read = async () => {
    const parsed = await onParse(text);
    if (!parsed) return;
    // The AI answers what is in the text. Everything it was not asked to
    // guess at (follow-up, size) and everything the defaults already answer
    // is filled in here, so no row arrives half made.
    setRows(parsed.map((r) => ({
      ...r,
      due: r.due ?? due,
      followUpAt: followUpAt,
      size: null,
      assignee: r.assignee ?? owner,
    })));
  };

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
      <div className="fixed inset-x-3 top-1/2 z-50 mx-auto flex max-h-[calc(100vh-1.5rem)] max-w-[1180px] -translate-y-1/2 flex-col rounded-2xl border bg-surface shadow-xl sm:inset-x-8 sm:max-h-[calc(100vh-3rem)]">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold">{rows === null ? "What needs doing?" : `${rows.length} task${rows.length === 1 ? "" : "s"} found`}</h2>
            <p className="mt-0.5 truncate text-[14px] text-muted">
              {rows === null
                ? `${destinationHint ?? `${clientName} · ${listName}`}${due ? ` · due ${formatDue(due)}` : ""}${followUpAt ? `, follow up ${formatDue(followUpAt)}` : ""}`
                : "Edit anything that is off, and untick what you do not want."}
            </p>
          </div>
          <button onClick={onCancel} className="shrink-0 rounded-md p-1 text-muted hover:bg-background" title="Close"><I.close /></button>
        </div>

        {rows === null ? (
          <>
            <div className="flex min-h-0 flex-col px-6 py-4">
              {/* field-sizing:content makes the box track what is typed.
                  `rows` does NOT survive as a minimum next to it (Chrome
                  sizes to the placeholder instead, which measured 3 lines),
                  so the five line floor is an explicit min-height: 5 lines at
                  16px/1.625 plus the padding. Above that it grows, and the
                  panel's max-h is what eventually stops it and hands the
                  overflow to this element's own scrollbar. */}
              <textarea ref={dumpRef} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
                onDragOver={(e) => e.preventDefault()} onDrop={onDrop} autoFocus rows={5}
                placeholder={"Type or paste anything. One thing or twenty, and every separate action becomes its own task.\n\nPaste an image or drop a file in and it rides along. Anything in quotes is kept word for word."}
                className="min-h-[9.75rem] w-full resize-none overflow-y-auto rounded-xl border bg-background px-4 py-3 text-[16px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted focus:border-accent" />

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

              <div className="mt-4 shrink-0 space-y-2 rounded-xl border bg-background/50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">{fieldLabel("Due")}{dayChips(due, setDue)}</div>
                <div className="flex flex-wrap items-center gap-2">{fieldLabel("Follow up")}{dayChips(followUpAt, setFollowUpAt)}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {fieldLabel("Owner")}
                  <select value={owner ?? ""} onChange={(e) => setOwner(e.target.value || null)}
                    className="rounded-md border bg-surface px-2.5 py-1 text-[14px] outline-none">
                    <option value="">Me</option>
                    <option value="client">⏳ Waiting on {clientName}</option>
                    {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                  <span className="text-[14px] text-muted">A task the notes name someone else for goes to them instead.</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3.5">
              <span className="text-[14px] text-muted">Nothing is created until you have seen the list.</span>
              <span className="flex items-center gap-2">
                <button onClick={onCancel} className="rounded-lg border px-3.5 py-2 text-[15px] font-medium hover:bg-background">Cancel</button>
                <button onClick={read} disabled={!text.trim() || busy}
                  className="rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-40">
                  {busy ? "Reading…" : "Make the tasks"}
                </button>
              </span>
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
                          placeholder="Add any detail…"
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
                            <select value={r.size ?? ""} onChange={(e) => patch(i, { size: (e.target.value || null) as TaskSize | null })}
                              className={`rounded-md border bg-background px-2.5 py-1 text-[14px] outline-none ${r.size ? "" : "text-muted"}`}>
                              <option value="">How long?</option>
                              {SIZE_ORDER.map((sz) => <option key={sz} value={sz}>{SIZE_META[sz].label}</option>)}
                            </select>
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

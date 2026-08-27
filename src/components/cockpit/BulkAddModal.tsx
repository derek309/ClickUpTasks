"use client";

// Paste a blob of notes, let AI split it into tasks, review and edit them,
// then create the lot (Derek, 2026-08-26: "I would like to be able to just
// dump it a task details or a list like that and then it creates all the
// tasks for me").
//
// Two stages on purpose. The AI's output is never written straight to the
// database: it lands in an editable table first, with every row individually
// droppable, because a parse that quietly invents or merges an action item is
// worse than no parse at all when it's already a real task by the time you
// notice.
import { useEffect, useState } from "react";
import { users, PRIORITY_META, manualPriorityOptions, type Priority } from "@/lib/data";
import { I } from "./ui";

export type ParsedRow = {
  title: string;
  description: string;
  assignee: string | null;
  due: string | null;
  priority: Priority;
  keep: boolean;
};

export function BulkAddModal({ clientName, listName, busy, onParse, onCreate, onCancel }: {
  clientName: string;
  listName: string;
  busy: boolean;
  onParse: (text: string) => Promise<ParsedRow[] | null>;
  onCreate: (rows: ParsedRow[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const read = async () => {
    const parsed = await onParse(text);
    if (parsed) setRows(parsed);
  };
  const patch = (i: number, p: Partial<ParsedRow>) => setRows((rs) => rs?.map((r, n) => (n === i ? { ...r, ...p } : r)) ?? rs);
  const kept = rows?.filter((r) => r.keep && r.title.trim()) ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">Add tasks from a list</h2>
            <p className="mt-0.5 truncate text-[13px] text-muted">Creating into {clientName} · {listName}</p>
          </div>
          <button onClick={onCancel} className="shrink-0 rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
        </div>

        {rows === null ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus
                placeholder={"Paste meeting notes, an action-item list, or an email.\n\nNames used as headings become the assignee, so a list split into \"Derek\" and the client's own name lands on the right people."}
                className="min-h-[260px] w-full resize-y rounded-xl border bg-background px-3 py-2.5 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
              <p className="mt-2 text-[13px] text-muted">Nothing is created until you have reviewed the list on the next step.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
              <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
              <button onClick={read} disabled={!text.trim() || busy}
                className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">
                {busy ? "Reading…" : "Read the list"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <p className="mb-2 text-[13px] text-muted">
                {rows.length} task{rows.length === 1 ? "" : "s"} found. Edit anything that is off, and untick what you do not want.
              </p>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className={`rounded-xl border p-2.5 transition ${r.keep ? "" : "opacity-45"}`}>
                    <div className="flex items-start gap-2">
                      <button onClick={() => patch(i, { keep: !r.keep })} title={r.keep ? "Don't create this one" : "Create this one"}
                        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${r.keep ? "border-accent bg-accent text-white" : "border-border"}`}>
                        {r.keep && <I.check />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <input value={r.title} onChange={(e) => patch(i, { title: e.target.value })}
                          className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[16px] font-medium outline-none hover:border-border focus:border-accent focus:bg-background" />
                        {r.description && (
                          <textarea value={r.description} onChange={(e) => patch(i, { description: e.target.value })} rows={2}
                            className="mt-1 w-full resize-y rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[14px] text-muted outline-none hover:border-border focus:border-accent focus:bg-background" />
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <select value={r.assignee ?? ""} onChange={(e) => patch(i, { assignee: e.target.value || null })}
                            className="rounded-md border bg-background px-2 py-1 text-[14px] outline-none">
                            <option value="">Unassigned</option>
                            <option value="client">⏳ Waiting on {clientName}</option>
                            {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                          </select>
                          <select value={r.priority} onChange={(e) => patch(i, { priority: e.target.value as Priority })}
                            className="rounded-md border bg-background px-2 py-1 text-[14px] outline-none">
                            {manualPriorityOptions(r.priority).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
                          </select>
                          <input type="date" value={r.due ?? ""} onChange={(e) => patch(i, { due: e.target.value || null })}
                            className="rounded-md border bg-background px-2 py-1 text-[14px] outline-none" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
              <button onClick={() => setRows(null)} className="rounded-md px-2.5 py-1.5 text-[15px] font-medium text-muted hover:bg-background hover:text-foreground">Back to the text</button>
              <span className="flex items-center gap-2">
                <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
                <button onClick={() => onCreate(kept)} disabled={kept.length === 0}
                  className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">
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

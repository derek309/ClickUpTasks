"use client";

// Hand the selected tasks to one person, once.
//
// The task drawer's dock does this for a single task and asks seven questions.
// Six of them have the same answer for every task in a batch, so this asks
// those six and takes the seventh, what to call the handoff, from each task's
// own title (see bulkDelegations).
import { useState } from "react";
import {
  PRIORITY_META, SIZE_META, SIZE_ORDER, formatDue, manualPriorityOptions, whenOptions,
  type Priority, type TaskSize, type User,
} from "@/lib/data";
import { bulkDelegateProblem, type BulkDelegateSpec } from "@/lib/bulkDelegate";
import { DateChip } from "./ui";
import { useEscapeToClose } from "./useEscapeToClose";

export type BulkDelegateModalProps = {
  count: number;
  /** Everyone it can go to: the roster without you. */
  users: User[];
  onCancel: () => void;
  onDelegate: (spec: BulkDelegateSpec) => void;
  /** Shown when the batch is not ready, in the app's usual place for it. */
  onProblem: (message: string) => void;
};

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[16px] font-bold uppercase tracking-wider text-muted">{label}</div>
      {children}
    </div>
  );
}

const chip = (on: boolean) =>
  `rounded-md border px-2.5 py-1.5 text-[16px] ${on ? "border-accent bg-accent text-white" : "bg-surface hover:bg-background"}`;

function Dates({ value, onChange, after }: { value: string | null; onChange: (d: string | null) => void; after: string | null }) {
  const opts = whenOptions(after);
  const custom = !!value && !opts.some((o) => o.date === value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((o) => (
        <button key={o.label} type="button" onClick={() => onChange(o.date)} title={formatDue(o.date)} className={chip(value === o.date)}>{o.label}</button>
      ))}
      <DateChip value={value} onChange={onChange} label={custom ? formatDue(value!) : "Pick"} className={chip(custom)} />
    </div>
  );
}

export function BulkDelegateModal({ count, users, onCancel, onDelegate, onProblem }: BulkDelegateModalProps) {
  useEscapeToClose(onCancel);
  const [toId, setToId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [theirDue, setTheirDue] = useState<string | null>(null);
  const [followUpAt, setFollowUpAt] = useState<string | null>(null);
  const [size, setSize] = useState<TaskSize | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);

  const submit = () => {
    const spec: BulkDelegateSpec = { toId, instructions, theirDue: theirDue ?? "", followUpAt, size, priority };
    const problem = bulkDelegateProblem(spec, count);
    if (problem) { onProblem(problem); return; }
    onDelegate(spec);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div role="dialog" aria-modal="true" aria-label="Delegate the selected tasks"
        className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border bg-surface p-5 shadow-xl">
        <h2 className="text-[17px] font-semibold">Delegate {count} task{count === 1 ? "" : "s"}</h2>
        <p className="mb-4 mt-1 text-[16px] text-muted">
          They each land on their list with the brief below, named after their own task. The tasks stay yours.
        </p>

        <Field label={<>To{!toId && <span className="ml-1 font-medium normal-case tracking-normal text-danger">pick someone</span>}</>}>
          <div className="flex flex-wrap gap-1.5">
            {users.map((u) => (
              <button key={u.id} type="button" onClick={() => setToId(u.id)} className={chip(toId === u.id)}>{u.name}</button>
            ))}
          </div>
        </Field>

        <Field label="What they need to do">
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4}
            placeholder="Everything they need to know to do all of these. Paste any links they will need."
            className="w-full resize-y rounded-[9px] border bg-surface px-3 py-2 text-[16px] outline-none focus:border-accent" />
        </Field>

        {/* The two dates side by side, because the whole point is that they are
            different dates doing different jobs. */}
        <div className="grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
          <Field label={<>They owe them{!theirDue && <span className="ml-1 font-medium normal-case tracking-normal text-danger">pick a date</span>}</>}>
            <Dates value={theirDue} onChange={setTheirDue} after={null} />
          </Field>
          <Field label="You follow up">
            <Dates value={followUpAt} onChange={setFollowUpAt} after={theirDue} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
          <Field label="Each takes">
            <div className="flex flex-wrap gap-1.5">
              {SIZE_ORDER.map((sz) => (
                <button key={sz} type="button" onClick={() => setSize(size === sz ? null : sz)} title={`${SIZE_META[sz].label} · ${SIZE_META[sz].hint}`}
                  className={chip(size === sz)}>{SIZE_META[sz].label}</button>
              ))}
            </div>
          </Field>
          <Field label="Priority">
            <div className="flex flex-wrap gap-1.5">
              {/* No choice leaves every task on the priority it already has,
                  which is why there is no default selected here. */}
              {manualPriorityOptions(priority ?? "normal").map((pr) => (
                <button key={pr} type="button" onClick={() => setPriority(priority === pr ? null : pr)} className={chip(priority === pr)}>{PRIORITY_META[pr].label}</button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-3 border-t pt-3">
          <span className="mr-auto text-[16px] text-muted">Moves them all to the Delegated stage.</span>
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[16px] font-medium hover:bg-background">Cancel</button>
          <button type="button" onClick={submit} className="rounded-lg bg-accent px-4 py-2 text-[16px] font-semibold text-white hover:opacity-90">
            Delegate {count}
          </button>
        </div>
      </div>
    </>
  );
}

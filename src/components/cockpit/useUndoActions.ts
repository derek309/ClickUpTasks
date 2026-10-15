"use client";

// The task drawer's side of lib/undoAction: each action that makes something
// to fill in notes itself here with the task as it was before it, and each
// place it is left from (the email window, a step's page, a text box, the
// reply box) asks to take it back. Saves go through the drawer's own patch,
// so the per task save queue keeps its order.
//
// A text or chat box and the reply box sit on the page with no window of
// their own, so Escape comes here first while one of them waits untouched:
// it takes the newest back instead of closing the task. Once something was
// entered the key goes on to whatever is under it (PASS_ESCAPE).
import { useEffect, useRef, useState } from "react";
import { actionDidSomething, actionTouched, mergeActions, undoAction, type ActionRecord, type ActionState } from "@/lib/undoAction";
import type { EmailDraft, Subtask } from "@/lib/data";
import { PASS_ESCAPE, useEscapeToClose } from "./useEscapeToClose";

const isInline = (slot: string) => slot.startsWith("msg:") || slot.startsWith("reply:");
type Match = string | ((slot: string) => boolean);
const matches = (m: Match, slot: string) => (typeof m === "string" ? m === slot : m(slot));

export function useUndoActions({ taskId, task, current, apply, onUndone }: {
  taskId: string;
  /** The task as rendered: each change looks again at what is waiting. */
  task: unknown;
  /** The task's steps and draft email right now (the drawer's taskRef). */
  current: () => ActionState;
  /** Saves the patch the same way any edit on the task saves. */
  apply: (patch: { subtasks?: Subtask[]; draftEmail?: EmailDraft | null }) => void;
  /** Something was taken back: the steps taken off, for the drawer to close their page. */
  onUndone: (removed: string[], rec: ActionRecord) => void;
}) {
  // Each kept with the task it was on: another task opened in the same
  // drawer leaves what waited on the last one as it is.
  const records = useRef<(ActionRecord & { task: string })[]>([]);
  // Only to switch Escape on and off: the records themselves live in the ref.
  const [inline, setInline] = useState(0);
  const sync = () => {
    records.current = records.current.filter((r) => r.task === taskId);
    setInline(records.current.filter((r) => isInline(r.slot)).length);
  };

  const snap = (s: ActionState): ActionState => ({ subtasks: s.subtasks, draftEmail: s.draftEmail ?? null });

  /** An action just ran: `before` is the task as it was before it (the
   *  render's own copy, or one taken before an await). `draftOnly`: only the
   *  draft email it wrote comes back (an email written as part of finishing
   *  a step, where the finish stays). */
  const note = (slot: string, before: ActionState, opts: { draftOnly?: boolean } = {}) => {
    const after = snap(current());
    const from = opts.draftOnly ? { subtasks: after.subtasks, draftEmail: before.draftEmail ?? null } : snap(before);
    const next: ActionRecord = { slot, before: from, after };
    if (!actionDidSomething(next)) return;
    sync();
    const prev = records.current.find((r) => r.slot === slot);
    const merged = mergeActions(prev, next);
    records.current = [...records.current.filter((r) => r.slot !== slot), { ...merged, task: taskId }];
    sync();
  };

  /** A step the action made that is kept whatever happens (a name was
   *  typed for it): the rest of the action can still come back. */
  const keepStep = (id: string) => {
    records.current = records.current.map((r) => {
      const made = r.after.subtasks.find((s) => s.id === id);
      if (!made || r.before.subtasks.some((s) => s.id === id)) return r;
      return { ...r, before: { ...r.before, subtasks: [...r.before.subtasks, made] }, task: r.task };
    });
  };

  /** The action moves to where it is now left from (the reply box opened
   *  in the full email window). */
  const reslot = (from: string, to: string) => {
    sync();
    const r = records.current.find((x) => x.slot === from);
    if (!r) return;
    const prev = records.current.find((x) => x.slot === to);
    records.current = [...records.current.filter((x) => x.slot !== from && x.slot !== to), { ...mergeActions(prev, { ...r, slot: to }), task: r.task }];
    sync();
  };

  const forget = (m: Match) => { records.current = records.current.filter((r) => !matches(m, r.slot)); sync(); };

  /** Left from `m`: each action waiting there with nothing entered since is
   *  taken back, newest first; the rest are kept as they are and forgotten.
   *  `latest` is the draft email as the window holds it, typing not saved
   *  yet included. True when something was taken back. */
  const leave = (m: Match, latest?: { draftEmail?: EmailDraft | null }): boolean => {
    sync();
    const mine = records.current.filter((r) => matches(m, r.slot)).reverse();
    if (!mine.length) return false;
    forget(m);
    let any = false;
    for (const rec of mine) {
      const now = current();
      const state: ActionState = { subtasks: now.subtasks, draftEmail: latest && "draftEmail" in latest ? latest.draftEmail : now.draftEmail };
      const back = undoAction(rec, state);
      if (!back) continue;
      const { removed, ...patch } = back;
      apply(patch);
      onUndone(removed, rec);
      any = true;
    }
    return any;
  };

  /** Waiting with nothing entered: Discard on it can take it back instead. */
  const waiting = (m: Match, latest?: { draftEmail?: EmailDraft | null }): boolean => records.current.some((r) => {
    if (!matches(m, r.slot)) return false;
    const now = current();
    return !actionTouched(r, { subtasks: now.subtasks, draftEmail: latest && "draftEmail" in latest ? latest.draftEmail : now.draftEmail });
  });

  // Once something is entered the action is kept for good: no Escape of
  // ours left waiting on it.
  const settle = () => {
    const now = current();
    const kept = records.current.filter((r) => !actionTouched(r, now));
    if (kept.length !== records.current.length) { records.current = kept; sync(); }
  };
  useEffect(() => { settle(); }, [task]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape over a text box or reply box left untouched takes the newest back.
  useEscapeToClose(() => {
    const newest = [...records.current].reverse().find((r) => isInline(r.slot));
    if (newest && leave(newest.slot)) return undefined;
    forget(isInline);
    return PASS_ESCAPE;
  }, inline > 0);

  return { note, leave, forget, keepStep, reslot, waiting, settle };
}

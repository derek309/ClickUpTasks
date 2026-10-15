// An action left with nothing entered takes itself back (Derek, 2026-10-15:
// "If we click Email a follow up, or create a doc, or email or anything, and
// we hit Esc and never enter anything, cancel and remove it").
//
// Each action that makes something to fill in (a step named for it, the
// task's draft email, a text or chat on a step, a hold, a What's next renamed
// by a pick) is recorded as the steps and draft email before it and right
// after it. Leaving it (Escape, the window's back link, Discard, clicking
// away from an inline box, closing the step's page) asks whether anything
// changed since: when nothing did, the task goes back to how it was before
// the action, through the same save as any edit. A template the app wrote
// (a follow up text, a meeting request with times) is what the action made,
// so leaving it as written takes it back too. Anything typed, added or
// picked since keeps all of it, as before.
import { htmlToText, type EmailDraft, type Subtask } from "./data";

export type ActionState = { subtasks: Subtask[]; draftEmail?: EmailDraft | null };
/** What one action did. `slot` says where it is left from: "email" (the
 *  email window), "step:<id>" (that step's page), "msg:<id>" (the text or
 *  chat box on that step), "reply:<id>" (the reply written under the
 *  client's email on that step). */
export type ActionRecord = { slot: string; before: ActionState; after: ActionState };

// The app's own bookkeeping on a step, which moves without anyone entering
// anything: never a sign the step was used.
const BOOKKEEPING = new Set(["startedAt", "seenAt", "stage", "suggested", "clientOrder", "expectedFrom", "at"]);

/** A value with its empties gone and its keys in order, so the same content
 *  reads the same however it was saved (a round trip through the database
 *  reorders keys and drops undefined). */
function settled(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(settled);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (isEmpty(x)) continue;
      out[k] = settled(x);
    }
    return out;
  }
  return v;
}
const isEmpty = (x: unknown) => x === undefined || x === null || x === "" || (Array.isArray(x) && x.length === 0);
const key = (v: unknown) => JSON.stringify(settled(v) ?? null);
const sameValue = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || key(a) === key(b);

/** What a person can have put on a step: everything but the bookkeeping. */
export function stepContent(s: Subtask): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!BOOKKEEPING.has(k)) out[k] = v;
  return key(out);
}

/** The draft email as a person sees it: its subject, its words, its files and
 *  copies. Its link (added by the app a moment later) and timestamps are
 *  not something anyone entered. */
export function emailContent(d: EmailDraft): string {
  return key({
    subject: d.subject.trim(),
    text: htmlToText(d.body ?? "").replace(/\s+/g, " ").trim(),
    files: (d.attachments ?? []).map((a) => a.id),
    cc: d.cc ?? [],
    bcc: d.bcc ?? [],
  });
}

const byId = (list: Subtask[]) => new Map(list.map((s) => [s.id, s]));

/** The steps the action made, and the ones it changed. */
export function actionSteps(rec: Pick<ActionRecord, "before" | "after">): { made: Subtask[]; changed: Subtask[] } {
  const was = byId(rec.before.subtasks);
  const made: Subtask[] = [];
  const changed: Subtask[] = [];
  for (const s of rec.after.subtasks) {
    const b = was.get(s.id);
    if (!b) made.push(s);
    else if (stepContent(b) !== stepContent(s)) changed.push(s);
  }
  return { made, changed };
}

const draftChanged = (rec: Pick<ActionRecord, "before" | "after">) => {
  const b = rec.before.draftEmail ?? null;
  const a = rec.after.draftEmail ?? null;
  if (!b || !a) return b !== a;
  return b.createdAt !== a.createdAt || emailContent(b) !== emailContent(a);
};

/** Did the action change anything at all? An action that only opened what
 *  was already there has nothing to take back. */
export function actionDidSomething(rec: Pick<ActionRecord, "before" | "after">): boolean {
  const { made, changed } = actionSteps(rec);
  return made.length > 0 || changed.length > 0 || draftChanged(rec);
}

/** Anything entered since the action: a step it made or changed reads
 *  differently now (a name, notes, to dos, files, a date, a teammate, text
 *  in its message, done), or the draft email it wrote has other words,
 *  files or copies, or is gone (sent or thrown away). A step it made that
 *  is gone already is nothing entered. */
export function actionTouched(rec: Pick<ActionRecord, "before" | "after">, now: ActionState): boolean {
  const cur = byId(now.subtasks);
  const { made, changed } = actionSteps(rec);
  for (const s of [...made, ...changed]) {
    const n = cur.get(s.id);
    if (n && stepContent(n) !== stepContent(s)) return true;
  }
  if (draftChanged(rec)) {
    const a = rec.after.draftEmail ?? null;
    const n = now.draftEmail ?? null;
    if (!a) return !!n && n.createdAt !== rec.before.draftEmail?.createdAt;
    if (!n || n.createdAt !== a.createdAt || emailContent(n) !== emailContent(a)) return true;
  }
  return false;
}

/** The task put back as it was before the action, when nothing was entered
 *  since: the steps it made come off, the steps it changed get back what it
 *  changed on them (a What's next its pick renamed asks again), and the
 *  draft email it wrote goes (or the one it replaced comes back). Null when
 *  something was entered, or there is nothing to take back. `removed` lists
 *  the steps taken off. */
export function undoAction(rec: Pick<ActionRecord, "before" | "after">, now: ActionState): { subtasks?: Subtask[]; draftEmail?: EmailDraft | null; removed: string[] } | null {
  if (actionTouched(rec, now)) return null;
  const was = byId(rec.before.subtasks);
  const made = new Set(actionSteps(rec).made.map((s) => s.id));
  const changed = actionSteps(rec).changed;
  const removed = now.subtasks.filter((s) => made.has(s.id)).map((s) => s.id);
  let list = now.subtasks.filter((s) => !made.has(s.id));
  for (const s of changed) {
    const b = was.get(s.id)!;
    list = list.map((x) => {
      if (x.id !== s.id) return x;
      const back: Record<string, unknown> = { ...x };
      for (const k of new Set([...Object.keys(b), ...Object.keys(s)])) {
        const bv = (b as unknown as Record<string, unknown>)[k];
        if (sameValue(bv, (s as unknown as Record<string, unknown>)[k])) continue;
        if (bv === undefined) delete back[k]; else back[k] = bv;
      }
      return back as unknown as Subtask;
    });
  }
  const stepsBack = removed.length > 0 || changed.some((s) => now.subtasks.some((x) => x.id === s.id));
  const draftBack = draftChanged(rec) && (now.draftEmail ?? null) !== (rec.before.draftEmail ?? null);
  if (!stepsBack && !draftBack) return null;
  return {
    ...(stepsBack ? { subtasks: list } : {}),
    ...(draftBack ? { draftEmail: rec.before.draftEmail ?? null } : {}),
    removed,
  };
}

/** A new action on a slot that still has one waiting: when the waiting one
 *  was left as it was, both come back together, from before the first. */
export function mergeActions(prev: ActionRecord | undefined, next: ActionRecord): ActionRecord {
  if (!prev || actionTouched(prev, next.before)) return next;
  return { slot: next.slot, before: prev.before, after: next.after };
}

/** A review or document made by opening it (its line's tap, a step's work)
 *  and left with nothing in it: never written in, named, uploaded to,
 *  commented on or sent, and nothing on its way. It is deleted again as the
 *  window closes, through the review's own delete. */
export function reviewLeftEmpty(r: {
  version: number; body: string | null | undefined; title: string; madeTitle: string;
  /** What the editor holds, when anything was typed in it. */
  typed: string | null; files: number; comments: number;
  /** An upload, a paste, a page edit or a save still under way. */
  busy: boolean;
}): boolean {
  const words = (h: string | null | undefined) => htmlToText(h ?? "").trim();
  return r.version === 0 && !words(r.body) && !(r.typed !== null && words(r.typed)) && r.title.trim() === r.madeTitle.trim()
    && r.files === 0 && r.comments === 0 && !r.busy;
}

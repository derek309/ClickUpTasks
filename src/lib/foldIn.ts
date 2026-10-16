// Fold in (Derek, 2026-10-15): older tasks that were only flagged waiting on
// the client (waiting_on_client, status "waiting") with no client step, so
// "What we need from <client>" and the reminders could not see them. The
// list offers them in one review sheet: each gets an ask, written here from
// its name and edited by us, and a fresh need by date; adding one puts a
// client step in at the current place, one task write at a time. Pure, so
// the asks, the dates, the step and the one at a time add can be tested.

import { addBusinessDaysIso, currentStep, type Subtask, type TaskStatus } from "./data";
import { isClientWait } from "./afterThis";

/** The fields a task needs to be looked at here. */
export type FoldInTask = {
  id: string; title: string; description?: string | null; status: TaskStatus | string; waitingOnClient?: boolean;
  projectId?: string | null; due?: string | null; private?: boolean; hiddenFromClient?: boolean; subtasks?: Subtask[] | null;
};

/** An open, shared task flagged waiting on the client whose current step is
 *  not the client's turn (or that has no steps at all). */
export function needsFoldIn(t: FoldInTask): boolean {
  if (t.status === "done" || t.status === "on_hold" || t.private || t.hiddenFromClient) return false;
  if (!t.waitingOnClient && t.status !== "waiting") return false;
  const cur = currentStep(t.subtasks ?? []);
  return !cur || !isClientWait(cur);
}

/** The ones to offer, grouped by list (a list in the place of its earliest
 *  task), each list by the task's own due date, undated last. */
export function foldInTasks<T extends FoldInTask>(tasks: T[], listName: (id: string | null) => string | null = () => null): T[] {
  const due = (t: T) => t.due ?? "9999-99-99";
  const byDue = (a: T, b: T) => due(a).localeCompare(due(b)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  const open = tasks.filter(needsFoldIn).sort(byDue);
  const lists: (string | null)[] = [];
  for (const t of open) if (!lists.includes(t.projectId ?? null)) lists.push(t.projectId ?? null);
  // Lists in the order their first task comes up; a tie by name.
  const first = (l: string | null) => open.find((t) => (t.projectId ?? null) === l)!;
  lists.sort((a, b) => byDue(first(a), first(b)) || (listName(a) ?? "").localeCompare(listName(b) ?? ""));
  return lists.flatMap((l) => open.filter((t) => (t.projectId ?? null) === l));
}

/** The fresh need by dates, in order: the first 3 business days out, then
 *  each next 2 business days after the one before. */
export const FIRST_NEED_BY = 3;
export const NEXT_NEED_BY = 2;
export function foldInNeedBys(count: number, today: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(addBusinessDaysIso(i ? out[i - 1] : today, i ? NEXT_NEED_BY : FIRST_NEED_BY));
  return out;
}

// ── The ask ─────────────────────────────────────────────────────────────────

/** The client does these: the name stays the ask ("Send X", "Record X"). */
const CLIENT_VERB = /^(send|record|film|test|tag|clean|forward|approve|review|confirm|sign|pick|choose|upload|fill|answer|book|pay|decide|tell|give|share|call|check|read|look|reply|provide|complete|select|submit|try|email|text|take|find|gather|collect|schedule|let|agree|clear|list|write down)\b/i;
/** Things a client hands us: "Content for the agent site" → "Send the content for the agent site". */
const THING = /^(content|copy|photos?|pictures?|images?|videos?|logos?|answers?|info|information|details|login|logins|access|files?|documents?|text|wording|testimonials?|reviews?|bio|headshots?)\b/i;
/** "Other absolute claims to clear with James" → "Clear the other absolute claims". */
const TO_DO_WITH = /^(.+?)\s+to\s+(clear|check|confirm|agree|decide|approve|review|go over|settle)\s+with\s+NAME\s*$/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Consent email" → "consent email"; "PlanEnroll link" keeps its capital. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\s+([,.:;!?])/g, "$1").trim().replace(/[.:;,]+$/, "");

/** Our words about them, said to them: "from James" and "with James" go,
 *  "James's" and "his"/"her" become "your". */
function toYou(s: string, first: string): string {
  if (!first) return s;
  const n = escapeRe(first);
  return s
    .replace(new RegExp(`\\s+(from|with)\\s+${n}\\b(?!['’])`, "gi"), "")
    .replace(new RegExp(`\\b${n}['’]s?\\s+`, "gi"), "your ")
    .replace(/\byour own own\b/gi, "your own");
}

/** The description's (or first step's notes') lines, as plain text. */
function lines(text: string | null | undefined): string[] {
  if (!text) return [];
  const plain = /<[a-z!/]/i.test(text)
    ? text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h[1-6])>/gi, "\n").replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#0?39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    : text;
  return plain.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

/** A better ask read from the notes: "Blocked on: James's own PlanEnroll
 *  link." → "Send your own PlanEnroll link"; "Waiting on James (task …): his
 *  carrier count" → "Send your carrier count". Null when none reads as one. */
export function askFromNotes(text: string | null | undefined, first: string): string | null {
  const n = escapeRe(first || "the client");
  for (const line of lines(text).slice(0, 8)) {
    // At the start of the line or of a sentence in it.
    const m = /(?:^|[.!?]\s+)blocked on:?\s+(.+)$/i.exec(line) ?? new RegExp(`(?:^|[.!?]\\s+)waiting on ${n}\\b[^:]*:\\s*(.+)$`, "i").exec(line);
    if (!m) continue;
    let what = m[1]
      .replace(/\s*\(task\b[^)]*\)/gi, "")
      .split(/\.\s+(?=[A-Z])/)[0]
      .replace(/\b(his|her|their)\b/gi, "your");
    what = tidy(toYou(what, first));
    // "Blocked on James" alone says nothing about what to send.
    if (!what || new RegExp(`^${n}$`, "i").test(what)) continue;
    return `Send ${lowerFirst(what)}`;
  }
  return null;
}

/** The ask a fold in starts with, from the task's name (and its notes when the
 *  name is our own work), in the imperative to the client. We edit it before
 *  it is added. */
export function askFromTaskTitle(title: string, o: { first: string; notes?: string | null }): string {
  const first = o.first.trim();
  const raw = tidy(title);
  if (!raw) return "";
  const n = escapeRe(first || "the client");
  const withThem = new RegExp(TO_DO_WITH.source.replace("NAME", n), "i").exec(raw);
  if (withThem) return `${upperFirst(withThem[2].toLowerCase())} the ${lowerFirst(tidy(toYou(withThem[1], first)))}`;
  const said = tidy(toYou(raw, first));
  if (CLIENT_VERB.test(said)) return upperFirst(said);
  const fromNotes = askFromNotes(o.notes, first);
  if (fromNotes) return fromNotes;
  // A thing we need from them, by name: "Consent email from James".
  if (first && new RegExp(`\\s+from\\s+${n}\\s*$`, "i").test(raw) && !/^(add|put|develop|build|swap|update|make|create|design|fix|set|rebuild|move|remove|publish|post|launch|finish|install|connect|edit|draft)\b/i.test(said)) return `Send ${lowerFirst(said)}`;
  if (THING.test(said)) return `Send the ${lowerFirst(said)}`;
  return `Send what we need for: ${said}`;
}

// ── Adding them ─────────────────────────────────────────────────────────────

/** The task's steps with the client's step in at the current place: before
 *  the first open step (done steps stay where they are), or at the end. Null
 *  when the current step is already the client's turn. */
export function withClientStep(subtasks: Subtask[], o: { ask: string; needBy: string; now: string; makeId: () => string }): Subtask[] | null {
  const cur = currentStep(subtasks);
  if (cur && isClientWait(cur)) return null;
  const step: Subtask = { id: o.makeId(), title: o.ask.trim(), done: false, onClient: true, due: o.needBy, startedAt: o.now };
  const at = cur ? subtasks.indexOf(cur) : -1;
  const out = [...subtasks];
  if (at < 0) out.push(step); else out.splice(at, 0, step);
  return out;
}

export type FoldInPick = { taskId: string; ask: string; needBy: string };

/** Adds the picked ones, one task write at a time: each waits for the one
 *  before (never a many row update: the 10-13 outage). `getTask` reads the
 *  task as it is now; `patch` is the app's own task save. Returns how many
 *  were added. */
export async function addFoldIns(picks: FoldInPick[], o: {
  getTask: (id: string) => (FoldInTask & { subtasks: Subtask[] }) | null | undefined;
  patch: (id: string, patch: { subtasks: Subtask[]; status?: "waiting" }) => Promise<unknown> | unknown;
  now: () => string; makeId: () => string;
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  let added = 0;
  for (let i = 0; i < picks.length; i++) {
    o.onProgress?.(i + 1, picks.length);
    const p = picks[i];
    const t = o.getTask(p.taskId);
    if (!t || !p.ask.trim()) continue;
    const subtasks = withClientStep(t.subtasks, { ask: p.ask, needBy: p.needBy, now: o.now(), makeId: o.makeId });
    if (!subtasks) continue;
    // Still waiting on them: waiting_on_client and status "waiting" together.
    const keepWaiting = !t.waitingOnClient || t.status !== "waiting";
    await o.patch(t.id, keepWaiting ? { subtasks, status: "waiting" } : { subtasks });
    added++;
  }
  return added;
}

// Queues (Derek, 2026-10-14: "most dates are the order I'll get to things").
// A list with its Queue switch on works one task at a time (or N): the Now
// task has a real due date, the rest wait in line with no date, and finishing
// the Now one gives the next one its date. Lists without the switch change in
// no way.
//
// The one set of rules for it, in plain JavaScript so the app, the server
// routes and the MCP server all import the same thing (like taskMove.mjs).
// Everything here is pure; the *Store functions at the bottom take a small
// adapter for reading and writing, so the browser, supabaseAdmin and the MCP's
// PostgREST calls each plug in their own.
//
// The words used:
//   place in line  tasks.queue_pos, an integer; gaps of POS_STEP so moving one
//                  task is one write. Null is "not placed yet" (a task made
//                  in, or moved into, the list): it sits where its priority
//                  puts it (entryIndex) until the next queue write places it.
//   deadline       tasks.deadline: its due is a real deadline. It keeps it
//                  whatever happens to the queue.
//   saved due      tasks.queue_saved_due: the due a task had before the queue
//                  cleared it, put back when the queue is turned off.
//   started        placed, with a due, and not a deadline: a task the queue
//                  (or the person) gave a date. A started task that is not
//                  waiting is always Now, so one coming back from waiting
//                  rejoins Now and pushes nobody out (Now can be N + 1 for a
//                  while; the next one is only promoted once Now drops below N).
//   waiting        its current turn is the client's or a teammate's (not
//                  yours, not Claude's): the same rule as the step's colour on
//                  the task page (TaskDrawer stepTone).

/** @typedef {{ now: number; spacing: number }} QueueSettings */
/** @typedef {{ id?: string; title?: string; done?: boolean; fromClient?: boolean; assigneeId?: string | null; stage?: string; onClient?: boolean; finishWhen?: string }} QStep */
/** @typedef {{ id: string; title: string; status: string; due: string | null; deadline?: boolean; queuePos?: number | null; queueSavedDue?: string | null; createdAt: string; priority?: string; assigneeId?: string | null; waitingOnClient?: boolean; subtasks?: QStep[] }} QTask */
/** @typedef {{ id: string; queuePos?: number | null; due?: string | null; queueSavedDue?: string | null }} QPatch */

export const CLAUDE_ID = "u_claude";
export const POS_STEP = 1000;
export const DEFAULT_QUEUE = Object.freeze({ now: 1, spacing: 3 });

/** The list's queue setting, or null when it is off (projects.queue null, or
 *  a database the queue SQL has not reached). Out of range numbers are
 *  brought back in range rather than turning the queue off.
 *  @param {unknown} raw @returns {QueueSettings | null} */
export function queueSettings(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const int = (v, d, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return { now: int(r.now, DEFAULT_QUEUE.now, 1, 10), spacing: int(r.spacing, DEFAULT_QUEUE.spacing, 0, 30) };
}

// --- dates (copies of data.ts's, so the MCP needs no app import) -------------

/** @param {string} iso @param {number} days */
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
/** Weekdays only, the same as data.ts addBusinessDaysIso.
 *  @param {string} iso @param {number} days */
export function addBusinessDaysIso(iso, days) {
  let out = iso;
  let left = days;
  while (left > 0) {
    out = addDaysIso(out, 1);
    const dow = new Date(`${out}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return out;
}
/** Today in the team's timezone, for server code (the server clock is UTC). */
export function pacificToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// --- whose turn ------------------------------------------------------------

/** @param {QStep} s @param {string | null | undefined} owner */
function stepIsWaiting(s, owner) {
  // A teammate's step (a handoff): theirs to do, not ours. Claude's is not
  // waiting: Claude is working it.
  if (s.assigneeId && s.assigneeId !== owner) return s.assigneeId !== CLAUDE_ID;
  if (s.onClient || s.finishWhen === "reply") return true;
  const stage = s.stage ?? (/\bwait/.test(String(s.title ?? "").toLowerCase()) ? "waiting" : null);
  return stage === "waiting";
}

/** Waiting on someone else: the client's turn or a teammate's.
 *  @param {QTask} t */
export function isQueueWaiting(t) {
  if (t.status === "done") return false;
  if (t.waitingOnClient) return true;
  const cur = (t.subtasks ?? []).find((s) => !s.fromClient && !s.done);
  if (!cur) return t.status === "waiting" || t.status === "delegated";
  return stepIsWaiting(cur, t.assigneeId ?? null);
}

// --- the order -------------------------------------------------------------

/** "Urgent" enters right after Now, "high" at the top of Up next below any
 *  urgent ones already there, the rest at the bottom. The app has no High:
 *  its two automatic tiers (a client request, an interaction) count as high.
 *  @param {string | undefined} p @returns {"urgent" | "high" | "normal"} */
export function entryRank(p) {
  if (p === "urgent") return "urgent";
  if (p === "client_request" || p === "conversation") return "high";
  return "normal";
}

/** @param {QTask} a @param {QTask} b */
const byLine = (a, b) => (a.queuePos ?? 0) - (b.queuePos ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);

/** The open tasks in line order: placed ones by their place, then the ones
 *  not placed yet, each where its priority puts it, oldest first.
 *  @template {QTask} T @param {T[]} tasks @param {QueueSettings} settings @returns {T[]} */
export function queueOrder(tasks, settings) {
  const open = tasks.filter((t) => t.status !== "done");
  const line = open.filter((t) => t.queuePos != null).sort(byLine);
  const unplaced = open.filter((t) => t.queuePos == null).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  for (const t of unplaced) line.splice(entryIndex(line, settings, t.priority), 0, t);
  return line;
}

/** @param {QTask} t */
const isStarted = (t) => t.queuePos != null && !!t.due && !t.deadline;

/** Where in `line` (open tasks in order) a new task with this priority goes.
 *  @param {QTask[]} line @param {QueueSettings} settings @param {string | undefined} priority */
export function entryIndex(line, settings, priority) {
  const rank = entryRank(priority);
  if (rank === "normal") return line.length;
  const { upNext } = splitLine(line, settings);
  if (!upNext.length) return line.length;
  let at = line.indexOf(upNext[0]);
  if (rank === "high") {
    // Below the urgent ones already at the top of Up next.
    let i = 0;
    while (i < upNext.length && entryRank(upNext[i].priority) === "urgent") i++;
    at = i < upNext.length ? line.indexOf(upNext[i]) : line.length;
  }
  return at;
}

/** @template {QTask} T @param {T[]} line @param {QueueSettings} settings @returns {{ now: T[]; waiting: T[]; upNext: T[] }} */
function splitLine(line, settings) {
  const waiting = line.filter(isQueueWaiting);
  const free = line.filter((t) => !isQueueWaiting(t));
  const now = free.filter(isStarted);
  for (const t of free) {
    if (now.length >= settings.now) break;
    if (!now.includes(t)) now.push(t);
  }
  now.sort((a, b) => line.indexOf(a) - line.indexOf(b));
  const upNext = free.filter((t) => !now.includes(t));
  return { now, waiting, upNext };
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". @param {number} n */
export function ordinal(n) {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th";
  return `${n}${s}`;
}

/** The list as the queue shows it: Now, Waiting, Up next ("2nd", "3rd"...,
 *  counted after the Now tasks) and done, newest finished first.
 *  @template {QTask} T @param {T[]} tasks @param {QueueSettings} settings
 *  @returns {{ now: T[]; waiting: T[]; done: T[]; upNext: { task: T; place: number; label: string }[] }} */
export function groupQueue(tasks, settings) {
  const line = queueOrder(tasks, settings);
  const { now, waiting, upNext } = splitLine(line, settings);
  const done = tasks.filter((t) => t.status === "done");
  return {
    now, waiting, done,
    upNext: upNext.map((task, i) => ({ task, place: now.length + i + 1, label: ordinal(now.length + i + 1) })),
  };
}

/** What the client's portal says of each open task on a queue list: "now"
 *  (being done, or with a teammate or them) or "line" with its place, "2nd",
 *  "3rd"... A task on its way through the line has no date to show. The line
 *  is worked out over the whole list; the places are counted over the tasks
 *  the client can see, so a private task leaves no gap.
 *  @param {QTask[]} tasks @param {QueueSettings} settings @param {(t: QTask) => boolean} [visible]
 *  @returns {Map<string, { queue: "now" | "line"; place: string | null }>} */
export function portalQueueMarks(tasks, settings, visible = () => true) {
  const g = groupQueue(tasks, settings);
  /** @type {Map<string, { queue: "now" | "line"; place: string | null }>} */
  const out = new Map();
  for (const t of [...g.now, ...g.waiting]) if (visible(t)) out.set(t.id, { queue: "now", place: null });
  const shownNow = g.now.filter(visible).length;
  g.upNext.filter((u) => visible(u.task)).forEach((u, i) => out.set(u.task.id, { queue: "line", place: ordinal(shownNow + i + 1) }));
  return out;
}

/** Ids of the tasks waiting in line (Up next): kept off the main task list.
 *  @param {QTask[]} tasks @param {QueueSettings} settings @returns {Set<string>} */
export function upNextIds(tasks, settings) {
  return new Set(groupQueue(tasks, settings).upNext.map((u) => u.task.id));
}

// --- positions ---------------------------------------------------------------

/** A place between two others, or null when there is no room (renumber).
 *  @param {number | null} prev @param {number | null} next */
export function placeBetween(prev, next) {
  if (prev == null && next == null) return POS_STEP;
  if (prev == null) return /** @type {number} */ (next) - POS_STEP;
  if (next == null) return prev + POS_STEP;
  const mid = Math.floor((prev + next) / 2);
  return mid > prev && mid < next ? mid : null;
}

/** Which places to keep: the longest increasing run (n is a list's worth).
 *  @param {(number | null)[]} pos @returns {boolean[]} */
function longestInOrder(pos) {
  const len = pos.map(() => 0);
  const from = pos.map(() => -1);
  let best = -1;
  for (let i = 0; i < pos.length; i++) {
    const pi = pos[i];
    if (pi == null) continue;
    len[i] = 1;
    for (let j = 0; j < i; j++) {
      const pj = pos[j];
      if (pj != null && pj < pi && len[j] + 1 > len[i]) { len[i] = len[j] + 1; from[i] = j; }
    }
    if (best < 0 || len[i] > len[best]) best = i;
  }
  const keep = pos.map(() => false);
  for (let i = best; i >= 0; i = from[i]) keep[i] = true;
  return keep;
}

/** Places for `ordered` (the whole open line, in order) that keep every task
 *  already placed where it is when it can: only the tasks whose place is
 *  missing or out of order are written. Renumbers everything when that is
 *  the only way.
 *  @param {QTask[]} ordered @returns {QPatch[]} */
export function placesFor(ordered) {
  /** @type {QPatch[]} */
  const out = [];
  /** @type {(number | null)[]} */
  const pos = ordered.map((t) => t.queuePos ?? null);
  // Keep the longest run already in order (fewest writes), move the rest.
  const keep = longestInOrder(pos);
  for (let i = 0; i < ordered.length; i++) {
    if (keep[i]) continue;
    const prev = i > 0 ? /** @type {number} */ (pos[i - 1]) : null;
    let j = i + 1;
    while (j < ordered.length && !keep[j]) j++;
    const next = j < ordered.length ? /** @type {number} */ (pos[j]) : null;
    const p = placeBetween(prev, next);
    if (p == null) return ordered.map((t, k) => ({ id: t.id, queuePos: (k + 1) * POS_STEP })).filter((x, k) => ordered[k].queuePos !== x.queuePos);
    pos[i] = p;
    out.push({ id: ordered[i].id, queuePos: p });
  }
  return out;
}

// --- what the queue changes --------------------------------------------------

/** After anything that may have emptied a Now slot (a task finished, went to
 *  waiting, moved out, was deleted): the tasks that become Now and the date
 *  each gets, today plus the spacing in business days. A deadline keeps its
 *  own date. A task not placed yet is placed on the way.
 *  @param {QTask[]} tasks @param {QueueSettings} settings @param {string} today @returns {QPatch[]} */
export function queuePromotions(tasks, settings, today) {
  const line = queueOrder(tasks, settings);
  const { now } = splitLine(line, settings);
  const due = addBusinessDaysIso(today, settings.spacing);
  // Tasks not placed yet are placed on the way (where they already show).
  /** @type {Map<string, QPatch>} */
  const out = new Map(placesFor(line).map((p) => [p.id, p]));
  for (const t of now) {
    if (isStarted(t) || t.deadline) continue;
    out.set(t.id, { ...(out.get(t.id) ?? { id: t.id }), due, queueSavedDue: null });
  }
  return [...out.values()];
}

/** Turning the queue on: every open task lined up by due date (no date last,
 *  then the order they were made). The first N not waiting keep their dates;
 *  the rest have them saved and cleared, except deadlines, which keep theirs,
 *  and tasks waiting on someone, which keep their check in date.
 *  @param {QTask[]} tasks @param {QueueSettings} settings @returns {QPatch[]} */
export function queueOnPatches(tasks, settings) {
  const open = tasks.filter((t) => t.status !== "done")
    .sort((a, b) => (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99") || String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  let kept = 0;
  return open.map((t, i) => {
    /** @type {QPatch} */
    const p = { id: t.id, queuePos: (i + 1) * POS_STEP };
    if (isQueueWaiting(t)) return p;
    if (kept < settings.now) { kept++; return p; }
    if (t.deadline || !t.due) return p;
    p.queueSavedDue = t.due;
    p.due = null;
    return p;
  });
}

/** Turning the queue off: every saved date comes back. Places stay, unused.
 *  @param {QTask[]} tasks @returns {QPatch[]} */
export function queueOffPatches(tasks) {
  return tasks.filter((t) => t.status !== "done" && t.queueSavedDue).map((t) => ({ id: t.id, due: t.queueSavedDue ?? null, queueSavedDue: null }));
}

/** A task coming into a queue list (made there, moved there, a repeat's next
 *  copy): where its priority puts it, its date saved and cleared unless it is
 *  a deadline. `bottom` puts it last whatever its priority (a repeat's copy).
 *  The Now check after the move gives it a date if it lands in Now.
 *  @param {QTask[]} listTasks the list's tasks before it arrives
 *  @param {QueueSettings} settings @param {QTask} task @param {{ bottom?: boolean }} [opts]
 *  @returns {{ self: QPatch; others: QPatch[] }} */
export function queueEntry(listTasks, settings, task, opts = {}) {
  const line = queueOrder(listTasks.filter((t) => t.id !== task.id), settings);
  const at = opts.bottom ? line.length : entryIndex(line, settings, task.priority);
  const arriving = { ...task, queuePos: null };
  const ordered = [...line.slice(0, at), arriving, ...line.slice(at)];
  const places = placesFor(ordered);
  const own = places.find((p) => p.id === task.id);
  /** @type {QPatch} */
  const self = { id: task.id, queuePos: own?.queuePos ?? null };
  if (!task.deadline && task.due) { self.queueSavedDue = task.due; self.due = null; }
  return { self, others: places.filter((p) => p.id !== task.id) };
}

/** A task leaving a queue list: its place is kept, unused, and its saved date
 *  comes back.
 *  @param {QTask} task @returns {QPatch | null} */
export function queueExit(task) {
  if (!task.queueSavedDue) return null;
  return { id: task.id, due: task.due ?? task.queueSavedDue, queueSavedDue: null };
}

/** Dragging `id` to just before `beforeId` (null: the end of the line). The
 *  order is the person's: Now is then the first N not waiting, strictly, so
 *  a task dragged above the Now one takes its place. One that leaves Now has
 *  its date saved and cleared (a deadline keeps its own); one that arrives
 *  gets today plus the spacing.
 *  @param {QTask[]} tasks @param {QueueSettings} settings @param {string} id @param {string | null} beforeId @param {string} today
 *  @returns {QPatch[]} */
export function queueMove(tasks, settings, id, beforeId, today) {
  const line = queueOrder(tasks, settings);
  const moving = line.find((t) => t.id === id);
  if (!moving || id === beforeId) return [];
  const rest = line.filter((t) => t.id !== id);
  const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : rest.length;
  const ordered = [...rest.slice(0, at < 0 ? rest.length : at), moving, ...rest.slice(at < 0 ? rest.length : at)];
  /** @type {Map<string, QPatch>} */
  const out = new Map();
  const put = (/** @type {QPatch} */ p) => out.set(p.id, { ...(out.get(p.id) ?? { id: p.id }), ...p });
  // Placed tasks around it stay put; only it moves (or a renumber).
  const unmoved = ordered.map((t) => (t.id === id ? { ...t, queuePos: null } : t));
  for (const p of placesFor(unmoved)) put(p);
  const placed = ordered.map((t) => ({ ...t, queuePos: out.get(t.id)?.queuePos ?? t.queuePos }));
  const wasNow = new Set(splitLine(line, settings).now.map((t) => t.id));
  const free = placed.filter((t) => !isQueueWaiting(t));
  const nowIds = new Set(free.slice(0, settings.now).map((t) => t.id));
  const due = addBusinessDaysIso(today, settings.spacing);
  for (const t of free) {
    if (wasNow.has(t.id) && !nowIds.has(t.id) && !t.deadline && t.due) put({ id: t.id, due: null, queueSavedDue: t.due });
    if (!wasNow.has(t.id) && nowIds.has(t.id) && !t.deadline && !isStarted(t)) put({ id: t.id, due, queueSavedDue: null });
  }
  return [...out.values()];
}

/** Moves `id` to the top of Up next ("Move it up" on a deadline warning).
 *  @param {QTask[]} tasks @param {QueueSettings} settings @param {string} id @param {string} today */
export function queueMoveUp(tasks, settings, id, today) {
  const { upNext } = groupQueue(tasks, settings);
  const first = upNext.find((u) => u.task.id !== id)?.task ?? null;
  if (!first || upNext[0]?.task.id === id) return [];
  return queueMove(tasks, settings, id, first.id, today);
}

/** Deadlines the line would miss at this pace: each Now slot frees on its
 *  task's due date (today when it has none or it has passed), and each task
 *  in line lands spacing business days after the slot it takes.
 *  @param {QTask[]} tasks @param {QueueSettings} settings @param {string} today
 *  @returns {{ id: string; title: string; deadline: string; lands: string }[]} */
export function deadlineWarnings(tasks, settings, today) {
  const { now, upNext } = groupQueue(tasks, settings);
  const slots = now.map((t) => (t.due && t.due > today ? t.due : today));
  while (slots.length < settings.now) slots.push(today);
  const out = [];
  for (const { task } of upNext) {
    slots.sort();
    const lands = addBusinessDaysIso(/** @type {string} */ (slots[0]), settings.spacing);
    slots[0] = lands;
    if (task.deadline && task.due && lands > task.due) out.push({ id: task.id, title: task.title, deadline: task.due, lands });
  }
  return out;
}

// --- stores ------------------------------------------------------------------

/** @typedef {{ queue: (projectId: string) => Promise<unknown>; tasks: (projectId: string) => Promise<QTask[] | null>; write: (p: QPatch) => Promise<unknown> }} QueueStore */

/** The Now check, server side: reads the list, gives the next task its turn.
 *  Quiet when the list has no queue or the database has no queue columns.
 *  @param {QueueStore} store @param {string | null | undefined} projectId @param {string} [today]
 *  @returns {Promise<QPatch[]>} */
export async function promoteQueueStore(store, projectId, today = pacificToday()) {
  if (!projectId) return [];
  try {
    const settings = queueSettings(await store.queue(projectId));
    if (!settings) return [];
    const tasks = await store.tasks(projectId);
    if (!tasks) return [];
    const patches = queuePromotions(tasks, settings, today);
    for (const p of patches) await store.write(p);
    return patches;
  } catch {
    return [];
  }
}

/** The bottom of the line for a repeat's next copy, server side: its place,
 *  or null when the list has no queue.
 *  @param {QueueStore} store @param {string | null | undefined} projectId @returns {Promise<number | null>} */
export async function bottomPlaceStore(store, projectId) {
  if (!projectId) return null;
  try {
    if (!queueSettings(await store.queue(projectId))) return null;
    const tasks = await store.tasks(projectId);
    if (!tasks) return null;
    const max = tasks.reduce((m, t) => (t.queuePos != null && t.queuePos > m ? t.queuePos : m), 0);
    return max + POS_STEP;
  } catch {
    return null;
  }
}

/** A database row (snake_case) as the queue reads it.
 *  @param {Record<string, any>} r @returns {QTask} */
export function queueTaskFromRow(r) {
  return {
    id: r.id, title: r.title ?? "", status: r.status, due: r.due ?? null, deadline: r.deadline === true,
    queuePos: r.queue_pos ?? null, queueSavedDue: r.queue_saved_due ?? null, createdAt: r.created_at ?? "",
    priority: r.priority ?? "none", assigneeId: r.assignee_id ?? null, waitingOnClient: r.waiting_on_client === true,
    subtasks: Array.isArray(r.subtasks) ? r.subtasks : [],
  };
}
/** The columns queueTaskFromRow reads. */
export const QUEUE_TASK_COLS = "id, title, status, due, deadline, queue_pos, queue_saved_due, created_at, priority, assignee_id, waiting_on_client, subtasks";
/** A patch as database columns. @param {QPatch} p */
export function queuePatchRow(p) {
  /** @type {Record<string, unknown>} */
  const row = {};
  if (p.queuePos !== undefined) row.queue_pos = p.queuePos;
  if (p.due !== undefined) row.due = p.due;
  if (p.queueSavedDue !== undefined) row.queue_saved_due = p.queueSavedDue;
  return row;
}

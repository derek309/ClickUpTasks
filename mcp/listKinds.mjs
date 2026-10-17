// What kind of list a list is (Derek, 2026-10-17, mockup: CUL Tasks/
// lists-finish-repeat-mockup.html). Still called Lists everywhere.
//
//   holds     loose work with no end, like "Tasks". Every list made before
//             this, and the default when nothing says otherwise.
//   finishes  a job with an end: an optional end date, progress ("1 of 5
//             done"), the next due date and an optional queue. Done when every
//             task in it is done: it leaves the client's main view and stays
//             in their history. On a queue, an Up next task comes up to Now on
//             its own 3 weeks before it is needed (queue.mjs pull).
//   repeats   the same steps on a rhythm: a recipe of steps (who, how many
//             business days before the goes out day, and for the client how
//             often to remind), and each round is ONE task made from it, with
//             the step dates counted back from that round's goes out day.
//             Editing the recipe changes the rounds still to come, never one
//             already made.
//
// Kept in projects.plan (jsonb, supabase/list-kinds.sql): null is holds. The
// rules are here, in plain JavaScript, so the app, the server routes and the
// MCP server all read a list the same way (like queue.mjs). Everything is
// pure; makeNextRound at the bottom takes a small store for its reads and
// its one write.

import { needsBy } from "./queue.mjs";

/** @typedef {"holds" | "finishes" | "repeats"} ListKind */
/** @typedef {{ every: "week"; weekday: number } | { every: "2weeks"; weekday: number; from: string } | { every: "month_weekday"; nth: number; weekday: number } | { every: "month_date"; day: number }} Rhythm */
/** @typedef {{ id: string; title: string; who: string; before: number; remind?: "off" | "once" | 2 | 3 | 5 }} RecipeStep */
/** @typedef {{ kind: ListKind; endsOn?: string | null; rhythm?: Rhythm; recipe?: RecipeStep[]; owner?: string | null }} ListPlan */

export const KINDS = /** @type {const} */ (["holds", "finishes", "repeats"]);
export const KIND_ICON = Object.freeze({ holds: "☰", finishes: "◎", repeats: "↻" });
export const KIND_LABEL = Object.freeze({ holds: "Holds work", finishes: "Finishes", repeats: "Repeats" });
export const KIND_HINT = Object.freeze({
  holds: "Loose tasks, no end. Like \"Tasks\".",
  finishes: "A job with an end date. Like a launch.",
  repeats: "Same steps every week or month. Like a newsletter.",
});
/** A new repeating list goes out monthly, the first Thursday, until it is changed. */
export const DEFAULT_RHYTHM = Object.freeze({ every: "month_weekday", nth: 1, weekday: 4 });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CLAUDE_ID = "u_claude";

// --- reading a plan ------------------------------------------------------------

/** @param {unknown} v @param {number} lo @param {number} hi @param {number} d */
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** A rhythm, brought into range, or the default.
 *  @param {unknown} raw @returns {Rhythm} */
export function rhythmOf(raw) {
  const r = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const weekday = int(r.weekday, 0, 6, 4);
  if (r.every === "week") return { every: "week", weekday };
  if (r.every === "2weeks") return { every: "2weeks", weekday, from: typeof r.from === "string" && ISO.test(r.from) ? r.from : "2026-01-01" };
  if (r.every === "month_date") return { every: "month_date", day: int(r.day, 1, 31, 1) };
  return { every: "month_weekday", nth: int(r.nth, 1, 5, DEFAULT_RHYTHM.nth), weekday: r.weekday == null ? DEFAULT_RHYTHM.weekday : weekday };
}

/** @param {unknown} raw @returns {RecipeStep[]} */
function recipeOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => s && typeof s === "object" && typeof s.title === "string" && s.title.trim()).map((s, i) => {
    const remind = s.remind === "off" || s.remind === "once" ? s.remind : [2, 3, 5].includes(Number(s.remind)) ? /** @type {2 | 3 | 5} */ (Number(s.remind)) : undefined;
    return {
      id: typeof s.id === "string" && s.id ? s.id : `r${i + 1}`,
      title: s.title.trim(),
      who: typeof s.who === "string" && s.who ? s.who : "owner",
      before: int(s.before, 0, 60, 0),
      ...(remind !== undefined ? { remind } : {}),
    };
  });
}

/** The list's plan. Missing, null or unreadable is "holds work", which is
 *  every list made before list kinds.
 *  @param {unknown} raw @returns {ListPlan} */
export function listPlan(raw) {
  if (!raw || typeof raw !== "object") return { kind: "holds" };
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.kind === "finishes") return { kind: "finishes", endsOn: typeof r.endsOn === "string" && ISO.test(r.endsOn) ? r.endsOn : null };
  if (r.kind === "repeats") return { kind: "repeats", rhythm: rhythmOf(r.rhythm), recipe: recipeOf(r.recipe), owner: typeof r.owner === "string" ? r.owner : null };
  return { kind: "holds" };
}
/** @param {unknown} raw @returns {ListKind} */
export const listKind = (raw) => listPlan(raw).kind;

// --- dates -----------------------------------------------------------------------

/** @param {string} iso @param {number} days */
export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
/** @param {string} iso */
const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
/** `days` business days before `iso` (weekends skipped; 0 is the day itself).
 *  @param {string} iso @param {number} days */
export function businessDaysBefore(iso, days) {
  let out = iso;
  for (let left = days; left > 0;) {
    out = addDaysIso(out, -1);
    const d = dow(out);
    if (d !== 0 && d !== 6) left--;
  }
  return out;
}
/** @param {number} y @param {number} m 1 based */
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
/** The nth weekday of a month (nth 5 is the last one).
 *  @param {number} y @param {number} m 1 based @param {number} nth @param {number} weekday */
export function nthWeekday(y, m, nth, weekday) {
  if (nth >= 5) {
    const last = daysIn(y, m);
    const lastDow = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
    return `${y}-${pad(m)}-${pad(last - ((lastDow - weekday + 7) % 7))}`;
  }
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return `${y}-${pad(m)}-${pad(1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7)}`;
}

/** The first goes out day on the rhythm strictly after `after`.
 *  @param {Rhythm} rhythm @param {string} after @returns {string} */
export function nextGoesOut(rhythm, after) {
  if (rhythm.every === "week" || rhythm.every === "2weeks") {
    let d = addDaysIso(after, 1);
    d = addDaysIso(d, (rhythm.weekday - dow(d) + 7) % 7);
    if (rhythm.every === "2weeks") {
      // Every other week counted from its first goes out day.
      const weeks = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${rhythm.from}T00:00:00Z`)) / (7 * 86_400_000));
      if (((weeks % 2) + 2) % 2 === 1) d = addDaysIso(d, 7);
    }
    return d;
  }
  let [y, m] = after.split("-").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = rhythm.every === "month_date"
      ? `${y}-${pad(m)}-${pad(Math.min(rhythm.day, daysIn(y, m)))}`
      : nthWeekday(y, m, rhythm.nth, rhythm.weekday);
    if (d > after) return d;
    m++; if (m > 12) { m = 1; y++; }
  }
  return addDaysIso(after, 31);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = ["", "first", "second", "third", "fourth", "last"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1st", "2nd", "3rd", "15th". @param {number} n */
const ordinal = (n) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th"}`; };
/** "Oct 22" @param {string} iso */
const short = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };

/** How often, in a word: "Weekly", "Every 2 weeks", "Monthly". @param {Rhythm} r */
export const rhythmWord = (r) => (r.every === "week" ? "Weekly" : r.every === "2weeks" ? "Every 2 weeks" : "Monthly");
/** When it goes out: "on Thursday", "the third Thursday", "on the 15th". @param {Rhythm} r */
export function goesOutWords(r) {
  if (r.every === "month_weekday") return `the ${NTH[r.nth]} ${WEEKDAY_NAMES[r.weekday]}`;
  if (r.every === "month_date") return `on the ${ordinal(r.day)}`;
  return `on ${WEEKDAY_NAMES[r.weekday]}`;
}
/** "repeats monthly, goes out the third Thursday". @param {Rhythm} r */
export const rhythmSentence = (r) => `repeats ${rhythmWord(r).toLowerCase()}, goes out ${goesOutWords(r)}`;

// --- rounds ----------------------------------------------------------------------

/** A round's task id: one per list and goes out day, so the same round can
 *  never be made twice (a second insert is refused by the primary key).
 *  @param {string} projectId @param {string} goesOut */
export const roundId = (projectId, goesOut) => `t_rd_${projectId}_${goesOut.replace(/-/g, "")}`;
/** The goes out day of a round task on this list, or null for any other task.
 *  @param {string} taskId @param {string} projectId */
export function roundGoesOut(taskId, projectId) {
  const pre = `t_rd_${projectId}_`;
  if (!taskId.startsWith(pre)) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(taskId.slice(pre.length));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** "October" for a monthly round, "Oct 22" for a weekly one; the year when it
 *  is not this one. @param {Rhythm} rhythm @param {string} goesOut @param {string} [today] */
export function roundLabel(rhythm, goesOut, today) {
  const [y, m] = goesOut.split("-").map(Number);
  const year = today && Number(today.slice(0, 4)) !== y ? ` ${y}` : "";
  return rhythm.every === "week" || rhythm.every === "2weeks" ? `${short(goesOut)}${year}` : `${MONTH_NAMES[m - 1]}${year}`;
}
/** "Stores newsletter: October". @param {string} listName @param {Rhythm} rhythm @param {string} goesOut @param {string} [today] */
export const roundTitle = (listName, rhythm, goesOut, today) => `${listName.trim()}: ${roundLabel(rhythm, goesOut, today)}`;

/** Each step's due date for the round that goes out on `goesOut`: counted
 *  back in business days. @param {RecipeStep[]} recipe @param {string} goesOut */
export const roundDates = (recipe, goesOut) => recipe.map((s) => ({ ...s, due: businessDaysBefore(goesOut, s.before) }));
/** When the round starts: its earliest step. @param {RecipeStep[]} recipe @param {string} goesOut */
export const roundStart = (recipe, goesOut) => (recipe.length ? businessDaysBefore(goesOut, Math.max(...recipe.map((s) => s.before))) : goesOut);

/** The goes out day of the next round to make, or null when there is
 *  nothing to make: a round is still open, or there is no recipe. After the
 *  last round made, the next day on the rhythm that has not gone by; a list
 *  with no rounds yet starts with the first one it still has time for (its
 *  first step not before today).
 *  @param {ListPlan} plan @param {{ goesOut: string; open: boolean }[]} rounds every round made, done, open or deleted
 *  @param {string} today @returns {string | null} */
export function nextRoundGoesOut(plan, rounds, today) {
  if (plan.kind !== "repeats" || !plan.recipe?.length || !plan.rhythm) return null;
  if (rounds.some((r) => r.open)) return null;
  const last = rounds.map((r) => r.goesOut).sort().pop() ?? null;
  let d = nextGoesOut(plan.rhythm, last && last >= addDaysIso(today, -1) ? last : addDaysIso(today, -1));
  for (let i = 0; i < 60; i++) {
    if (last || roundStart(plan.recipe, d) >= today) return d;
    d = nextGoesOut(plan.rhythm, d);
  }
  return d;
}

/** The round as a tasks row (snake_case, for the server's insert). Each step's
 *  who: the list's owner ("owner" or their own id), a teammate, Claude or
 *  "client" (the client's turn, reminded as the recipe says). The task's date
 *  is its first step's; a due date never sets a follow up.
 *  @param {{ id: string; client_id: string; name: string }} project @param {ListPlan} plan @param {string} goesOut
 *  @param {{ rid: (prefix: string) => string; now: string; today?: string }} o */
export function roundRow(project, plan, goesOut, o) {
  const recipe = plan.recipe ?? [];
  const rhythm = plan.rhythm ?? rhythmOf(null);
  const owner = plan.owner ?? recipe.find((s) => s.who !== "client" && s.who !== "owner" && s.who !== CLAUDE_ID)?.who ?? null;
  const steps = roundDates(recipe, goesOut).map((s, i) => {
    const who = s.who === "owner" ? owner : s.who;
    /** @type {Record<string, unknown>} */
    const step = { id: o.rid("s_"), title: s.title, done: false, due: s.due };
    if (who === "client") {
      step.onClient = true;
      // No choice is the app's own default for a client's step with a date
      // (it reminds, lib/clientRequests); off is the one way to stop it.
      if (s.remind === "off") step.remind = { off: true };
      else if (s.remind) step.remind = { every: s.remind };
    } else if (who && who !== owner) {
      step.assigneeId = who;
      if (owner) step.givenBy = owner;
    }
    if (i === 0) step.startedAt = o.now;
    return step;
  });
  const first = /** @type {Record<string, unknown> | undefined} */ (steps[0]);
  const firstOnClient = first?.onClient === true;
  const firstTheirs = !!first?.assigneeId;
  return {
    id: roundId(project.id, goesOut),
    project_id: project.id,
    client_id: project.client_id,
    title: roundTitle(project.name, rhythm, goesOut, o.today),
    description: "",
    status: firstOnClient ? "waiting" : firstTheirs ? "delegated" : "todo",
    waiting_on_client: firstOnClient,
    priority: "normal",
    assignee_id: owner,
    contact_id: project.client_id.startsWith("cl_") ? project.client_id.slice(3) : null,
    due: /** @type {string | null} */ (first?.due ?? goesOut),
    recurrence: "none",
    label_ids: [],
    subtasks: steps,
    attachments: [],
    comments: [],
    is_private: false,
    created_by: owner,
    delegated_to: [...new Set(steps.map((s) => s.assigneeId).filter((id) => typeof id === "string" && id !== owner))],
  };
}

/** @typedef {{ plan: (projectId: string) => Promise<{ project: { id: string; client_id: string; name: string }; plan: unknown } | null>; rounds: (projectId: string) => Promise<{ id: string; status: string; deleted_at?: string | null }[] | null>; insert: (row: Record<string, unknown>) => Promise<"made" | "exists"> }} RoundStore */

/** Makes the list's next round when it is time: no round open, a recipe to
 *  make it from. At most one, and never the same round twice (its id is the
 *  list and goes out day). Quiet on any error.
 *  @param {RoundStore} store @param {string} projectId @param {{ today: string; now: string; rid: (prefix: string) => string }} o
 *  @returns {Promise<{ made: string | null; goesOut: string | null }>} */
export async function makeNextRound(store, projectId, o) {
  try {
    const got = await store.plan(projectId);
    if (!got) return { made: null, goesOut: null };
    const plan = listPlan(got.plan);
    const tasks = await store.rounds(projectId);
    if (!tasks) return { made: null, goesOut: null };
    const rounds = tasks.map((t) => ({ goesOut: roundGoesOut(t.id, projectId), open: t.status !== "done" && !t.deleted_at }))
      .filter((r) => !!r.goesOut).map((r) => ({ goesOut: /** @type {string} */ (r.goesOut), open: r.open }));
    const goesOut = nextRoundGoesOut(plan, rounds, o.today);
    if (!goesOut) return { made: null, goesOut: null };
    const row = roundRow(got.project, plan, goesOut, o);
    const res = await store.insert(row);
    return { made: res === "made" ? /** @type {string} */ (row.id) : null, goesOut };
  } catch {
    return { made: null, goesOut: null };
  }
}

// --- a list's standing -------------------------------------------------------------

/** @typedef {{ id: string; title?: string; status: string; due: string | null; deadline?: boolean; subtasks?: { onClient?: boolean; done?: boolean; due?: string | null; fromClient?: boolean }[] }} KTask */

/** "1 of 5 done". @param {KTask[]} tasks */
export function progress(tasks) {
  return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
}
/** A finishing list is done when it has tasks and every one is done.
 *  @param {ListPlan} plan @param {KTask[]} tasks */
export const isFinished = (plan, tasks) => plan.kind === "finishes" && tasks.length > 0 && tasks.every((t) => t.status === "done");
/** The soonest date among the open tasks: a due date, or a client step's need by.
 *  @param {KTask[]} tasks @returns {string | null} */
export function nextDueOf(tasks) {
  const dates = tasks.filter((t) => t.status !== "done").flatMap((t) => [t.due, needsBy(/** @type {any} */ (t))]).filter((d) => typeof d === "string");
  return dates.length ? /** @type {string} */ (dates.sort()[0]) : null;
}
/** The open tasks due or needed after the list's end date: the list will miss it.
 *  @param {ListPlan} plan @param {KTask[]} tasks */
export function missesEnd(plan, tasks) {
  if (plan.kind !== "finishes" || !plan.endsOn) return [];
  const end = plan.endsOn;
  return tasks.filter((t) => t.status !== "done" && [t.due, needsBy(/** @type {any} */ (t))].some((d) => typeof d === "string" && d > end));
}

/** One line on a list for Claude (list_projects, get_client_overview).
 *  @param {unknown} rawPlan @param {KTask[]} tasks @param {string} projectId @param {string} today */
export function planLine(rawPlan, tasks, projectId, today) {
  const plan = listPlan(rawPlan);
  const open = tasks.filter((t) => t.status !== "done");
  if (plan.kind === "finishes") {
    const p = progress(tasks);
    const next = nextDueOf(tasks);
    const miss = missesEnd(plan, tasks);
    return [
      plan.endsOn ? `finishes ${plan.endsOn}` : "finishes (no end date)",
      `${p.done} of ${p.total} done`,
      isFinished(plan, tasks) ? "finished" : next ? `next due ${next}` : "",
      miss.length ? `${miss.length} will miss the end date` : "",
    ].filter(Boolean).join(" · ");
  }
  if (plan.kind === "repeats") {
    const rhythm = plan.rhythm ?? rhythmOf(null);
    const rounds = tasks.map((t) => ({ t, goesOut: roundGoesOut(t.id, projectId) })).filter((r) => r.goesOut);
    const cur = rounds.filter((r) => r.t.status !== "done").sort((a, b) => String(a.goesOut).localeCompare(String(b.goesOut)))[0];
    const next = cur ? null : nextRoundGoesOut(plan, rounds.map((r) => ({ goesOut: /** @type {string} */ (r.goesOut), open: false })), today);
    return [
      rhythmSentence(rhythm),
      `${plan.recipe?.length ?? 0} step recipe`,
      cur ? `this round goes out ${cur.goesOut}` : next ? `next round goes out ${next}` : plan.recipe?.length ? "" : "no recipe yet",
    ].filter(Boolean).join(" · ");
  }
  return `holds work · ${open.length} open`;
}

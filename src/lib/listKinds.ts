// A client's lists at the top of their page (Derek, 2026-10-17, mockup:
// CUL Tasks/lists-finish-repeat-mockup.html): each row's kind, name and one
// line of where it stands, sorted the way the sidebar sorts clients (late
// first, then today, then what's coming, then quiet). The kind's own rules
// are in mcp/listKinds.mjs; this is how the app says them.
import { CLAUDE_ID, TODAY, currentStep, formatDayDate, formatDue, userById, type Project, type Task } from "./data";
import { URGENCY_TIER, compareUrgency, lateAndToday, urgencyKeyFrom, type UrgencyKey } from "./urgency";
import {
  KIND_ICON, isFinished, listPlan, missesEnd, nextDueOf, nextGoesOut, nextRoundGoesOut, progress, rhythmOf, rhythmWord,
  roundGoesOut, roundStart, type ListKind, type ListPlan,
} from "../../mcp/listKinds.mjs";
import { groupQueue, isQueueWaiting, queueSettings } from "../../mcp/queue.mjs";

export type ListRow = {
  project: Project;
  kind: ListKind;
  icon: string;
  /** "Finishes Fri, Feb 26 · 1 of 5 · 2 now, 1 with Chelsea". */
  status: string;
  /** "will miss Feb 26": a task is due after the list's end date. */
  miss: string | null;
  late: number;
  today: number;
  key: UrgencyKey;
  /** Nothing dated to do: shown faded at the bottom of its tier. */
  quiet: boolean;
  finished: boolean;
};

const firstName = (id: string | null | undefined) => (id ? userById(id)?.name.split(" ")[0] ?? null : null);

/** Who a waiting task is with: the client, or the teammate whose turn it is. */
function waitingWith(t: Task, clientFirst: string): string {
  const cur = currentStep(t.subtasks);
  if (t.waitingOnClient || cur?.onClient || cur?.finishWhen === "reply") return clientFirst;
  const who = cur?.assigneeId && cur.assigneeId !== t.assigneeId && cur.assigneeId !== CLAUDE_ID ? cur.assigneeId : null;
  return firstName(who) ?? clientFirst;
}

/** "2 now, 1 with Chelsea": what is being done and who has the rest. */
function nowAndWaiting(p: Project, open: Task[], clientFirst: string, today: string): string {
  const q = queueSettings(p.queue);
  const now = q ? groupQueue(open, q, today).now.length : open.filter((t) => !isQueueWaiting(t)).length;
  const withWho = new Map<string, number>();
  for (const t of open.filter(isQueueWaiting)) { const w = waitingWith(t, clientFirst); withWho.set(w, (withWho.get(w) ?? 0) + 1); }
  return [now ? `${now} now` : "", ...[...withWho].map(([w, n]) => `${n} with ${w}`)].filter(Boolean).join(", ");
}

/** The round task's step that is on now, said with whose it is. */
function roundStepLine(t: Task, clientFirst: string): string | null {
  const cur = currentStep(t.subtasks);
  if (!cur) return null;
  const who = cur.onClient ? clientFirst : firstName(cur.assigneeId ?? t.assigneeId);
  return who && !cur.title.toLowerCase().includes(who.toLowerCase()) ? `${cur.title} (${who})` : cur.title;
}

/** The rounds of a repeating list: the open one, the one after, the ones sent. */
export function roundsOf(p: Project, plan: ListPlan, tasks: Task[], today: string = TODAY) {
  const rounds = tasks.map((t) => ({ task: t, goesOut: roundGoesOut(t.id, p.id) })).filter((r): r is { task: Task; goesOut: string } => !!r.goesOut)
    .sort((a, b) => a.goesOut.localeCompare(b.goesOut));
  const current = rounds.find((r) => r.task.status !== "done") ?? null;
  const past = rounds.filter((r) => r.task.status === "done").reverse();
  const rhythm = plan.rhythm ?? rhythmOf(null);
  const recipe = plan.recipe ?? [];
  // The one after: after the open round, or the next one to be made.
  const nextOut = !recipe.length ? null : current ? nextGoesOut(rhythm, current.goesOut) : nextRoundGoesOut(plan, rounds.map((r) => ({ goesOut: r.goesOut, open: false })), today);
  const next = nextOut ? { goesOut: nextOut, starts: roundStart(recipe, nextOut) } : null;
  return { current, next, past, others: tasks.filter((t) => !roundGoesOut(t.id, p.id)) };
}

/** One list's row. `tasks` is every task on it, done ones too. */
export function listRow(p: Project, tasks: Task[], o: { clientFirst: string; today?: string }): ListRow {
  const today = o.today ?? TODAY;
  const plan = listPlan(p.plan);
  const open = tasks.filter((t) => t.status !== "done");
  const { late, today: dueToday } = lateAndToday(open, today);
  const key = urgencyKeyFrom(open);
  const finished = isFinished(plan, tasks);
  let status = "";
  let miss: string | null = null;
  if (plan.kind === "finishes") {
    const pr = progress(tasks);
    const end = plan.endsOn ? `Finishes ${formatDayDate(plan.endsOn)}` : "Finishes, no end date";
    status = finished ? `Finished · ${pr.done} of ${pr.total}` : [end, `${pr.done} of ${pr.total}`, nowAndWaiting(p, open, o.clientFirst, today)].filter(Boolean).join(" · ");
    if (!finished && plan.endsOn && missesEnd(plan, tasks).length) miss = `will miss ${formatDue(plan.endsOn)}`;
  } else if (plan.kind === "repeats") {
    const r = roundsOf(p, plan, tasks, today);
    const word = rhythmWord(plan.rhythm ?? rhythmOf(null));
    const step = r.current ? roundStepLine(r.current.task, o.clientFirst) : null;
    status = r.current
      ? [word, step ? `this round: ${step}` : "", `goes out ${formatDayDate(r.current.goesOut)}`].filter(Boolean).join(" · ")
      : r.next ? `${word} · next round starts ${formatDayDate(r.next.starts)}` : `${word} · no recipe yet`;
  } else {
    const next = nextDueOf(open);
    status = !open.length ? "Nothing open" : [`${open.length} open`, dueToday ? `${dueToday} today` : next && next > today ? `next ${formatDayDate(next).split(",")[0]}` : ""].filter(Boolean).join(" · ");
  }
  return { project: p, kind: plan.kind, icon: KIND_ICON[plan.kind], status, miss, late, today: dueToday, key, quiet: key.tier >= URGENCY_TIER.noDate, finished };
}

/** A client's lists as their page shows them: the ones still going, sorted
 *  like the sidebar's clients, and the finished ones apart, newest first. */
export function clientListRows(lists: Project[], tasksFor: (projectId: string) => Task[], o: { clientFirst: string; today?: string }) {
  const rows = lists.map((p) => listRow(p, tasksFor(p.id), o));
  const going = rows.filter((r) => !r.finished).sort((a, b) => compareUrgency(a.key, b.key) || a.project.name.localeCompare(b.project.name, undefined, { sensitivity: "base" }));
  const finished = rows.filter((r) => r.finished).sort((a, b) => a.project.name.localeCompare(b.project.name, undefined, { sensitivity: "base" }));
  return { going, finished };
}

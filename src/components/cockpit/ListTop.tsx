"use client";

// The top of an opened list (Derek, 2026-10-17, mockup: CUL Tasks/
// lists-finish-repeat-mockup.html): the way back to the client's lists, the
// list's "…", and for a list with a kind, its master header.
//
//   finishes  "Brian's list, finishes Fri, Feb 26, queue 2 at a time …" with
//             dotted pickers, a progress bar and the next due date. Now,
//             Waiting, Up next and Done follow (the queue view on a queue).
//   repeats   "Brian's list, repeats monthly, goes out the third Thursday …",
//             the recipe (Edit), and the rounds: this one with its steps as
//             small boxes, the next with its start, past ones as sent.
//
// Scrolls with the page: never sticky.

import * as React from "react";
import { CLAUDE_ID, currentStep, formatDayDate, formatDue, userById, type Project, type Task, type User } from "@/lib/data";
import { roundsOf } from "@/lib/listKinds";
import { InlineDate } from "./GroupedList";
import { isPlainLeftClick, taskHref } from "@/lib/navState";
import {
  DEFAULT_RHYTHM, goesOutWords, listPlan, missesEnd, nextDueOf, nextGoesOut, progress, rhythmOf, roundLabel,
  type ListPlan, type RecipeStep, type Rhythm,
} from "../../../mcp/listKinds.mjs";

// A dotted underline drawn as a background: the app colours every border
// (globals.css), and a select draws no text decoration.
const dotted = "cursor-pointer appearance-none [field-sizing:content] rounded-none border-0 bg-transparent bg-[radial-gradient(circle,currentColor_1px,transparent_1.6px)] bg-[length:5px_3px] bg-[position:0_100%] bg-repeat-x px-0.5 pb-0.5 font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = ["first", "second", "third", "fourth", "last"];

export function ListTop({ list, tasks, clientFirst, today, canAdmin, backLabel, onBack, menu, trailing, team, meId, onSetPlan, onSetQueueNow, onOpenTask }: {
  list: Project;
  /** Every task on the list, done ones too. */
  tasks: Task[];
  clientFirst: string;
  today: string;
  canAdmin: boolean;
  backLabel: string;
  onBack: () => void;
  menu: React.ReactNode;
  trailing?: React.ReactNode;
  /** Who a recipe step can be on. */
  team: User[];
  meId: string;
  onSetPlan: (plan: ListPlan) => void;
  onSetQueueNow: (now: number | null) => void;
  onOpenTask: (id: string) => void;
}) {
  const plan = listPlan(list.plan);
  return (
    <div className="bg-background px-4 pt-4 sm:px-5 sm:pt-5">
      <div className="mx-auto max-w-[1280px]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className="-ml-2 inline-flex h-11 min-w-0 items-center gap-1.5 rounded-[5px] px-2 text-[16px] font-semibold text-muted hover:bg-surface hover:text-foreground">
            <span aria-hidden>←</span><span className="min-w-0 truncate">{backLabel}</span>
          </button>
          <span className="ml-auto" />
          {trailing && <span className="hidden items-center gap-1.5 sm:inline-flex">{trailing}</span>}
          {menu}
        </div>
        {plan.kind === "finishes" && <FinishHead list={list} plan={plan} tasks={tasks} clientFirst={clientFirst} canAdmin={canAdmin} onSetPlan={onSetPlan} onSetQueueNow={onSetQueueNow} />}
        {plan.kind === "repeats" && <RepeatHead list={list} plan={plan} tasks={tasks} clientFirst={clientFirst} today={today} canAdmin={canAdmin} team={team} meId={meId} onSetPlan={onSetPlan} onOpenTask={onOpenTask} />}
      </div>
    </div>
  );
}

function Head({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 overflow-hidden rounded-[5px] border bg-surface">
      <div className="px-4 py-4">
        <h2 className="break-words text-[22px] font-semibold">{name}</h2>
        {children}
      </div>
    </section>
  );
}

function FinishHead({ list, plan, tasks, clientFirst, canAdmin, onSetPlan, onSetQueueNow }: {
  list: Project; plan: ListPlan; tasks: Task[]; clientFirst: string; canAdmin: boolean;
  onSetPlan: (plan: ListPlan) => void; onSetQueueNow: (now: number | null) => void;
}) {
  const pr = progress(tasks);
  const next = nextDueOf(tasks);
  const miss = missesEnd(plan, tasks);
  const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
  const nowN = list.queue?.now ?? null;
  return (
    <Head name={list.name}>
      <p className="mt-1 text-[16px] leading-8">
        {clientFirst}&apos;s list, finishes{" "}
        {canAdmin ? (
          <span className="inline-flex align-baseline">
            <InlineDate value={plan.endsOn ?? null} onChange={(d) => onSetPlan({ ...plan, endsOn: d })} onClear={plan.endsOn ? () => onSetPlan({ ...plan, endsOn: null }) : undefined}
              heading="The whole job ends" title="Change the end date" formatValue={formatDayDate} emptyLabel="on no set date"
              className={`${dotted} py-0 hover:bg-transparent`} />
          </span>
        ) : <b>{plan.endsOn ? formatDayDate(plan.endsOn) : "on no set date"}</b>}
        {list.queue !== undefined && (<>
          , {canAdmin ? (
            <select aria-label="Queue" value={nowN ?? 0} onChange={(e) => { const n = Number(e.target.value); onSetQueueNow(n > 0 ? n : null); }} className={dotted}>
              <option value={0}>no queue</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>queue {n} at a time</option>)}
            </select>
          ) : <b>{nowN ? `queue ${nowN} at a time` : "no queue"}</b>}
        </>)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[16px]">
        <span aria-hidden className="h-2 w-32 overflow-hidden rounded-[5px] bg-[var(--border)]"><span className="block h-full bg-emerald-600" style={{ width: `${pct}%` }} /></span>
        <span>{pr.done} of {pr.total} done{next && pr.done < pr.total ? ` · next due ${formatDayDate(next)}` : ""}</span>
        {miss.length > 0 && plan.endsOn && <span className="font-semibold text-red-700 dark:text-red-400">{miss.length === 1 ? "1 task" : `${miss.length} tasks`} will miss {formatDue(plan.endsOn)}</span>}
      </div>
    </Head>
  );
}

/** Who a recipe step is on, in words. */
const whoName = (who: string, clientFirst: string, ownerId: string | null) =>
  who === "client" ? clientFirst : who === "owner" ? userById(ownerId)?.name.split(" ")[0] ?? "The owner" : userById(who)?.name.split(" ")[0] ?? "Someone";
const daysWords = (n: number) => (n === 0 ? "the day it goes out" : `${n} business ${n === 1 ? "day" : "days"} before`);
const remindWords = (r: RecipeStep["remind"]) => (r === "off" ? "no reminders" : r === "once" ? "reminded once" : r ? `reminded every ${r} business days` : null);

function RepeatHead({ list, plan, tasks, clientFirst, today, canAdmin, team, meId, onSetPlan, onOpenTask }: {
  list: Project; plan: ListPlan; tasks: Task[]; clientFirst: string; today: string; canAdmin: boolean; team: User[]; meId: string;
  onSetPlan: (plan: ListPlan) => void; onOpenTask: (id: string) => void;
}) {
  const rhythm = plan.rhythm ?? rhythmOf(DEFAULT_RHYTHM);
  const recipe = plan.recipe ?? [];
  const owner = plan.owner ?? null;
  const [editing, setEditing] = React.useState(false);
  const rounds = React.useMemo(() => roundsOf(list, plan, tasks, today), [list, plan, tasks, today]);
  const setRhythm = (r: Rhythm) => onSetPlan({ ...plan, rhythm: r });

  // "repeats [monthly], goes out [the third Thursday]".
  const everyValue = rhythm.every === "month_date" ? "month_date" : rhythm.every;
  const onEvery = (v: string) => {
    const weekday = "weekday" in rhythm ? rhythm.weekday : 4;
    if (v === "week") setRhythm({ every: "week", weekday });
    else if (v === "2weeks") setRhythm({ every: "2weeks", weekday, from: nextGoesOut({ every: "week", weekday }, today) });
    else if (v === "month_date") setRhythm({ every: "month_date", day: 15 });
    else setRhythm({ every: "month_weekday", nth: 1, weekday });
  };
  return (
    <Head name={list.name}>
      <p className="mt-1 text-[16px] leading-8">
        {clientFirst}&apos;s list, repeats{" "}
        {canAdmin ? (
          <select aria-label="How often" value={everyValue} onChange={(e) => onEvery(e.target.value)} className={dotted}>
            <option value="week">weekly</option>
            <option value="2weeks">every 2 weeks</option>
            <option value="month_weekday">monthly</option>
            <option value="month_date">monthly on a date</option>
          </select>
        ) : <b>{rhythm.every === "week" ? "weekly" : rhythm.every === "2weeks" ? "every 2 weeks" : "monthly"}</b>}
        , goes out{" "}
        {!canAdmin ? <b>{goesOutWords(rhythm)}</b> : rhythm.every === "month_weekday" ? (<>
          the{" "}
          <select aria-label="Which week" value={rhythm.nth} onChange={(e) => setRhythm({ ...rhythm, nth: Number(e.target.value) })} className={dotted}>
            {NTH.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
          </select>{" "}
          <select aria-label="Which day" value={rhythm.weekday} onChange={(e) => setRhythm({ ...rhythm, weekday: Number(e.target.value) })} className={dotted}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select>
        </>) : rhythm.every === "month_date" ? (<>
          on the{" "}
          <select aria-label="Which date" value={rhythm.day} onChange={(e) => setRhythm({ ...rhythm, day: Number(e.target.value) })} className={dotted}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}{d === 1 || d === 21 || d === 31 ? "st" : d === 2 || d === 22 ? "nd" : d === 3 || d === 23 ? "rd" : "th"}</option>)}
          </select>
        </>) : (<>
          on{" "}
          <select aria-label="Which day" value={rhythm.weekday} onChange={(e) => setRhythm(rhythm.every === "2weeks" ? { ...rhythm, weekday: Number(e.target.value), from: nextGoesOut({ every: "week", weekday: Number(e.target.value) }, today) } : { ...rhythm, weekday: Number(e.target.value) })} className={dotted}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select>
        </>)}
      </p>

      <div className="-mx-4 mt-3 border-y bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <b className="text-[16px]">The recipe</b>
          {canAdmin && !editing && <button type="button" onClick={() => setEditing(true)} className="h-11 rounded-[5px] px-2 text-[16px] font-semibold text-accent underline underline-offset-4 hover:opacity-80">Edit</button>}
        </div>
        {editing ? (
          <RecipeForm recipe={recipe} team={team} clientFirst={clientFirst} ownerId={owner ?? meId}
            onSave={(next) => { onSetPlan({ ...plan, recipe: next, owner: owner ?? meId }); setEditing(false); }} onCancel={() => setEditing(false)} />
        ) : recipe.length ? (
          <ol className="mt-1 list-decimal space-y-1 pl-6 text-[16px]">
            {recipe.map((s) => (
              <li key={s.id}><b>{s.title}</b> · {whoName(s.who, clientFirst, owner)}, {daysWords(s.before)}{s.who === "client" && remindWords(s.remind) ? `, ${remindWords(s.remind)}` : ""}</li>
            ))}
          </ol>
        ) : <p className="mt-1 text-[16px] text-muted">No steps yet. {canAdmin ? "Edit adds them; the first round is made once there is one." : ""}</p>}
        {recipe.length > 0 && <p className="mt-2 text-[16px] text-muted">A change here is for the rounds still to come.</p>}
      </div>

      <div className="-mx-4 -mb-4">
        {rounds.current && (() => {
          const t = rounds.current.task;
          const cur = currentStep(t.subtasks);
          return (
            <a href={taskHref(t)} onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); onOpenTask(t.id); }} className="block border-b px-4 py-3 hover:bg-background">
              <b className="block text-[16px]">{roundLabel(rhythm, rounds.current.goesOut, today)} round · goes out {formatDayDate(rounds.current.goesOut)}</b>
              <span className="mt-2 flex flex-wrap gap-1.5">
                {t.subtasks.filter((s) => !s.fromClient).map((s) => (
                  <span key={s.id} className={`rounded-[5px] px-2.5 py-1 text-[16px] ${s.done ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : s.id === cur?.id ? "font-semibold shadow-[inset_0_0_0_2px_#e8a33d]" : "shadow-[inset_0_0_0_1px_var(--border)]"}`}>
                    {s.done ? "✓ " : ""}{s.title}{!s.done && s.due ? ` · ${s.onClient ? "need by " : ""}${formatDayDate(s.due).split(",")[0]}` : ""}
                  </span>
                ))}
              </span>
            </a>
          );
        })()}
        {rounds.next && (
          <p className="border-b px-4 py-3 text-[16px] opacity-75">
            <b>{roundLabel(rhythm, rounds.next.goesOut, today)} round</b> · goes out {formatDayDate(rounds.next.goesOut)} · starts {formatDayDate(rounds.next.starts)}
          </p>
        )}
        {rounds.past.slice(0, 6).map((r) => (
          <a key={r.task.id} href={taskHref(r.task)} onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); onOpenTask(r.task.id); }}
            className="block border-b px-4 py-3 text-[16px] text-muted last:border-b-0 hover:bg-background">
            {roundLabel(rhythm, r.goesOut, today)} round · sent {formatDayDate(r.goesOut)} <span className="text-emerald-700 dark:text-emerald-400">✓</span>
          </a>
        ))}
        {!rounds.current && !rounds.next && !rounds.past.length && <p className="px-4 py-3 text-[16px] text-muted">No rounds yet.</p>}
      </div>
    </Head>
  );
}

let stepSeq = 0;
const newStepId = () => `r${Date.now().toString(36)}${(stepSeq++).toString(36)}`;

function RecipeForm({ recipe, team, clientFirst, ownerId, onSave, onCancel }: {
  recipe: RecipeStep[]; team: User[]; clientFirst: string; ownerId: string;
  onSave: (r: RecipeStep[]) => void; onCancel: () => void;
}) {
  const [steps, setSteps] = React.useState<RecipeStep[]>(() => (recipe.length ? recipe : [{ id: newStepId(), title: "", who: ownerId, before: 2 }]));
  const set = (i: number, patch: Partial<RecipeStep>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) => setSteps((ss) => { const j = i + by; if (j < 0 || j >= ss.length) return ss; const n = [...ss]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const field = "h-11 rounded-[5px] border bg-background px-2 text-[16px] outline-none focus:ring-2 focus:ring-accent";
  const people = [...team.filter((u) => u.id !== CLAUDE_ID), userById(CLAUDE_ID)!];
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(steps.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim() }))); }} className="mt-2 space-y-3">
      {steps.map((s, i) => (
        <div key={s.id} className="rounded-[5px] border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-[16px] font-bold text-muted">{i + 1}</span>
            <input aria-label="Step" value={s.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="What happens, like Write it" className={`${field} min-w-0 flex-1 basis-48`} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[16px]">
            <select aria-label="Who" value={s.who === "owner" ? ownerId : s.who} onChange={(e) => set(i, { who: e.target.value })} className={field}>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              <option value="client">{clientFirst} (the client)</option>
            </select>
            <label className="flex items-center gap-2">
              <input type="number" min={0} max={60} value={s.before} onChange={(e) => set(i, { before: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} className={`${field} w-20 text-center`} />
              business days before
            </label>
            {s.who === "client" && (
              <select aria-label="Reminders" value={s.remind === undefined ? "" : String(s.remind)} onChange={(e) => { const v = e.target.value; set(i, { remind: v === "" ? undefined : v === "off" || v === "once" ? v : (Number(v) as 2 | 3 | 5) }); }} className={field}>
                <option value="">reminded as usual</option>
                <option value="once">reminded once</option>
                <option value="2">every 2 business days</option>
                <option value="3">every 3 business days</option>
                <option value="5">every 5 business days</option>
                <option value="off">no reminders</option>
              </select>
            )}
            <span className="ml-auto flex gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="h-11 w-11 rounded-[5px] border text-muted disabled:opacity-40">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down" className="h-11 w-11 rounded-[5px] border text-muted disabled:opacity-40">↓</button>
              <button type="button" onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))} aria-label="Remove the step" className="h-11 rounded-[5px] border px-3 text-danger">Remove</button>
            </span>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSteps((ss) => [...ss, { id: newStepId(), title: "", who: ownerId, before: 0 }])} className="h-11 rounded-[5px] border bg-surface px-4 text-[16px] font-semibold">+ Add step</button>
        <span className="ml-auto" />
        <button type="button" onClick={onCancel} className="h-11 px-3 text-[16px] font-semibold text-muted hover:text-foreground">Cancel</button>
        <button type="submit" className="h-11 rounded-[5px] bg-foreground px-4 text-[16px] font-semibold text-background">Save</button>
      </div>
    </form>
  );
}

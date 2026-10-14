// Setting up a step (Derek, 2026-10-14): a new step asks three things, one
// line each: whose turn it is, by when, and what the action is. The likely
// answer of the first two is picked already, so one tap on an action is all
// it takes. Used on a step just added (its page opens on it), on a step made
// from Quick step or an Add menu, and in What's next.
//
// Pure: the step, who is looking and today in, choices out.
import { addBusinessDaysIso, CLAUDE_ID, type Subtask } from "./data";

/** A step that already says who, when and what never asks: one from a
 *  template, Claude, the MCP or a client's reply comes set up. Neither does a
 *  step that is done, the client's own waiting step, or a wait on a reply. */
export function setupSkipped(sub: Subtask): boolean {
  if (sub.done || sub.onClient || sub.finishWhen) return true;
  const who = !!sub.assigneeId;
  const when = !!sub.due;
  return who && when && stepHasSomething(sub);
}

/** Anything on the step to work on or from. */
export function stepHasSomething(sub: Subtask): boolean {
  return (sub.holds?.length ?? 0) > 0
    || (sub.todos?.length ?? 0) > 0
    || !!(sub.notes && sub.notes.replace(/<[^>]*>/g, "").trim())
    || !!sub.draftMessage
    || ((sub as { fromEmails?: unknown[] }).fromEmails?.length ?? 0) > 0
    || !!sub.makes
    || (sub.needs?.length ?? 0) > 0
    || !!sub.cloudSession;
}

/** Whose turn, picked already: the step's own person, or you. */
export function preselectWho(sub: Subtask, meId: string | null): string | null {
  if (sub.onClient) return "client";
  return sub.assigneeId ?? meId ?? null;
}

export type WhenKey = "today" | "tomorrow" | "3days" | "week";
export type WhenChoice = { key: WhenKey; label: string; date: string };

/** By when, in business days as the rest of the app counts them. */
export function whenChoices(today: string): WhenChoice[] {
  return [
    { key: "today", label: "Today", date: today },
    { key: "tomorrow", label: "Tomorrow", date: addBusinessDaysIso(today, 1) },
    { key: "3days", label: "In 3 days", date: addBusinessDaysIso(today, 3) },
    { key: "week", label: "Next week", date: addBusinessDaysIso(today, 5) },
  ];
}

/** By when, picked already: the step's own due date, or tomorrow. Claude's
 *  turn is always today. */
export function preselectWhen(sub: Subtask, today: string, who?: string | null): string {
  if (who === CLAUDE_ID) return today;
  return sub.due ?? addBusinessDaysIso(today, 1);
}

/** Which of the choices a date is, or "pick" for any other day. */
export function whenKeyFor(date: string | null, today: string): WhenKey | "pick" | null {
  if (!date) return null;
  return whenChoices(today).find((c) => c.date === date)?.key ?? "pick";
}

/** Teammates most used first: how often each has had a step (on this task
 *  and picked here before), then the team's own order. */
export function rankTeammates(teamIds: string[], counts: Record<string, number>, meId: string | null): string[] {
  return teamIds
    .filter((id) => id !== meId && id !== CLAUDE_ID)
    .map((id, i) => ({ id, i, n: counts[id] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.id);
}

export type WhoChoice = { key: string; kind: "me" | "teammate" | "claude" | "client" | "else" };

/** "Whose turn?": You, up to two teammates, Claude and the client, at most
 *  five, and never four (groups of 3 or 5). With more people than shown, the
 *  last is "Someone else", which opens the full picker. */
export function whoChoices(meId: string | null, teammates: string[], withClient: boolean): WhoChoice[] {
  const base = (k: number, other: boolean): WhoChoice[] => [
    ...(meId ? [{ key: meId, kind: "me" as const }] : []),
    ...teammates.slice(0, k).map((id) => ({ key: id, kind: "teammate" as const })),
    { key: CLAUDE_ID, kind: "claude" as const },
    ...(withClient ? [{ key: "client", kind: "client" as const }] : []),
    ...(other ? [{ key: "else", kind: "else" as const }] : []),
  ];
  const fits = (n: number) => n === 3 || n === 5;
  for (let k = Math.min(2, teammates.length); k >= 0; k--) {
    const list = base(k, teammates.length > k);
    if (fits(list.length)) return list;
  }
  // Four any way it is cut: Someone else makes it five.
  const k = Math.min(2, teammates.length);
  const list = base(k, teammates.length > k);
  if (list.length === 4 && !list.some((c) => c.kind === "else")) return [...list, { key: "else", kind: "else" }];
  if (list.length === 4) return base(Math.max(0, k - 1), true);
  return list;
}

/** What an action already answers: talking to the client is your turn,
 *  today. */
export function impliedBy(actionKey: string, meId: string | null, today: string): { who?: string; when?: string } {
  if (actionKey === "email" || actionKey === "text" || actionKey === "chat") return { ...(meId ? { who: meId } : {}), when: today };
  return {};
}

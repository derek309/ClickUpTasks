// Setting up a step (Derek, 2026-10-14): a new step asks three things, one
// line each: whose turn it is, by when, and what the action is. The likely
// answer of the first two is picked already, so one tap on an action is all
// it takes. Used on a step just added (its page opens on it), on a step made
// from Quick step or an Add menu, and in What's next.
//
// Pure: the step, who is looking and today in, choices out.
import { addBusinessDaysIso, CLAUDE_ID, type Subtask } from "./data";
import { significantWords } from "./nextStepSuggest";
import { isMassSend } from "./stepSuggest";

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

// Three recommended actions (Derek, 2026-10-14: the action area was too much,
// a search box, a suggestion and three rows of nine). "What's the action?"
// shows the find box and three buttons; the full list waits behind "All
// actions" or a typed letter. The three, in order of evidence: the action
// already chosen, the step name's own suggestion (stepSuggest), what the
// context asks for (the What's next suggestion, kept on the step), what steps
// with names like it held before for this client or this person, then
// Directions, To dos and Give to Claude.

/** The fallbacks, in order, when the evidence runs out. */
export const SETUP_FALLBACKS = ["directions", "checklist", "claude"] as const;

/** An action's group, as the full list lays them out. */
export function actionGroup(key: string): "write" | "talk" | "make" | "other" {
  if (key === "directions" || key === "checklist") return "write";
  if (key === "email" || key === "text" || key === "chat" || key === "reviewemail") return "talk";
  if (key === "doc" || key === "image" || key === "page" || key === "page:email" || key === "page:page" || key === "video") return "make";
  return "other";
}

/** One earlier step, as history reads it: the words of its name and the
 *  kinds of work it held. */
export type HistoryStep = { words: string[]; kinds: string[] };

/** What a step held, as action keys: its deliverables, a to-do list, a text. */
export function stepKinds(sub: Pick<Subtask, "holds" | "todos" | "draftMessage" | "pageKind">): string[] {
  const keys = ["doc", "image", "page", "video", "email"];
  // An HTML review is offered as its two kinds (htmlReview.ts PAGE_ACTIONS).
  const out = (sub.holds ?? []).filter((h) => keys.includes(h)).map((h) => (h === "page" ? `page:${sub.pageKind ?? "page"}` : h));
  if ((sub.todos?.length ?? 0) > 0) out.push("checklist");
  if (sub.draftMessage?.channel === "sms") out.push("text");
  return [...new Set(out)];
}

type HistoryTask = { id: string; clientId: string; createdAt?: string; subtasks: Pick<Subtask, "title" | "assigneeId" | "holds" | "todos" | "draftMessage" | "pageKind">[] };
/** The steps history reads, from the tasks already loaded: this client's
 *  other tasks (any step) and your own steps anywhere, the newest tasks first,
 *  only the steps that held something. Built once per task, not per letter. */
export function setupHistory(tasks: HistoryTask[], self: { id: string; clientId: string }, meId: string | null, limit = 300): HistoryStep[] {
  const out: HistoryStep[] = [];
  const recent = tasks.filter((t) => t.id !== self.id).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  for (const t of recent) {
    const sameClient = t.clientId === self.clientId;
    for (const x of t.subtasks ?? []) {
      if (!sameClient && (!meId || x.assigneeId !== meId)) continue;
      const kinds = stepKinds(x);
      if (!kinds.length) continue;
      out.push({ words: [...significantWords(x.title ?? "")], kinds });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** The kinds steps named like this one held, most shared words first: a
 *  step sharing two words counts twice what one sharing one does. */
export function historyKinds(name: string, history: HistoryStep[]): string[] {
  const want = significantWords(name);
  if (!want.size || !history.length) return [];
  const score = new Map<string, number>();
  for (const h of history) {
    const n = h.words.filter((w) => want.has(w)).length;
    if (!n) continue;
    for (const k of h.kinds) score.set(k, (score.get(k) ?? 0) + n);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** The three actions to show, by key: the preset, the name's suggestions
 *  (lead), the context's kind, history, then the fallbacks. Only actions that
 *  are on offer, never the same one twice and never all three from one group;
 *  a campaign, blast, newsletter or bulk step never gets "Email <client>" from
 *  context or history (the name's own suggestion already decides that). */
export function recommendActions(p: {
  preset?: string | null; lead?: string[]; context?: string | null; history?: string[];
  available: string[]; stepName?: string; count?: number;
  /** In place of Directions, To dos, Give to Claude (What's next has its own). */
  fallbacks?: readonly string[];
}): string[] {
  const count = p.count ?? 3;
  const offered = new Set(p.available);
  const mass = isMassSend(p.stepName ?? "");
  const guess = (k: string | null | undefined) => (k && !(mass && k === "email") ? [k] : []);
  const order = [
    ...(p.preset ? [p.preset] : []),
    ...(p.lead ?? []),
    ...guess(p.context),
    ...(p.history ?? []).flatMap(guess),
    ...(p.fallbacks ?? SETUP_FALLBACKS),
  ];
  const seen = new Set<string>();
  const cands = order.filter((k) => (offered.has(k) || k === p.preset) && !seen.has(k) && !!seen.add(k));
  const out = cands.slice(0, count);
  if (out.length === 3 && new Set(out.map(actionGroup)).size === 1) {
    const other = cands.slice(3).find((k) => actionGroup(k) !== actionGroup(out[0]));
    if (other) out[2] = other;
  }
  return out;
}

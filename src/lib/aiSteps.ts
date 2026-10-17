// AI in steps (Derek, 2026-10-17, CUL Tasks/ai-help-mockup.html): Claude
// reads a client's email into a step (or a list of tasks), fills in What's
// next after Done, and writes the client's ask. Claude only suggests: nothing
// is given, sent or saved until a person presses the button.
//
// The rules here are pure, so they read and test without the AI: parsing
// what came back, split or one step, the draft step it makes, the tasks a
// split makes, which of a suggestion or an edit wins, and when to ask again.
// The prompts and the call are server side (aiStepsServer.ts).
import { addBusinessDaysIso, clientEmailText, isJustThanks, type Project, type StepTodo, type Subtask, type Task } from "./data";
import { isAutomaticFromClient } from "./clientConversation";
import { placesFor, POS_STEP, queuePromotions, PULL_DAYS } from "../../mcp/queue.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ── Claude's words ───────────────────────────────────────────────────────────

/** No em or en dashes in anything Claude writes (Derek's rule for all copy):
 *  between words they become a comma, between numbers "to". */
export function stripDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[—–]\s*$/gm, "")
    .replace(/^\s*[—–]\s*/gm, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? stripDashes(v).replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const iso = (v: unknown, today: string) => (typeof v === "string" && ISO.test(v) ? (v < today ? today : v) : null);

/** The JSON the model wrote, with any ```json fence it added. Null when it
 *  is not JSON. */
export function readJson(raw: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim());
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch { return null; }
}

// ── 1. A client email becomes the step ─────────────────────────────────────

/** One thing the client asked for: its date when the email gives one
 *  ("ASAP" is no date, said as ASAP), and its own small checklist. */
export type AiAsk = { title: string; when: string | null; whenLabel: string | null; description: string; parts: string[] };

/** What Claude made of a client's email, kept on the step it came in on
 *  (Subtask.aiSuggest), so it is asked once per email. */
export type AiEmailSuggest = {
  messageId: string;
  /** When it was read. */
  at: string;
  /** The email asks for something. False for a thanks or an FYI. */
  asks: boolean;
  name: string;
  description: string;
  items: AiAsk[];
  /** Whose turn: a choice key (a member id, Claude's id, "client"). */
  who: string | null;
  due: string | null;
  why: string;
  /** Each item needs its own design, approval or person (Claude's call). */
  ownWork: boolean;
  /** The list a split goes in: an existing list of the client's by name, or a new name. */
  list: string;
  /** Hidden for this email (No thanks). */
  dismissed?: boolean;
  /** The draft step Use this made. */
  usedStepId?: string;
  /** The tasks a split made: "Made from this email". */
  made?: { id: string; title: string }[];
};

/** Reads the model's answer into a suggestion, every field checked: dates
 *  never before today, whose turn only one of the choices, dashes gone. */
export function parseEmailSuggestion(j: Record<string, unknown> | null, o: { messageId: string; today: string; choices: string[]; now?: string }): AiEmailSuggest | null {
  if (!j) return null;
  const items: AiAsk[] = (Array.isArray(j.items) ? j.items : []).slice(0, 12).flatMap((x): AiAsk[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const title = str(r.title, 140);
    if (!title) return [];
    const when = iso(r.date, o.today);
    const asap = /asap|now|today/i.test(typeof r.when === "string" ? r.when : "");
    const whenLabel = when ? shortDate(when) : asap ? "ASAP" : str(r.when, 20) || null;
    const parts = (Array.isArray(r.parts) ? r.parts : []).map((p) => str(p, 120)).filter(Boolean).slice(0, 6);
    return [{ title, when, whenLabel, description: str(r.description, 400), parts }];
  });
  const asks = j.asks !== false && items.length > 0;
  const who = typeof j.who === "string" && o.choices.includes(j.who) ? j.who : null;
  return {
    messageId: o.messageId, at: o.now ?? new Date().toISOString(), asks,
    name: str(j.name, 90), description: str(j.description, 600), items,
    who, due: iso(j.due, o.today), why: str(j.why, 200),
    ownWork: j.ownWork === true, list: /^tasks?$/i.test(str(j.list, 60)) ? "" : str(j.list, 60),
  };
}

/** "Dec 4": the item's date as the checklist shows it. */
export function shortDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The items do not all share one date ("ASAP" counts as its own). */
export const differentDates = (items: Pick<AiAsk, "when" | "whenLabel">[]) =>
  new Set(items.map((i) => i.when ?? i.whenLabel ?? "")).size > 1;

/** Split or one step (Derek, 2026-10-17, section 1b): a split is offered when
 *  there are two or more asks with different dates, or each needs its own
 *  design or approval; it is the default when the dates differ. The rule:
 *  same person, same sitting, same date is a checklist; its own date,
 *  design, approval or person is its own task. */
export function splitChoice(s: Pick<AiEmailSuggest, "items" | "ownWork" | "asks">): { offer: boolean; byDefault: boolean } {
  if (!s.asks || s.items.length < 2) return { offer: false, byDefault: false };
  const dates = differentDates(s.items);
  return { offer: dates || s.ownWork, byDefault: dates };
}

/** Claude reads this email: it is open on the step, from a person, and asks
 *  for something (not a plain thanks, an automatic message or a calendar
 *  reply). */
export function emailWorthReading(e: { body: string; subject?: string | null; from?: string | null }, channel: "email" | "sms" | "chat" = "email"): boolean {
  const text = clientEmailText(e.body, e.from ?? null);
  if (!text.trim() || isJustThanks(text)) return false;
  return !isAutomaticFromClient({ channel, subject: e.subject ?? "", body: e.body });
}

/** The step needs Claude to read this email: not read yet for this email.
 *  A suggestion for an older email is read again for the new one. */
export const needsReading = (s: Pick<Subtask, "aiSuggest" | "done">, messageId: string): boolean =>
  !s.done && s.aiSuggest?.messageId !== messageId;

/** The suggestion shows: read, for this email, asking something, not
 *  dismissed and not used yet. */
export const suggestionShows = (s: Pick<Subtask, "aiSuggest" | "done">, messageId: string): boolean =>
  !s.done && !!s.aiSuggest && s.aiSuggest.messageId === messageId && s.aiSuggest.asks && !s.aiSuggest.dismissed && !s.aiSuggest.usedStepId && !s.aiSuggest.made?.length;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A plain paragraph as the step's description (HTML, like every step's notes). */
export const descriptionHtml = (text: string) => text.trim() ? text.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("") : "";

/** An item as a to do: its title and, when the email gives one, its date. */
export const todoTitle = (i: Pick<AiAsk, "title" | "whenLabel">) => (i.whenLabel ? `${i.title} · ${i.whenLabel}` : i.title);

/** Use this: a NEW step after the email's step, as a draft for whoever's
 *  turn it is, so nothing reaches them until Give to. Your own turn is your
 *  own step, live. */
export function draftStepFrom(s: Pick<AiEmailSuggest, "name" | "description" | "items" | "who" | "due" | "messageId">, o: { makeId: () => string; meId: string | null; owner: Partial<Subtask> }): Subtask {
  const todos: StepTodo[] = s.items.map((i) => ({ id: o.makeId(), title: todoTitle(i), done: false }));
  const forOther = !!s.who && s.who !== o.meId;
  return {
    id: o.makeId(), title: s.name.trim() || "Do what the email asks", done: false,
    ...o.owner,
    notes: descriptionHtml(s.description),
    ...(todos.length ? { todos } : {}),
    ...(s.due ? { due: s.due } : {}),
    ...(forOther ? { draftFor: s.who! } : {}),
    addedFor: `ai:${s.messageId}`,
  };
}

/** The list with `step` right after `afterId` (at the end when it is gone). */
export function insertAfter(list: Subtask[], afterId: string, step: Subtask): Subtask[] {
  const at = list.findIndex((x) => x.id === afterId);
  const out = [...list];
  out.splice(at < 0 ? out.length : at + 1, 0, step);
  return out;
}

// ── 1b. A big request becomes its own list ─────────────────────────────────

/** The client's list a split goes in: one whose name matches Claude's pick,
 *  else null for a new one by that name. */
export function listForSplit(projects: Pick<Project, "id" | "name" | "clientId">[], clientId: string, name: string): string | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  return projects.find((p) => p.clientId === clientId && p.name.trim().toLowerCase() === want)?.id ?? null;
}

/** The asks in the order the queue takes them: ASAP first, then by date. */
export const byDate = <T extends Pick<AiAsk, "when" | "whenLabel">>(items: T[]): T[] =>
  [...items].sort((a, b) => (a.when ?? (a.whenLabel === "ASAP" ? "" : "9999")).localeCompare(b.when ?? (b.whenLabel === "ASAP" ? "" : "9999")));

export type SplitPlan = { project: Project | null; projectId: string; tasks: Task[]; others: { id: string; queuePos?: number | null; due?: string | null; queueSavedDue?: string | null }[] };

/** Make N tasks in <list> (section 1b): a "Finishes" list on the client
 *  (ending on the latest date, a queue two at a time with the 21 day pull),
 *  or the existing list picked, and one task per ask in date order. Each
 *  task: its Description and small checklist on step 1, a draft for whoever
 *  makes it; then "You check it" and "<client> approves", titled only. Its
 *  deadline is its date; an ASAP one has none and comes up to Now first. */
export function splitPlan(s: Pick<AiEmailSuggest, "items" | "who" | "due" | "list" | "description">, o: {
  clientId: string; contactId: string | null; listName: string; existingId: string | null; projects: Project[]; listTasks: Task[];
  meId: string; ownerId: string; clientFirst: string; today: string; now: string; makeId: (prefix: string) => string;
}): SplitPlan {
  const items = byDate(s.items);
  const latest = items.map((i) => i.when).filter((d): d is string => !!d).sort().pop() ?? null;
  const kindsReady = o.projects.some((p) => p.plan !== undefined);
  const queueReady = o.projects.some((p) => p.queue !== undefined);
  const existing = o.existingId ? o.projects.find((p) => p.id === o.existingId) ?? null : null;
  const project: Project | null = existing ? null : {
    id: o.makeId("p_"), clientId: o.clientId, name: o.listName.trim() || "From the email", description: "",
    position: o.projects.filter((p) => p.clientId === o.clientId && !p.folderId).length,
    ...(kindsReady ? { plan: { kind: "finishes" as const, endsOn: latest } } : {}),
    ...(queueReady ? { queue: { now: 2, spacing: 3, pull: PULL_DAYS } } : {}),
  };
  const projectId = existing?.id ?? project!.id;
  const queue = existing ? existing.queue ?? null : project!.queue ?? null;
  const who = s.who && s.who !== o.meId ? s.who : null;
  const firstDue = s.due ?? addBusinessDaysIso(o.today, 2);
  const startPos = Math.max(0, ...o.listTasks.filter((t) => t.status !== "done").map((t) => t.queuePos ?? 0));
  const tasks: Task[] = items.map((i, n) => {
    const step1: Subtask = {
      id: o.makeId("s_"), title: i.title, done: false, startedAt: o.now,
      notes: descriptionHtml(i.description || s.description),
      ...(i.parts.length ? { todos: i.parts.map((p) => ({ id: o.makeId("td_"), title: p, done: false })) } : {}),
      ...(who ? { draftFor: who } : {}),
      due: i.when && i.when < firstDue ? i.when : firstDue,
    };
    const later: Subtask[] = [
      { id: o.makeId("s_"), title: "You check it", done: false },
      { id: o.makeId("s_"), title: `${o.clientFirst} approves`, done: false },
    ];
    return {
      id: o.makeId("t_"), projectId, clientId: o.clientId, title: i.title, description: "",
      status: "todo", priority: "normal", assigneeId: o.ownerId, contactId: o.contactId,
      due: i.when ?? firstDue, ...(i.when ? { deadline: true } : {}),
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false,
      subtasks: [step1, ...later], attachments: [], comments: [], createdAt: o.now, createdBy: o.meId,
      ...(queue ? { queuePos: startPos + (n + 1) * POS_STEP } : {}),
    } as Task;
  });
  if (!queue) return { project, projectId, tasks, others: [] };
  // The queue's own rules date the ones that come up to Now and keep each
  // deadline; Up next waits with its "needs it by" date.
  // In line a task has no date until it comes up to Now, unless it is a deadline.
  const lined = tasks.map((t) => (t.deadline ? t : { ...t, due: null }));
  const all = [...o.listTasks, ...lined];
  const patches = [...placesFor(all.filter((t) => t.status !== "done") as never[]), ...queuePromotions(all as never[], queue, o.today)] as SplitPlan["others"];
  const mine = new Set(tasks.map((t) => t.id));
  const placed = lined.map((t) => {
    let out: Task = t;
    for (const p of patches) if (p.id === t.id) out = { ...out, ...(p.queuePos !== undefined ? { queuePos: p.queuePos } : {}), ...(p.due !== undefined ? { due: p.due } : {}) };
    return out;
  });
  return { project, projectId, tasks: placed, others: patches.filter((p) => !mine.has(p.id)) };
}

// ── 2. What's next comes filled in ─────────────────────────────────────────

/** Claude's next step after a Done, kept on the step just done (aiNext), so
 *  reopening What's next does not ask again. */
export type AiNext = { name: string; who: string | null; due: string | null; why: string };

export function parseNext(j: Record<string, unknown> | null, o: { today: string; choices: string[] }): AiNext | null {
  if (!j) return null;
  const name = str(j.name, 90).replace(/[.\s]+$/, "");
  if (!name) return null;
  const who = typeof j.who === "string" && o.choices.includes(j.who) ? j.who : null;
  return { name, who, due: iso(j.due, o.today), why: str(j.why, 160) };
}

/** What the What's next form shows: anything typed or picked wins; then
 *  Claude's suggestion; then the rule's (the instant placeholder while
 *  Claude thinks, and the fallback when it says nothing). */
export function prefill(rule: { name: string; who: string | null; due: string | null }, ai: AiNext | null, edited: { name?: string | null; who?: string | null; due?: string | null }): { name: string; who: string | null; due: string | null; why: string | null } {
  return {
    name: edited.name != null ? edited.name : ai?.name ?? rule.name,
    who: edited.who !== undefined ? edited.who : ai?.who ?? rule.who,
    due: edited.due !== undefined ? edited.due : ai?.due ?? rule.due,
    why: ai && edited.name == null ? ai.why || null : null,
  };
}

// ── 3. Claude writes the client ask ────────────────────────────────────────

/** What we need from the client, and the email asking for it. */
export type AiAsk3 = { need: string; subject: string; body: string; at: string };

export function parseClientAsk(j: Record<string, unknown> | null, now = new Date().toISOString()): AiAsk3 | null {
  if (!j) return null;
  const need = str(j.need, 400);
  const body = typeof j.body === "string" ? stripDashes(j.body).replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
  if (!need && !body) return null;
  return { need, subject: str(j.subject, 120), body: stripSignOffLines(body), at: now };
}

/** The signature is added on its own: a "Thanks, Derek" at the end comes off. */
function stripSignOffLines(text: string): string {
  return text.replace(/(\n\s*)+(thanks( again| so much)?|thank you|many thanks|best( regards)?|kind regards|regards|cheers|talk soon)[,.!]?\s*(\n+\s*[A-Z][\w.' ]{0,40})?\s*$/i, "").trimEnd();
}

/** A client's step offers the ask on its own, as a suggestion line, when it
 *  has no description yet and its email is not written. */
export const offersAskOnItsOwn = (s: Pick<Subtask, "done" | "notes">, emailWritten: boolean): boolean =>
  !s.done && !(s.notes ?? "").replace(/<[^>]+>/g, "").trim() && !emailWritten;

/** The email as the draft's HTML: a paragraph each, lines kept. */
export const askEmailHtml = (body: string) => descriptionHtml(body);

/** The email's sender by first name: "Chelsea Proctor <c@x.com>" and
 *  "Proctor, Chelsea" are Chelsea; an address alone is the fallback. */
export function senderFirst(from: string | null | undefined, fallback: string): string {
  const name = (from ?? "").replace(/<[^>]*>/g, "").replace(/["']/g, "").trim();
  if (!name || name.includes("@")) return fallback;
  const comma = name.match(/^([^,]+),\s*(\S+)/);
  return (comma ? comma[2] : name.split(/\s+/)[0]) || fallback;
}

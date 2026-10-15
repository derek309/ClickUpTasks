// SERVER-ONLY: the client request reminders (lib/clientRequests holds the
// rules). Two runs:
//   morning     the weekday 8 AM job (cron/portal-reminders): every stage,
//               and the expected dates of tasks waiting on a late request
//   follow-on   every 15 minutes through the working day (cron/send-scheduled):
//               only a first ask, so a new request, or the next one about 10
//               minutes after they answered, doesn't wait for tomorrow
// Each email is a scheduled_messages row (smr_req_<stage>_<stepId>_<uuid>),
// queued for review (REMINDERS_REVIEW_ALL): nothing goes until someone
// presses Approve in Reminders. Every reminder for a step answers the first
// one sent for it, so the whole chase is one email thread, and the sent row
// keeps the step (in its id) for the reply to find.
//
// Reads are read only; the only task writes are the expected date moves,
// one task at a time, and a reply's "check it" step (stepsServer).
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { resolveContact, sendScheduledMessageNow } from "./sendMessageServer";
import { resolveNotifyRecipient } from "./waitingNotify";
import { APP_URL } from "./appUrl";
import { draftLinkAsButton } from "./draftLink";
import { CLAUDE_ID, toPacificDate, todayPacific, type Subtask } from "./data";
import { REVIEW_STATUS } from "./portalReminders";
import { reminderQueueStatus } from "./reminderSchedule";
import { stepAskWords, type AskWords } from "./stepReminders";
import { REMINDER_MESSAGE_PREFIX } from "./reviewReminders";
import {
  CLIENT_REMINDER_PREFIXES, REQUEST_PREFIX, comingUpForClient, expectedMove, expectedMoveComment, lastAnswerAt, openCheckIt, orderRequests, parseReminderId,
  planForClient, requestEmail, requestFromTask, requestRowId, requestStepForThread, stageLabel, chasedRequest, daysLate,
  type ClientRequest, type ComingUp, type RequestStage, type StepHistory,
} from "./clientRequests";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Every later reminder for a step goes as a reply in the first one's thread
 *  under that first subject ("Re: We need …"): mail apps split a thread when
 *  the subject changes. The stage still reads in the body's first line.
 *  false sends each with its own stage subject, still threaded by headers. */
export const KEEP_THREAD_SUBJECT = true;

const HISTORY_DAYS = 120;
const TASK_COLS = "id, title, client_id, project_id, assignee_id, due, status, subtasks, updated_at";

type TaskRow = { id: string; title: string; client_id: string; project_id: string | null; assignee_id: string | null; due: string | null; status: string; subtasks: Subtask[] | null; updated_at: string };
export type ReminderRow = { id: string; client_id: string; task_id: string | null; status: string; scheduled_at: string; sent_message_id: string | null; subject: string | null; body?: string | null; created_by?: string | null };

export type ClientState = { clientId: string; requests: ClientRequest[]; checkItOpen: boolean; answeredAt: string | null; tasks: TaskRow[] };

/** Open, shared tasks of real clients, as each client's requests. */
export async function loadClientStates(clientIds?: string[]): Promise<Map<string, ClientState>> {
  let q = supabaseAdmin.from("tasks").select(TASK_COLS)
    .not("status", "in", "(done,on_hold)").is("deleted_at", null).like("client_id", "cl_%").eq("is_private", false).eq("hidden_from_client", false);
  if (clientIds?.length) q = q.in("client_id", clientIds);
  const { data, error } = await q.limit(4000);
  const out = new Map<string, ClientState>();
  if (error) return out;
  for (const t of (data ?? []) as TaskRow[]) {
    if (t.client_id === "cl_workspace") continue;
    const st = out.get(t.client_id) ?? { clientId: t.client_id, requests: [], checkItOpen: false, answeredAt: null, tasks: [] };
    const subtasks = t.subtasks ?? [];
    st.tasks.push(t);
    if (openCheckIt(subtasks)) st.checkItOpen = true;
    const ans = lastAnswerAt(subtasks);
    if (ans && (!st.answeredAt || ans > st.answeredAt)) st.answeredAt = ans;
    const r = requestFromTask({ id: t.id, title: t.title, clientId: t.client_id, projectId: t.project_id, due: t.due, subtasks });
    if (r) st.requests.push(r);
    out.set(t.client_id, st);
  }
  return out;
}

/** Every reminder row to these clients in the last few months. */
export async function loadReminderRows(clientIds: string[]): Promise<ReminderRow[]> {
  if (!clientIds.length) return [];
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const out: ReminderRow[] = [];
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data } = await supabaseAdmin.from("scheduled_messages").select("id, client_id, task_id, status, scheduled_at, sent_message_id, subject")
      .or(CLIENT_REMINDER_PREFIXES.map((p) => `id.like.${p}%`).join(",")).in("client_id", clientIds.slice(i, i + 200)).gte("scheduled_at", since)
      .order("scheduled_at", { ascending: true }).limit(5000);
    out.push(...((data ?? []) as ReminderRow[]));
  }
  return out;
}

/** Per step: the first and newest reminder day, and how many were sent. */
export function historyByStep(rows: ReminderRow[]): Map<string, StepHistory> {
  const h = new Map<string, StepHistory>();
  for (const r of rows) {
    const p = parseReminderId(r.id);
    if (!p.stepId) continue;
    const day = toPacificDate(r.scheduled_at);
    const was = h.get(p.stepId);
    h.set(p.stepId, { first: was && was.first < day ? was.first : day, last: was && was.last > day ? was.last : day, sent: (was?.sent ?? 0) + (r.status === "sent" ? 1 : 0) });
  }
  return h;
}

/** The newest reminder of any kind to a client, whatever became of it. */
function lastSentFor(rows: ReminderRow[], clientId: string): string | null {
  let at: string | null = null;
  for (const r of rows) if (r.client_id === clientId && (!at || r.scheduled_at > at)) at = r.scheduled_at;
  return at;
}

/** The first reminder sent for a step: the one every later one answers. */
function firstSentFor(rows: ReminderRow[], stepId: string): ReminderRow | null {
  return rows.filter((r) => r.status === "sent" && r.sent_message_id && parseReminderId(r.id).stepId === stepId)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0] ?? null;
}

const reSubject = (s: string) => `Re: ${s.replace(/^((re|fwd?):\s*)+/i, "").trim()}`.slice(0, 200);

/** A request row's thread, when it has none yet: the first one sent for its step. */
async function threadFor(id: string, clientId: string): Promise<{ replyTo: string; subject: string | null } | null> {
  const p = parseReminderId(id);
  if (!p.stepId) return null;
  const rows = await loadReminderRows([clientId]);
  const first = firstSentFor(rows, p.stepId);
  return first?.sent_message_id && first.id !== id ? { replyTo: first.sent_message_id, subject: first.subject } : null;
}

/** For a sender about to send a request row with no thread: the reply
 *  fields and subject that put it in its step's thread, saved on the row. */
export async function threadRequestRow(row: { id: string; client_id: string; subject: string | null; reply_to_message_id: string | null }): Promise<{ replyTo: string | null; subject: string | null }> {
  if (row.reply_to_message_id || !row.id.startsWith(REQUEST_PREFIX)) return { replyTo: row.reply_to_message_id, subject: row.subject };
  const t = await threadFor(row.id, row.client_id).catch(() => null);
  if (!t) return { replyTo: null, subject: row.subject };
  const subject = KEEP_THREAD_SUBJECT && t.subject ? reSubject(t.subject) : row.subject;
  await supabaseAdmin.from("scheduled_messages").update({ reply_to_message_id: t.replyTo, subject }).eq("id", row.id);
  return { replyTo: t.replyTo, subject };
}

export type RequestTally = { clients: number; queued: number; summaries: number; skipped: Record<string, number>; noEmail: number; noSender: number; stale: number; moved: number };

/** One run of the request reminders. */
export async function runClientRequests(o: { today?: string; nowMs?: number; dry: boolean; mode: "morning" | "follow-on" }): Promise<{ tally: RequestTally; previews: { client: string; to: string; subject: string; stage: RequestStage; at: string }[] }> {
  const today = o.today ?? todayPacific();
  const nowMs = o.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const tally: RequestTally = { clients: 0, queued: 0, summaries: 0, skipped: {}, noEmail: 0, noSender: 0, stale: 0, moved: 0 };
  const previews: { client: string; to: string; subject: string; stage: RequestStage; at: string }[] = [];
  const states = await loadClientStates();
  const ids = [...states.keys()];
  const rows = await loadReminderRows(ids);
  const history = historyByStep(rows);

  // A request still waiting for review whose step is no longer the client's
  // turn (answered, moved on, deleted): not sent.
  const open = new Set([...states.values()].flatMap((s) => s.requests.map((r) => r.stepId)));
  for (const r of rows) {
    if (r.status !== REVIEW_STATUS || !r.id.startsWith(REQUEST_PREFIX)) continue;
    const p = parseReminderId(r.id);
    if (!p.stepId || open.has(p.stepId)) continue;
    if (!o.dry) await supabaseAdmin.from("scheduled_messages").update({ status: "canceled", error: "No longer waiting on the client." }).eq("id", r.id).eq("status", REVIEW_STATUS);
    r.status = "canceled";
    tally.stale++;
  }

  // The expected dates move first, so the email says the new one.
  if (o.mode === "morning" && !o.dry) tally.moved = await moveExpectedDates(states, today);

  for (const st of states.values()) {
    if (!st.requests.length) continue;
    tally.clients++;
    const mine = rows.filter((r) => r.client_id === st.clientId);
    const lastSentAt = lastSentFor(mine, st.clientId);
    const plan = planForClient({
      today, nowIso, mode: o.mode, requests: st.requests, history,
      lastSentAt, lastSentDay: lastSentAt ? toPacificDate(lastSentAt) : null, answeredAt: st.answeredAt,
      checkItOpen: st.checkItOpen, reviewWaiting: mine.some((r) => r.status === REVIEW_STATUS),
    });
    if ("skip" in plan) { tally.skipped[plan.skip] = (tally.skipped[plan.skip] ?? 0) + 1; continue; }
    const built = await buildRequestEmail(st, plan.stage, plan.request, { today, dry: o.dry, rows: mine, history });
    if (!built.ok) { if (built.reason === "no_email") tally.noEmail++; else tally.noSender++; continue; }
    const at = plan.notBefore ?? nowIso;
    if (o.dry) { previews.push({ client: built.clientName, to: built.to, subject: built.subject, stage: plan.stage, at }); continue; }
    const { error } = await supabaseAdmin.from("scheduled_messages").insert({
      id: requestRowId(plan.stage, plan.request?.stepId ?? null, randomUUID()), client_id: st.clientId, task_id: plan.request?.taskId ?? null, channel: "email",
      subject: built.subject, body: built.body, scheduled_at: at, status: built.status, created_by: built.sender, reply_to_message_id: built.replyTo,
    });
    if (!error) { tally.queued++; if (plan.stage === "summary") tally.summaries++; }
  }
  return { tally, previews };
}

/** The subjects of the emails our reply waits wait on, by message id. */
async function replySubjects(requests: (ClientRequest | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(requests.map((r) => r?.replyTo?.messageId).filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin.from("messages").select("id, subject").in("id", ids.slice(i, i + 200));
    for (const m of (data ?? []) as any[]) if (typeof m.subject === "string" && m.subject.trim()) out.set(m.id as string, m.subject.trim());
  }
  return out;
}
/** How a request is asked (lib/stepReminders stepAskWords): a reply wait by
 *  its email's subject, else the title of the step that sent it. */
function requestAsk(r: ClientRequest, clientFirst: string, subjects: Map<string, string>): AskWords {
  const replyTo = r.replyTo ? (r.replyTo.messageId ? subjects.get(r.replyTo.messageId) : null) ?? r.replyTo.stepTitle : null;
  return stepAskWords({ title: r.title, notes: r.notes, finishWhen: r.finishWhen, addedFor: r.addedFor }, clientFirst, r.taskTitle, { replyTo });
}

type Built = { ok: true; subject: string; body: string; to: string; clientName: string; sender: string; replyTo: string | null; status: string } | { ok: false; reason: "no_email" | "no_sender" | "gone" };

/** The email for one client's request (or their summary). */
async function buildRequestEmail(st: ClientState, stage: RequestStage, request: ClientRequest | null, o: { today: string; dry: boolean; rows: ReminderRow[]; history: Map<string, StepHistory> }): Promise<Built> {
  const { data: client } = await supabaseAdmin.from("clients").select("id, name, share_token, assigned_to, reminders, deleted_at").eq("id", st.clientId).maybeSingle();
  if (!client || (client as any).deleted_at) return { ok: false, reason: "gone" };
  const contact = await resolveContact(st.clientId);
  if (!contact?.email) return { ok: false, reason: "no_email" };
  const task = request ? st.tasks.find((t) => t.id === request.taskId) : null;
  const sender = (task?.assignee_id && task.assignee_id !== CLAUDE_ID ? task.assignee_id : null) ?? await resolveNotifyRecipient((client as any).assigned_to as string[] | null);
  if (!sender) return { ok: false, reason: "no_sender" };
  const { data: person } = await supabaseAdmin.from("contacts").select("name").eq("id", contact.id).maybeSingle();
  const raw = String((person as any)?.name ?? "").trim().split(/\s+/)[0] || "";
  const first = raw ? raw[0].toUpperCase() + raw.slice(1) : null;
  const { data: prof } = await supabaseAdmin.from("profiles").select("name").eq("member_id", sender).maybeSingle();
  const senderFirst = String((prof as any)?.name ?? "").trim().split(/\s+/)[0] || null;
  // The portal: one request, or the whole list. No token yet: one is made, as the counts email does.
  let token = (client as any).share_token as string | null;
  if (!token && !o.dry) {
    token = randomUUID().replace(/-/g, "");
    await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", st.clientId);
  }
  const portal = `${APP_URL}/waiting/${token ?? "<made when sent>"}`;
  const ordered = orderRequests(st.requests, o.today);
  const overdue = ordered.filter((r) => daysLate(r.needBy, o.today) > 0).length;
  const clientFirst = first ?? String((client as any).name ?? "").split(" ")[0];
  const firstAsked = request ? (request.startedAt ? toPacificDate(request.startedAt) : o.history.get(request.stepId)?.first ?? o.today) : o.today;
  // Opens that one request in the portal (its step too, so a request already
  // answered says so and moves on to the next one).
  const link = request ? { url: `${portal}?task=${encodeURIComponent(request.taskId)}&step=${encodeURIComponent(request.stepId)}`, label: "Open it in your client portal" } : null;
  const words = request ? requestAsk(request, clientFirst, await replySubjects([request])) : null;
  const email = requestEmail({
    stage, firstName: first, ask: words?.ask ?? "", subjectAsk: words?.subject,
    taskTitle: request?.taskTitle ?? "", needBy: request?.needBy ?? null, firstAsked, today: o.today, expected: task?.due ?? null,
    link, listUrl: portal, more: Math.max(0, ordered.length - 1), overdue, sender: senderFirst,
  });
  let subject = email.subject;
  let replyTo: string | null = null;
  if (request) {
    const firstRow = firstSentFor(o.rows, request.stepId);
    if (firstRow?.sent_message_id) {
      replyTo = firstRow.sent_message_id;
      if (KEEP_THREAD_SUBJECT && firstRow.subject) subject = reSubject(firstRow.subject);
    }
  }
  return {
    ok: true, subject, body: draftLinkAsButton(draftLinkAsButton(email.body, link), request ? null : { url: portal, label: "See everything we need" }), to: contact.email,
    clientName: String((client as any).name ?? ""), sender, replyTo, status: reminderQueueStatus((client as any).reminders ?? null, REVIEW_STATUS),
  };
}

/** Tasks waiting on a late request: the expected date keeps pace, once a day
 *  (the 8 AM run), one task at a time, logged on the task. Never a follow up. */
async function moveExpectedDates(states: Map<string, ClientState>, today: string): Promise<number> {
  let moved = 0;
  for (const st of states.values()) {
    for (const r of st.requests) {
      if (moved >= 25) return moved;
      const m = expectedMove({ taskDue: r.taskDue, expectedFrom: r.expectedFrom, needBy: r.needBy, today });
      if (!m) continue;
      const task = st.tasks.find((t) => t.id === r.taskId);
      if (!task) continue;
      const subtasks = (task.subtasks ?? []).map((s) => (s.id === r.stepId && s.expectedFrom !== m.from ? { ...s, expectedFrom: m.from } : s));
      const { data: wrote } = await supabaseAdmin.from("tasks").update({ due: m.due, subtasks, updated_by: null }).eq("id", task.id).eq("updated_at", task.updated_at).select("id");
      if (!wrote?.length) continue;
      const { data: c } = await supabaseAdmin.from("clients").select("name").eq("id", st.clientId).maybeSingle();
      const first = String((c as any)?.name ?? "The client").split(" ")[0];
      await supabaseAdmin.rpc("append_comment", { task_id: task.id, comment: { id: "cm_" + randomUUID(), authorId: CLAUDE_ID, at: new Date().toISOString(), kind: "event", body: expectedMoveComment(m.due, first, r.title, m.late) } });
      await supabaseAdmin.from("tasks").update({ updated_by: null }).eq("id", task.id);
      r.taskDue = m.due;
      task.due = m.due;
      moved++;
    }
  }
  return moved;
}

/** Sends one reminder waiting for review now, in its sender's name: Approve
 *  in Reminders and Send in the Inbox. A request row that has no thread yet
 *  answers the first one sent for its step. */
export async function sendReviewedReminder(id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const COLS = "id, client_id, task_id, channel, subject, body, cc, bcc, from_email, attachments, created_by, reply_to_message_id, scheduled_at";
  // Claimed first, so two people pressing it at once send it once.
  const { data: claimed } = await supabaseAdmin.from("scheduled_messages").update({ status: "sending" }).eq("id", id).eq("status", REVIEW_STATUS).select(COLS);
  const row = (claimed ?? [])[0] as any;
  if (!row) return { ok: false, error: "It was already sent or skipped.", status: 409 };
  const { replyTo, subject } = await threadRequestRow(row);
  const result = await sendScheduledMessageNow({
    id: row.id, clientId: row.client_id, taskId: row.task_id, channel: row.channel,
    subject, body: row.body ?? "", cc: row.cc ?? [], bcc: row.bcc ?? [],
    fromEmail: row.from_email, attachments: row.attachments ?? [], createdBy: row.created_by, replyToMessageId: replyTo,
  });
  if (!result.ok) {
    // Back to waiting, so it can be fixed and sent again.
    await supabaseAdmin.from("scheduled_messages").update({ status: REVIEW_STATUS, error: result.error }).eq("id", row.id);
    return { ok: false, error: result.error, status: 502 };
  }
  await supabaseAdmin.from("scheduled_messages").update({ status: "sent", sent_message_id: result.messageId, scheduled_at: new Date().toISOString() }).eq("id", row.id);
  return { ok: true };
}

/** The step an emailed reply answers, from the reminders sent into its
 *  thread (their ids carry the step). Null when it can't be told. */
export async function requestStepForReply(contactId: string, gmailThreadId: string | null | undefined): Promise<{ stepId: string; taskId: string | null } | null> {
  if (!gmailThreadId) return null;
  const { data: sent } = await supabaseAdmin.from("messages").select("id").eq("contact_id", contactId).eq("gmail_thread_id", gmailThreadId).eq("direction", "outbound").limit(200);
  const ids = ((sent ?? []) as { id: string }[]).map((m) => m.id);
  if (!ids.length) return null;
  const { data: rows } = await supabaseAdmin.from("scheduled_messages").select("id, sent_message_id, task_id, scheduled_at").in("sent_message_id", ids).limit(200);
  return requestStepForThread((rows ?? []) as any[], ids);
}

// ── What the Reminders view and the step pages read ─────────────────────────

export type ReminderItem = {
  id: string; clientId: string; clientName: string; to: string | null; taskId: string | null; taskTitle: string | null; stepId: string | null; ask: string | null;
  stage: string; subject: string; body: string; from: string | null; at: string; status: string;
};

const stageOf = (id: string, stepNeedBy: string | null, at: string): string => {
  const p = parseReminderId(id);
  if (p.kind === "other") return id.startsWith(REMINDER_MESSAGE_PREFIX) ? "review nudge" : "reminder";
  return stageLabel(p.stage, { kind: p.kind, daysLate: p.stage === "late" ? daysLate(stepNeedBy, toPacificDate(at)) : undefined });
};

/** To review (waiting now), coming up (the next few business days, worked
 *  out, nothing made yet) and sent (newest first, approved ones still to go
 *  on top), for the Reminders view. */
export async function remindersOverview(o: { sentClientId?: string | null; sentLimit?: number; comingDays?: number } = {}): Promise<{ toReview: ReminderItem[]; comingUp: (ComingUp & { clientName: string; taskTitle: string | null; ask: string | null; stepId: string | null })[]; sent: ReminderItem[] }> {
  const COLS = "id, client_id, task_id, status, scheduled_at, sent_message_id, subject, body, created_by";
  const { data: review } = await supabaseAdmin.from("scheduled_messages").select(COLS).eq("status", REVIEW_STATUS).order("scheduled_at", { ascending: true }).limit(200);
  let sentQ = supabaseAdmin.from("scheduled_messages").select(COLS).or([...CLIENT_REMINDER_PREFIXES, REMINDER_MESSAGE_PREFIX].map((p) => `id.like.${p}%`).join(","))
    .in("status", ["sent", "pending", "sending", "failed"]);
  if (o.sentClientId) sentQ = sentQ.eq("client_id", o.sentClientId);
  const { data: sent } = await sentQ.order("scheduled_at", { ascending: false }).limit(o.sentLimit ?? 150);
  const states = await loadClientStates();
  const rows = await loadReminderRows([...states.keys()]);
  const history = historyByStep(rows);
  const today = todayPacific();
  const comingRaw: ComingUp[] = [];
  for (const st of states.values()) {
    const mine = rows.filter((r) => r.client_id === st.clientId);
    const last = lastSentFor(mine, st.clientId);
    const lastDay = last ? toPacificDate(last) : null;
    // Today only when nothing went or waits for them today; waiting for review: from tomorrow.
    const waiting = mine.some((r) => r.status === REVIEW_STATUS);
    comingRaw.push(...comingUpForClient({ from: lastDay === today || waiting ? addOneBusinessDay(today) : today, days: o.comingDays ?? 5, requests: st.requests, history, lastSentDay: lastDay, checkItOpen: st.checkItOpen }));
  }
  const all = [...((review ?? []) as any[]), ...((sent ?? []) as any[])];
  const clientIds = [...new Set([...all.map((r) => r.client_id as string), ...comingRaw.map((c) => c.clientId)])];
  const { data: clients } = clientIds.length ? await supabaseAdmin.from("clients").select("id, name").in("id", clientIds) : { data: [] as any[] };
  const nameOf = new Map(((clients ?? []) as any[]).map((c) => [c.id as string, c.name as string]));
  const taskIds = [...new Set(all.map((r) => r.task_id).filter(Boolean) as string[])];
  // Each open request's ask as the client reads it (stepAskWords).
  const subjects = await replySubjects([...states.values()].flatMap((st) => st.requests));
  const firstOf = (clientId: string) => String(nameOf.get(clientId) ?? "").trim().split(/\s+/)[0] ?? "";
  const askOf = new Map<string, string>();
  for (const st of states.values()) for (const r of st.requests) askOf.set(r.stepId, requestAsk(r, firstOf(st.clientId), subjects).title);
  // Each step's title and need by date, from the tasks they're on.
  const steps = new Map<string, { title: string; needBy: string | null }>();
  const taskTitle = new Map<string, string>();
  for (const st of states.values()) for (const t of st.tasks) { taskTitle.set(t.id, t.title); for (const s of t.subtasks ?? []) steps.set(s.id, { title: s.title, needBy: s.due ?? null }); }
  const missing = taskIds.filter((id) => !taskTitle.has(id));
  for (let i = 0; i < missing.length; i += 200) {
    const { data } = await supabaseAdmin.from("tasks").select("id, title, subtasks").in("id", missing.slice(i, i + 200));
    for (const t of (data ?? []) as any[]) { taskTitle.set(t.id, t.title); for (const s of (t.subtasks ?? []) as Subtask[]) steps.set(s.id, { title: s.title, needBy: s.due ?? null }); }
  }
  const toOf = new Map<string, string | null>();
  for (const r of (review ?? []) as any[]) if (!toOf.has(r.client_id)) toOf.set(r.client_id, (await resolveContact(r.client_id).catch(() => null))?.email ?? null);
  const item = (r: any): ReminderItem => {
    const p = parseReminderId(r.id);
    const step = p.stepId ? steps.get(p.stepId) : undefined;
    return {
      id: r.id, clientId: r.client_id, clientName: nameOf.get(r.client_id) ?? "A client", to: toOf.get(r.client_id) ?? null,
      taskId: r.task_id ?? null, taskTitle: r.task_id ? taskTitle.get(r.task_id) ?? null : null, stepId: p.stepId, ask: (p.stepId ? askOf.get(p.stepId) : null) ?? step?.title ?? null,
      stage: stageOf(r.id, step?.needBy ?? null, r.scheduled_at), subject: r.subject ?? "", body: r.body ?? "", from: r.created_by ?? null, at: r.scheduled_at, status: r.status,
    };
  };
  return {
    toReview: ((review ?? []) as any[]).map(item),
    comingUp: comingRaw.sort((a, b) => a.day.localeCompare(b.day)).map((c) => ({
      ...c, clientName: nameOf.get(c.clientId) ?? "A client", taskTitle: c.request?.taskTitle ?? null, ask: c.request ? askOf.get(c.request.stepId) ?? c.request.title : null, stepId: c.request?.stepId ?? null,
    })),
    sent: ((sent ?? []) as any[]).map(item),
  };
}

const addOneBusinessDay = (iso: string) => { let d = new Date(`${iso}T12:00:00Z`); do { d = new Date(d.getTime() + 86_400_000); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10); };

export type AskedEntry = { at: string; stage: string; status: "sent" | "review" | "skipped" | "going" | "failed" };
/** A client step's Asked list: each reminder for it, oldest first. */
export async function askedLog(clientId: string, stepIds: string[]): Promise<Record<string, AskedEntry[]>> {
  const rows = await loadReminderRows([clientId]);
  const want = new Set(stepIds);
  const out: Record<string, AskedEntry[]> = {};
  for (const r of rows) {
    const p = parseReminderId(r.id);
    if (!p.stepId || !want.has(p.stepId)) continue;
    const status = r.status === "sent" ? "sent" : r.status === REVIEW_STATUS ? "review" : r.status === "canceled" ? "skipped" : r.status === "failed" ? "failed" : "going";
    (out[p.stepId] ??= []).push({ at: r.scheduled_at, stage: stageLabel(p.stage, { kind: p.kind }), status });
  }
  return out;
}

/** Chased now: the client's top request with reminders on (for "being chased"). */
export function chasedStepId(st: ClientState, today: string): string | null {
  return chasedRequest(orderRequests(st.requests, today))?.stepId ?? null;
}

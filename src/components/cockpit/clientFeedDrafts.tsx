"use client";

// What Edit and Send do for each draft in a client's Conversation (Derek,
// 2026-10-14: "drafts at the bottom, edit and send in place"). Every send goes
// through the app's usual send path, and a draft held on a task moves that
// task's steps exactly as sending it from the task does (lib/talkSend). A task
// email that asks about to dos or starts a review still goes from its task,
// which knows the review.
import { useEffect, useState } from "react";
import {
  CLAUDE_ID, TODAY, addEmailSentRecord, currentStep, formatDue, htmlToText, isHandoffStep, looksLikeHtml, plainTextToHtml, sentEmailKey, stepHolding,
  type Attachment, type Contact, type EmailDraft, type Message, type MessageChannel, type Task,
} from "@/lib/data";
import { deleteClientEmailDraft, fetchClientEmailDraft } from "@/lib/db";
import { draftLinkAsButton } from "@/lib/draftLink";
import { talkSendPatch, talkStepPlan } from "@/lib/talkSend";
import { collectClientDrafts, type ConversationDraft } from "@/lib/clientConversation";
import { EmailWindow, sentEmailFor, type OutgoingEmail } from "./EmailWindow";
import type { QueuedDraft } from "./inbox/inboxPrefs";
import type { FeedDraft } from "./ClientConversation";
import { newId } from "./ui";

type Send = (clientId: string, channel: MessageChannel, subject: string, body: string, attachments?: Attachment[], cc?: string[], bcc?: string[], taskId?: string | null, fromEmail?: string, replyToMessageId?: string | null, onSent?: (m: Message) => void) => Promise<boolean>;

/** The client's own saved email (one at a time, client_email_drafts), read
 *  again when their email window closes and when `nonce` moves. */
export function useClientSavedDraft(clientId: string | null, windowOpen: boolean, nonce = 0): { clientId: string; draft: EmailDraft } | null {
  const [own, setOwn] = useState<{ clientId: string; draft: EmailDraft | null } | null>(null);
  useEffect(() => {
    if (!clientId || windowOpen) return;
    let live = true;
    void fetchClientEmailDraft(clientId).then((d) => { if (live) setOwn({ clientId, draft: d }); }).catch(() => {});
    return () => { live = false; };
  }, [clientId, windowOpen, nonce]);
  return own && own.clientId === clientId && own.draft ? { clientId, draft: own.draft } : null;
}

/** A task email that has to go from its task: it asks about to dos, or the
 *  step it would finish holds a review to send. */
export function sendsFromTask(t: Task): boolean {
  if (t.draftEmail?.asks) return true;
  const cur = currentStep(t.subtasks ?? []);
  return !!cur && !cur.onClient && !isHandoffStep(cur, t.assigneeId) && (["page", "image", "video", "doc"] as const).some((k) => cur.holds?.includes(k));
}

export type FeedDraftDeps = {
  clientId: string;
  first: string;
  contact: Contact | null;
  canMessage: boolean;
  tasks: Task[];
  messages: Message[];
  queued: QueuedDraft[];
  saved: { clientId: string; draft: EmailDraft } | null;
  /** The tasks as they are now, read when a send lands (after any edit). */
  tasksNow: { readonly current: Task[] };
  sendMessage: Send;
  patchTask: (id: string, patch: Partial<Task>) => void;
  afterQueuedSend: <T>(queuedId: string | undefined, sent: T) => T;
  retireQueued: (id: string) => void;
  openClientEmail: (start: { subject?: string; body?: string; queuedId?: string }) => void;
  openTaskWithEmail: (taskId: string) => void;
  onSavedDraftGone: () => void;
  ccContacts: Contact[];
  onUpload: (file: File) => Promise<Attachment | null>;
  pushToast: (text: string) => void;
};

export function buildFeedDrafts(deps: FeedDraftDeps): FeedDraft[] {
  const { clientId, first, contact, tasks } = deps;
  const latest = (id: string) => deps.tasksNow.current.find((t) => t.id === id);
  const list = collectClientDrafts({
    tasks, messages: deps.messages, queued: deps.queued, clientDraft: deps.saved,
    sentAlready: (d, ms) => !!sentEmailFor(d, ms),
  });

  // A task's draft email, sent: the steps move as on the task, its hold
  // becomes the sent email, and the draft goes.
  const sendTaskEmail = async (taskId: string, email: OutgoingEmail): Promise<boolean> => {
    let sentId: string | null = null;
    const ok = await deps.sendMessage(clientId, "email", email.subject, email.body, email.attachments, email.cc, email.bcc, taskId, undefined, email.replyTo, (m) => { sentId = m.id; });
    if (!ok) return false;
    const t = latest(taskId);
    if (!t) return true;
    let patch: Partial<Task> = {};
    let said = "Email sent";
    const cur = currentStep(t.subtasks);
    if (cur?.onClient && !cur.holds?.includes("email")) {
      const marked = addEmailSentRecord(t.subtasks, cur.id, first, () => newId("s_"));
      if (marked) patch = { subtasks: marked };
    } else {
      const plan = talkStepPlan(t.subtasks, t.assigneeId, "email", TODAY, email.followUpDate ?? null);
      const out = plan ? talkSendPatch(t, plan, "email", first, () => newId("s_")) : null;
      if (out && plan) { patch = out.patch; said = plan.kind === "finish" ? `Sent. Finished "${plan.cur.title.trim()}"` : `Sent. Still waiting on ${first}`; }
      else if (email.followUpDate && t.status !== "done") patch = { status: "waiting", followUpAt: email.followUpDate, ...(t.due && t.due < email.followUpDate ? { due: email.followUpDate } : {}) };
    }
    const subs = patch.subtasks ?? t.subtasks;
    const on = sentId ? stepHolding(subs, "email") : null;
    deps.patchTask(taskId, { ...patch, ...(on && sentId ? { subtasks: subs.map((x) => (x.id === on.id ? { ...x, holds: (x.holds ?? []).map((k) => (k === "email" ? sentEmailKey(sentId!) : k)) } : x)) } : {}), draftEmail: null });
    deps.pushToast(said);
    return true;
  };
  // A text or chat held on a step, sent: that step is done (or the wait it
  // is on gets a follow up), as the step's own Send does.
  const sendStep = async (taskId: string, stepId: string, channel: "sms" | "chat", body: string): Promise<boolean> => {
    const ok = await deps.sendMessage(clientId, channel, "", body, [], [], [], taskId);
    if (!ok) return false;
    const t = latest(taskId);
    if (!t) return true;
    const plan = talkStepPlan(t.subtasks, t.assigneeId, channel, TODAY, null, stepId);
    const out = plan ? talkSendPatch(t, plan, channel, first, () => newId("s_")) : null;
    deps.patchTask(taskId, out ? out.patch : { subtasks: t.subtasks.map((x) => (x.id === stepId ? { ...x, draftMessage: undefined } : x)) });
    deps.pushToast(`${channel === "sms" ? "Text" : "Chat"} sent${plan?.kind === "finish" ? `. Finished "${plan.cur.title.trim()}"` : ""}`);
    return true;
  };
  const patchStep = (taskId: string, stepId: string, change: (dm: { channel: "sms" | "chat"; body: string } | undefined) => { channel: "sms" | "chat"; body: string } | undefined) => {
    const t = latest(taskId);
    if (t) deps.patchTask(taskId, { subtasks: t.subtasks.map((x) => (x.id === stepId ? { ...x, draftMessage: change(x.draftMessage) } : x)) });
  };

  const off = (d: ConversationDraft, where: string): FeedDraft => ({ d, where, send: null });
  return list.map((d): FeedDraft => {
    if (!deps.canMessage) return off(d, "messages are off");
    if (d.source === "task") {
      const t = tasks.find((x) => x.id === d.taskId)!;
      const where = `on "${t.title}"`;
      if (sendsFromTask(t)) return { d, where, send: null, openEdit: () => deps.openTaskWithEmail(t.id), onTask: () => deps.openTaskWithEmail(t.id) };
      const draft = t.draftEmail!;
      const asIs = (): OutgoingEmail => ({ subject: draft.subject.trim() || t.title.trim(), body: draftLinkAsButton(draft.body, draft.link), attachments: draft.attachments ?? [], cc: draft.cc ?? [], bcc: draft.bcc ?? [], replyTo: draft.replyTo ?? null, followUpDate: null });
      return {
        d, where,
        send: contact?.email ? () => sendTaskEmail(t.id, asIs()) : null,
        editEmail: (close) => (
          <EmailWindow key={draft.createdAt} draft={draft} heading="Draft email" subheading={t.title} subjectFallback={t.title}
            save={(next) => deps.patchTask(t.id, { draftEmail: next })} onDiscard={() => deps.patchTask(t.id, { draftEmail: null })} onClose={close}
            onSend={contact?.email ? (email) => { close(); void sendTaskEmail(t.id, email); } : undefined}
            toEmail={contact?.email || null} toName={contact?.name ?? null} ccContacts={deps.ccContacts} onUpload={deps.onUpload}
            taskItems={t.attachments} followUp pushToast={deps.pushToast} />
        ),
      };
    }
    if (d.source === "step") {
      const channel = d.kind === "chat" ? "chat" : "sms";
      const t = tasks.find((x) => x.id === d.taskId)!;
      const onClaude = t.subtasks.find((x) => x.id === d.stepId)?.assigneeId === CLAUDE_ID;
      const can = channel === "chat" || !!contact?.phone;
      return {
        d, where: `on "${t.title}"${onClaude ? ", waiting on Claude" : ""}`,
        send: can ? () => sendStep(t.id, d.stepId!, channel, d.body.trim()) : null,
        editText: {
          save: (body) => patchStep(t.id, d.stepId!, (dm) => (dm ? { ...dm, body } : dm)),
          send: (body) => (can ? sendStep(t.id, d.stepId!, channel, body) : Promise.resolve(false)),
          discard: () => patchStep(t.id, d.stepId!, () => undefined),
        },
      };
    }
    if (d.source === "queued") {
      const q = deps.queued.find((x) => x.id === d.queuedId)!;
      const where = `from ${q.by ?? "Claude"}, on no task`;
      if (q.kind === "email") {
        const html = looksLikeHtml(q.body) ? q.body : plainTextToHtml(q.body);
        return {
          d, where,
          send: contact?.email && q.subject?.trim() ? () => deps.afterQueuedSend(q.id, deps.sendMessage(clientId, "email", q.subject!.trim(), html, [], [], [], null, undefined, q.replyToMessageId ?? null)) : null,
          openEdit: () => deps.openClientEmail({ subject: q.subject ?? "", body: html, queuedId: q.id }),
        };
      }
      const text = htmlToText(q.body);
      return {
        d, where,
        send: contact?.phone ? () => deps.afterQueuedSend(q.id, deps.sendMessage(clientId, "sms", "", text)) : null,
        editText: { save: () => {}, send: (body) => (contact?.phone ? deps.afterQueuedSend(q.id, deps.sendMessage(clientId, "sms", "", body)) : Promise.resolve(false)), discard: () => deps.retireQueued(q.id) },
      };
    }
    // The client's own saved email: Remind writes here.
    const own = deps.saved!.draft;
    return {
      d, where: "on no task",
      send: contact?.email && own.subject.trim() ? async () => {
        const ok = await deps.sendMessage(clientId, "email", own.subject.trim(), draftLinkAsButton(own.body, own.link), own.attachments ?? [], own.cc ?? [], own.bcc ?? [], null, undefined, own.replyTo ?? null);
        if (ok) { await deleteClientEmailDraft(clientId); deps.onSavedDraftGone(); }
        return ok;
      } : null,
      openEdit: () => deps.openClientEmail({}),
    };
  });
}

/** A new message from the Conversation's box, sent on the task picked under
 *  it (or on no task): the steps of that task move exactly as a send from the
 *  task itself moves them (lib/talkSend). True once it went. */
export async function sendFromFeed(deps: Pick<FeedDraftDeps, "clientId" | "first" | "tasksNow" | "sendMessage" | "patchTask" | "pushToast">, channel: "email" | "sms" | "chat", subject: string, body: string, replyTo: string | null, taskId: string | null): Promise<boolean> {
  const ok = await deps.sendMessage(deps.clientId, channel, subject, body, [], [], [], taskId, undefined, replyTo);
  if (!ok || !taskId) return ok;
  const t = deps.tasksNow.current.find((x) => x.id === taskId);
  if (!t || t.status === "done") return true;
  const plan = talkStepPlan(t.subtasks, t.assigneeId, channel, TODAY);
  const out = plan ? talkSendPatch(t, plan, channel, deps.first, () => newId("s_"), undefined, subject) : null;
  if (!plan || !out) return true;
  deps.patchTask(taskId, out.patch);
  const what = channel === "sms" ? "Text" : channel === "chat" ? "Chat" : "Email";
  deps.pushToast(plan.kind === "finish" ? `${what} sent. Finished "${plan.cur.title.trim()}"` : `${what} sent. Still waiting on ${deps.first}; checking again ${formatDue(plan.due)}.`);
  return true;
}

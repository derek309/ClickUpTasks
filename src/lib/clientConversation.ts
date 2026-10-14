// The client page's Conversation (Derek, 2026-10-14, client header mockup):
// the newest thing said, the drafts not sent yet, and where a new message
// goes. Pure, so the strip, the feed and the tests read the same answers.
import { htmlToText, isMessageConversationTask, looksLikeHtml, timeAgo, type EmailDraft, type Message, type Task } from "./data";

/** The channels the Conversation shows: emails, texts and portal chats. */
export type TalkChannel = "email" | "sms" | "chat";
export const isTalk = (m: Pick<Message, "channel">): m is Message & { channel: TalkChannel } =>
  m.channel === "email" || m.channel === "sms" || m.channel === "chat";

/** A message's words as one plain line. */
export function plainLine(body: string): string {
  return (looksLikeHtml(body) ? htmlToText(body) : body).replace(/\s+/g, " ").trim();
}

/** The first words, cut at a word with "…" when there is more. */
export function firstWords(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}

/** The newest email, text or chat, as the Conversation's one line:
 *  Pamela, 2h ago: "Use this one for…", or You, 2h ago: "…". */
export function newestLine(messages: Message[], opts: { first: string; meId: string; nameOf: (memberId: string) => string | null; ago?: (at: string) => string }): { text: string; theirs: boolean; unread: boolean; at: string } | null {
  const newest = messages.filter(isTalk).reduce<Message | null>((a, m) => (!a || m.at > a.at ? m : a), null);
  if (!newest) return null;
  const theirs = newest.direction === "inbound";
  const who = theirs ? opts.first : !newest.createdBy || newest.createdBy === opts.meId ? "You" : (opts.nameOf(newest.createdBy) ?? "").trim().split(/\s+/)[0] || "We";
  const words = firstWords(plainLine(newest.body)) || (newest.subject ?? "").trim();
  const ago = (opts.ago ?? timeAgo)(newest.at);
  return { text: `${who}, ${ago}${words ? `: "${words}"` : ""}`, theirs, unread: theirs && !newest.read, at: newest.at };
}

/** One draft not sent yet, wherever it is kept. */
export type ConversationDraft = {
  id: string;
  kind: TalkChannel;
  /** task: the task's draft email · step: a text or chat held on a step ·
   *  queued: Claude's draft in the Inbox · client: the client's own saved email. */
  source: "task" | "step" | "queued" | "client";
  taskId: string | null;
  taskTitle: string | null;
  stepId: string | null;
  queuedId: string | null;
  subject: string | null;
  /** The words, plain. */
  text: string;
  /** As stored: HTML for an email. */
  body: string;
  at: string;
  /** Who wrote it, for a Claude draft. */
  by: string | null;
};

type Queued = { id: string; kind: "email" | "text"; subject?: string; body: string; createdAt: string; by?: string };

/** Every draft for this client, oldest first (they sit at the bottom of the
 *  feed, under the newest message). A task's draft email that already went
 *  out is left off, as the task itself retires it (DraftEmail.tsx). */
export function collectClientDrafts(input: {
  tasks: Task[];
  messages: Message[];
  queued: Queued[];
  clientDraft: { draft: EmailDraft; clientId: string } | null;
  sentAlready: (draft: EmailDraft, taskMessages: Message[]) => boolean;
}): ConversationDraft[] {
  const out: ConversationDraft[] = [];
  for (const t of input.tasks) {
    if (t.status === "done") continue;
    const d = t.draftEmail;
    if (d && !input.sentAlready(d, input.messages.filter((m) => m.taskId === t.id))) {
      out.push({ id: `task:${t.id}`, kind: "email", source: "task", taskId: t.id, taskTitle: t.title, stepId: null, queuedId: null,
        subject: d.subject.trim() || null, text: plainLine(d.body), body: d.body, at: d.updatedAt || d.createdAt, by: null });
    }
    for (const s of t.subtasks ?? []) {
      if (s.done || !s.draftMessage || !s.draftMessage.body.trim()) continue;
      out.push({ id: `step:${t.id}:${s.id}`, kind: s.draftMessage.channel, source: "step", taskId: t.id, taskTitle: t.title, stepId: s.id, queuedId: null,
        subject: null, text: s.draftMessage.body.trim(), body: s.draftMessage.body, at: s.startedAt ?? t.createdAt ?? "", by: null });
    }
  }
  for (const q of input.queued) {
    out.push({ id: `queued:${q.id}`, kind: q.kind === "email" ? "email" : "sms", source: "queued", taskId: null, taskTitle: null, stepId: null, queuedId: q.id,
      subject: q.kind === "email" ? q.subject?.trim() || null : null, text: plainLine(q.body), body: q.body, at: q.createdAt, by: q.by ?? "Claude" });
  }
  const own = input.clientDraft?.draft;
  if (own && (own.subject.trim() || plainLine(own.body)) && !input.sentAlready(own, input.messages)) {
    out.push({ id: `client:${input.clientDraft!.clientId}`, kind: "email", source: "client", taskId: null, taskTitle: null, stepId: null, queuedId: null,
      subject: own.subject.trim() || null, text: plainLine(own.body), body: own.body, at: own.updatedAt || own.createdAt, by: null });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Where a new message from the Conversation goes, by the rule a teammate's
 *  own sent email follows (ingestOutboundMessage): the task of what it
 *  answers, else the client's open Conversation task, else no task (the
 *  client's conversation, as the Journal's Email and Text send). A portal
 *  chat only shows on a task, so it needs one. */
export function whereNewMessageGoes(input: {
  channel: TalkChannel;
  tasks: Pick<Task, "id" | "title" | "status" | "priority" | "contactId">[];
  messages: Message[];
  contactId: string | null;
  first: string;
}): { taskId: string | null; taskTitle: string | null; says: string } {
  const open = (id: string | null | undefined) => (id ? input.tasks.find((t) => t.id === id && t.status !== "done") ?? null : null);
  const theirs = input.messages.filter((m) => isTalk(m) && m.direction === "inbound").sort((a, b) => b.at.localeCompare(a.at));
  // What it answers: their newest on this channel, else their newest at all.
  const answering = theirs.find((m) => m.channel === input.channel) ?? theirs[0];
  const answered = open(answering?.taskId);
  if (answered) return { taskId: answered.id, taskTitle: answered.title, says: `Goes on "${answered.title}", the task it answers` };
  const convo = input.tasks.find((t) => t.status !== "done" && t.priority === "conversation" && isMessageConversationTask(t.title)
    && (!input.contactId || !t.contactId || t.contactId === input.contactId));
  if (convo) return { taskId: convo.id, taskTitle: convo.title, says: `Goes on "${convo.title}"` };
  if (input.channel === "chat") return { taskId: null, taskTitle: null, says: `A portal chat needs a task, so start one for ${input.first} first` };
  return { taskId: null, taskTitle: null, says: `Goes on ${input.first}'s conversation, on no task` };
}

/** The email being answered from the Conversation: their newest email, when
 *  it is newer than ours. The subject follows it as "Re: …". */
export function emailBeingAnswered(messages: Message[]): { id: string; subject: string } | null {
  const emails = messages.filter((m) => m.channel === "email").sort((a, b) => b.at.localeCompare(a.at));
  const theirs = emails.find((m) => m.direction === "inbound");
  if (!theirs) return null;
  const ours = emails.find((m) => m.direction === "outbound");
  if (ours && ours.at > theirs.at) return null;
  const subj = (theirs.subject ?? "").trim();
  return { id: theirs.id, subject: subj ? (/^re:/i.test(subj) ? subj : `Re: ${subj}`) : "" };
}

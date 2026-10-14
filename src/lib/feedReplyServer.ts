// SERVER-ONLY: "Draft a reply with AI" in the client's Conversation (Derek,
// 2026-10-14, feed round 3). Reads the last messages said with the client and
// the task the reply goes on (its directions and steps), and writes the
// prompt for the app's usual AI writing path (/api/ai/draft-message, the one
// the email window's Write with AI uses). The prompt stays here, on the
// server, never in the browser's bundle (Derek: protect the IP).
import { EMAIL_FORMAT } from "./emailStyle";
import { automaticKind, byTime, type TalkChannel } from "./clientConversation";
import { htmlToText, looksLikeHtml, type Message, type Subtask } from "./data";
import { supabaseAdmin } from "./supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** How many of the newest messages the AI reads. */
export const FEED_REPLY_MESSAGES = 10;

const plain = (s: string | null | undefined) => (looksLikeHtml(s ?? "") ? htmlToText(s ?? "") : (s ?? "")).trim();
const WORD: Record<TalkChannel, string> = { email: "email", sms: "text", chat: "portal chat" };

/** The conversation as the AI reads it, oldest first: who, how, when, what. */
export function conversationLines(messages: Message[], first: string): string {
  const said = messages
    .filter((m) => (m.channel === "email" || m.channel === "sms" || m.channel === "chat") && !automaticKind(m))
    .sort(byTime).slice(-FEED_REPLY_MESSAGES);
  return said.map((m) => {
    const who = m.direction === "inbound" ? first.toUpperCase() : "US";
    const subject = m.channel === "email" && m.subject ? ` "${m.subject.trim()}"` : "";
    return `${who} (${WORD[m.channel as TalkChannel]}${subject}, ${String(m.at).slice(0, 10)}):\n${plain(m.body).slice(0, 1500)}`;
  }).join("\n\n");
}

/** The task the reply goes on, as background: its directions and its steps,
 *  the current one with its own directions and to dos. */
export function taskLines(t: { title: string; status?: string | null; due?: string | null; description?: string | null; subtasks?: Subtask[] | null }): string {
  const steps = t.subtasks ?? [];
  const current = steps.findIndex((s) => !s.done);
  const stepLines = steps.slice(0, 15).map((s, i) => {
    const mark = s.done ? "done" : i === current ? "current" : "to do";
    const lines = [`${i + 1}. ${s.title} (${mark})`];
    const notes = plain(s.notes);
    if (notes) lines.push(`   Directions: ${notes.slice(0, i === current ? 900 : 200)}`);
    if (i === current) {
      const todos = (s.todos ?? []).filter((x) => !x.done).slice(0, 10).map((x) => `   - ${x.title}`);
      if (todos.length) lines.push("   Still to do:", ...todos);
    }
    return lines.join("\n");
  });
  return [
    `Title: ${t.title}`,
    t.status ? `Status: ${t.status}` : null,
    t.due ? `Due: ${t.due}` : null,
    plain(t.description) ? `Directions: ${plain(t.description).slice(0, 1200)}` : null,
    stepLines.length ? `Steps:\n${stepLines.join("\n")}` : null,
  ].filter(Boolean).join("\n");
}

/** The prompt: answer the client's newest message, in the channel's length. */
export function feedReplyPrompt(o: { channel: TalkChannel; me: string | null; first: string; conversation: string; task: string | null }): string {
  const shape = o.channel === "email"
    ? ["Respond in EXACTLY this format, plain text only, no markdown, no preamble:", "SUBJECT: <a short, specific subject line>", "BODY: <the email body>", ...EMAIL_FORMAT]
    : o.channel === "sms"
      ? ["Respond in EXACTLY this format, plain text only:", "BODY: <the text message: one to three short sentences, under 300 characters, no greeting line, no sign off>"]
      : ["Respond in EXACTLY this format, plain text only:", "BODY: <the portal chat message: two to four short sentences, under 450 characters, no sign off>"];
  return [
    `Write the next ${WORD[o.channel]} message${o.me ? ` from ${o.me}` : ""} to ${o.first}, a client of a small agency, answering what ${o.first} said last in the conversation below and moving the task forward.`,
    "Sound like a friendly small business owner: plain, warm, short.",
    ...shape,
    "Use only facts from the conversation and the task. Never invent dates, prices or promises. Where you would need something you don't know, write [ADD: what is needed] for the writer to fill in.",
    "Never invent a web address: only use links that appear in the conversation or the task.",
    "Never use em dashes or en dashes.",
    "",
    "CONVERSATION (oldest first):",
    o.conversation || "(nothing said yet)",
    o.task ? "" : null,
    o.task ? "THE TASK THIS MESSAGE GOES ON (background, not to paste):" : null,
    o.task,
  ].filter((l) => l !== null).join("\n");
}

/** Loads what the reply is drafted from: the client's newest messages and
 *  the task (only one of this client's). */
export async function loadFeedReply(clientId: string, taskId: string | null): Promise<{ messages: Message[]; task: string | null; first: string }> {
  const { data: rows } = await supabaseAdmin.from("messages").select("id, contact_id, client_id, task_id, channel, direction, subject, body, created_by, bulk, created_at")
    .eq("client_id", clientId).in("channel", ["email", "sms", "chat"]).not("contact_id", "is", null)
    .order("created_at", { ascending: false }).limit(FEED_REPLY_MESSAGES * 3);
  const messages = (rows ?? []).map((r: any) => ({
    id: r.id, contactId: r.contact_id ?? "", clientId: r.client_id ?? "", taskId: r.task_id ?? null, channel: r.channel, direction: r.direction,
    subject: r.subject ?? null, body: r.body ?? "", createdBy: r.created_by ?? null, bulk: !!r.bulk, at: r.created_at,
  }) as Message);
  const contactId = messages.find((m) => m.direction === "inbound")?.contactId ?? messages[0]?.contactId ?? null;
  const { data: ct } = contactId ? await supabaseAdmin.from("contacts").select("name").eq("id", contactId).maybeSingle() : { data: null };
  const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", clientId).maybeSingle();
  const first = (((ct?.name as string | null) ?? (client?.name as string | null) ?? "").trim().split(/\s+/)[0]) || "the client";
  let task: string | null = null;
  if (taskId) {
    const { data: t } = await supabaseAdmin.from("tasks").select("title, status, due, description, subtasks, client_id").eq("id", taskId).maybeSingle();
    if (t && t.client_id === clientId) task = taskLines(t as any);
  }
  return { messages, task, first };
}

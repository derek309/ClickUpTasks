// Server only: turning a reply to a mention email into a comment on the task.
//
// The mention email goes out from the mentioner's own mailbox (see
// api/notifications/mention-email), so a reply lands back in that mailbox,
// which the Gmail poller already reads every fifteen minutes. The only thing
// missing was knowing which task the thread belongs to, and Gmail answers that
// for free: a reply carries the same threadId as the message it replies to.
// So one row per sent mention email, and the poller can match.
//
// This is deliberately the same shape as the client email ingest
// (inboundIngest.ts), which resolves a task the same way. Two mechanisms for
// "an email came back, put it where it belongs" would be one too many.
import { supabaseAdmin } from "./supabaseAdmin";
import { plainTextToHtml } from "./data";
import { canActOnTask } from "./taskAccess";

/** The start of the mention email's footer line. The email route writes it and
 *  replyOnly cuts at it, for a mail app that quotes without marking the quote. */
export const MENTION_EMAIL_FOOTER = "Reply to this email and your answer lands on the task";

/** The answer alone, without the email it answers. Gmail's text body carries
 *  the whole quoted original under the reply, so without this every reply
 *  became the answer plus the mention email, as one comment. Cuts at the first
 *  line that starts a quote in any of the common shapes:
 *    Gmail, Apple Mail  "On Mon, Sep 29, 2026 at 10:00 AM Derek <d@x> wrote:"
 *                       (Gmail wraps it over two lines when it is long)
 *    any client         a line starting with ">"
 *    Outlook            "-----Original Message-----", or a rule of underscores
 *                       followed by "From:"
 *    unmarked           our own footer sentence */
export function replyOnly(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const wrote = /^On\s.+\swrote:\s*$/;
  const cut = lines.findIndex((line, i) => {
    const l = line.trim();
    return wrote.test(l)
      || (/^On\s/.test(l) && wrote.test(`${l} ${(lines[i + 1] ?? "").trim()}`))
      || l.startsWith(">")
      || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l)
      || (/^_{10,}$/.test(l) && /^From:/i.test((lines[i + 1] ?? "").trim()))
      || l.startsWith(MENTION_EMAIL_FOOTER);
  });
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

/** A From address as a literal ilike pattern: case blind, but _ and % match
 *  only themselves. Unescaped, they are wildcards, and an address with an
 *  underscore could match someone else's profile. */
const exactEmail = (email: string) => email.trim().replace(/[\\%_]/g, (c) => `\\${c}`);

/** Remembers that this Gmail thread is a conversation about this task. Called
 *  after the mention email is sent; failure is not worth failing the send
 *  over, since the email itself is the point and the worst case is the old
 *  behaviour, where a reply goes nowhere. */
export async function rememberMentionThread(gmailThreadId: string, taskId: string, recipientMemberId: string | null) {
  const { error } = await supabaseAdmin.from("mention_email_threads")
    .upsert({ gmail_thread_id: gmailThreadId, task_id: taskId, recipient_member_id: recipientMemberId }, { onConflict: "gmail_thread_id" });
  if (error) console.warn("[mention reply] could not record thread", error.message);
}

/** The task a Gmail thread is about, or null when the thread is not a mention
 *  email of ours. Unknown table (migration not run yet) reads as "no", which
 *  leaves the poller doing exactly what it did before. */
export async function taskForMentionThread(gmailThreadId: string | null | undefined): Promise<{ taskId: string } | null> {
  if (!gmailThreadId) return null;
  const { data, error } = await supabaseAdmin.from("mention_email_threads")
    .select("task_id").eq("gmail_thread_id", gmailThreadId).maybeSingle();
  if (error || !data?.task_id) return null;
  return { taskId: data.task_id as string };
}

/** One inbound reply, as a comment on its task, authored by whoever wrote it.
 *
 *  Returns false when there is nothing to add, which covers every reason a
 *  reply might not belong: an empty body, a sender who is not on the team, a
 *  task that has since gone, and the same email arriving twice.
 */
export async function commentFromMentionReply(args: {
  taskId: string;
  fromEmail: string;
  body: string;
  gmailMessageId: string;
  at?: string;
}): Promise<boolean> {
  const text = replyOnly(args.body);
  if (!text) return false;

  // Only a teammate can write into a task this way. Anyone can put an address
  // in a From header, so this is the check that stops a stranger who learns a
  // thread id from posting into the app.
  const { data: author } = await supabaseAdmin.from("profiles")
    .select("member_id, id, name, email, role").ilike("email", exactEmail(args.fromEmail)).maybeSingle();
  const authorId = (author?.member_id as string | null) ?? (author?.id as string | null);
  if (!author || !authorId) return false;

  const { data: task } = await supabaseAdmin.from("tasks")
    .select("id, title, comments, client_id, assignee_id, is_private, deleted_at").eq("id", args.taskId).maybeSingle();
  if (!task || task.is_private) return false;
  // The same rule the mention route applied before it sent the email: a
  // teammate who could not open this task cannot write into it by mail either.
  const caller = {
    id: author.id as string, memberId: (author.member_id as string | null) ?? null, email: (author.email as string | null) ?? "",
    role: author.role === "admin" ? "admin" as const : "va" as const, canSendMessages: false,
  };
  if (!(await canActOnTask(caller, task))) return false;

  // The Gmail id is the comment's id, which is what makes this safe to run
  // every fifteen minutes: the poller looks two days back, so it will offer
  // the same reply roughly two hundred times, and each one has to be the same
  // comment rather than a new one.
  const id = `cm_gm_${args.gmailMessageId}`;
  const existing = (task.comments as { id?: string }[] | null) ?? [];
  if (existing.some((c) => c?.id === id)) return false;

  const at = args.at ?? new Date().toISOString();
  const comment = { id, authorId, body: plainTextToHtml(text), at, kind: "comment" as const };
  // The RPC rather than a read and replace, so two comments arriving at once
  // cannot overwrite each other (see supabase/realtime.sql).
  const { error } = await supabaseAdmin.rpc("append_comment", { task_id: args.taskId, comment });
  if (error) { console.warn("[mention reply] append failed", error.message); return false; }
  // append_comment stamps updated_by with the author, and the app skips live
  // updates stamped with the viewer's own id, so clear it or the author's other
  // open tabs would not show the comment (same order as MCP add_comment).
  await supabaseAdmin.from("tasks").update({ updated_by: null }).eq("id", args.taskId);

  // Nothing else tells the task's owner an answer arrived by mail. The id is
  // fixed per email so a second pass cannot ring twice.
  const owner = task.assignee_id as string | null;
  if (owner && owner !== authorId) {
    const name = ((author.name as string | null) ?? "").trim() || "A teammate";
    await supabaseAdmin.from("notifications").upsert({
      id: `n_mr_${args.gmailMessageId}`, recipient_id: owner, text: `${name} replied by email on “${task.title}”`,
      task_id: args.taskId, actor_id: authorId, client_id: task.client_id, project_id: null, at, read: false, kind: "message",
    }, { onConflict: "id", ignoreDuplicates: true });
  }
  return true;
}

/** Thread rows stop being useful once nobody is going to reply, so the daily
 *  housekeeping cron drops them after 90 days. A row also dies with its task,
 *  through the foreign key; this is for the tasks that outlive the
 *  conversation, which is most of them. */
export async function purgeOldMentionThreads(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin.from("mention_email_threads")
    .delete().lt("created_at", cutoff).select("gmail_thread_id");
  if (error) { console.warn("[mention reply] purge failed", error.message); return 0; }
  return data?.length ?? 0;
}

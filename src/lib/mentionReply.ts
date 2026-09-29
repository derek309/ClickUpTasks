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
  const text = args.body.trim();
  if (!text) return false;

  // Only a teammate can write into a task this way. Anyone can put an address
  // in a From header, so this is the check that stops a stranger who learns a
  // thread id from posting into the app.
  const { data: author } = await supabaseAdmin.from("profiles")
    .select("member_id, id").ilike("email", args.fromEmail).maybeSingle();
  const authorId = (author?.member_id as string | null) ?? (author?.id as string | null);
  if (!authorId) return false;

  const { data: task } = await supabaseAdmin.from("tasks")
    .select("id, comments, deleted_at").eq("id", args.taskId).maybeSingle();
  if (!task || task.deleted_at) return false;

  // The Gmail id is the comment's id, which is what makes this safe to run
  // every fifteen minutes: the poller looks two days back, so it will offer
  // the same reply roughly two hundred times, and each one has to be the same
  // comment rather than a new one.
  const id = `cm_gm_${args.gmailMessageId}`;
  const existing = (task.comments as { id?: string }[] | null) ?? [];
  if (existing.some((c) => c?.id === id)) return false;

  const comment = {
    id,
    authorId,
    body: plainTextToHtml(text),
    at: args.at ?? new Date().toISOString(),
    kind: "comment" as const,
  };
  // The RPC rather than a read and replace, so two comments arriving at once
  // cannot overwrite each other (see supabase/realtime.sql).
  const { error } = await supabaseAdmin.rpc("append_comment", { task_id: args.taskId, comment });
  if (error) { console.warn("[mention reply] append failed", error.message); return false; }
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

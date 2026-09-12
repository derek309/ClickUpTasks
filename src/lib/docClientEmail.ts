// Server-only: email the client when a teammate comments on their review document
// (Derek, 2026-09-11: their comments already reach the team, ours only showed if
// they came back to the page). Sent from the commenting teammate's own address,
// with a button to the document, at most once every 15 minutes per document so a
// run of comments is one email. Logged as an outbound email on the task.
//
// Quietly does nothing when it can't send: Google sending not set up, a sender
// outside the domain, no permission to message this client, no linked contact
// email, a document with no live link, or a closed task or document.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { sendGmailAs, googleConfigured } from "./googleMail";
import { canCallerMessageClient, type AuthedUser } from "./serverAuth";
import { resolveContact, sentRfc822 } from "./sendMessageServer";
import { appendSignatureHtml } from "./emailSignature";
import { draftLinkAsButton, draftLinkHtml, escapeHtml } from "./draftLink";
import { linkState, type TeamTask } from "./taskDocumentServer";

const SEND_DOMAIN = "clickuplocal.com";
const COOLDOWN_MS = 15 * 60_000;

export async function emailClientAboutComment(opts: { user: AuthedUser; task: TeamTask; documentId: string; comment: string; origin: string }): Promise<boolean> {
  const { user, task, documentId } = opts;
  const sender = user.email ?? "";
  if (!googleConfigured || !sender.toLowerCase().endsWith(`@${SEND_DOMAIN}`) || task.status === "done") return false;
  if (await canCallerMessageClient(user, task.client_id)) return false;

  const { data: doc } = await supabaseAdmin.from("task_documents").select("title, status, deleted_at").eq("id", documentId).maybeSingle();
  if (!doc || doc.deleted_at || doc.status === "completed") return false;
  const link = await linkState(documentId, opts.origin);
  if (!link.live || !link.url) return false;
  const contact = await resolveContact(task.client_id);
  if (!contact?.email) return false;

  // Claimed atomically, so two quick comments can't both send.
  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: claimed } = await supabaseAdmin.from("task_documents")
    .update({ client_comment_emailed_at: new Date().toISOString() })
    .eq("id", documentId)
    .or(`client_comment_emailed_at.is.null,client_comment_emailed_at.lt."${cutoff}"`)
    .select("id");
  if (!claimed?.length) return false;

  const { data: prof } = await supabaseAdmin.from("profiles").select("name, email_signature").ilike("email", sender).maybeSingle();
  const fromName = ((prof?.name as string | null) ?? "").trim();
  const name = ((doc.title as string | null) ?? "").trim() || task.title;
  const button = { url: link.url, label: "Open the document to reply" };
  const subject = `New comment on "${name}"`.slice(0, 200);
  const body = [
    `<p>Hi,</p>`,
    `<p>${escapeHtml(fromName || "We")} left a comment on "${escapeHtml(name)}":</p>`,
    `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #d0dce8">${escapeHtml(opts.comment.trim()).replace(/\n/g, "<br>")}</blockquote>`,
    draftLinkAsButton(draftLinkHtml(button), button),
  ].join("");

  try {
    const sent = await sendGmailAs(sender, {
      to: contact.email, subject, isHtml: true, fromName: fromName || undefined,
      body: appendSignatureHtml(body, (prof?.email_signature as string | null) ?? ""),
    });
    await supabaseAdmin.from("messages").insert({
      id: "msg_" + randomUUID(), contact_id: contact.id, client_id: task.client_id, task_id: task.id,
      channel: "email", direction: "outbound", subject, body,
      ghl_message_id: null, gmail_message_id: sent.id, gmail_thread_id: sent.threadId,
      rfc822_message_id: await sentRfc822(sender, sent.id),
      created_by: user.memberId ?? null, read: true, attachments: [], cc: [], bcc: [],
    });
    return true;
  } catch {
    return false;
  }
}

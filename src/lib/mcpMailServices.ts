// SERVER ONLY. Gmail for the MCP's draft tools (Derek, 2026-10-09: a reply
// Claude writes should be in the conversation in the Inbox AND in Gmail).
// The hosted MCP (src/app/api/mcp/handler.ts) passes these into
// mcp/core.mjs; the local stdio server has no Google keys and skips them.
import { supabaseAdmin } from "./supabaseAdmin";
import { createGmailDraft, deleteGmailDraft, readReplyHeaders, googleConfigured } from "./googleMail";
import { appendSignatureHtml } from "./emailSignature";
import { plainTextToHtml } from "./data";

export function createMailServices() {
  if (!googleConfigured) return {};
  const mailboxOf = async (memberId: string) => {
    const { data } = await supabaseAdmin.from("profiles").select("email, name, email_signature").eq("member_id", memberId).maybeSingle();
    return data?.email ? { email: data.email as string, name: (data.name as string | null) ?? undefined, signature: ((data.email_signature as string | null) ?? "").trim() } : null;
  };
  return {
    /** The reply as a Gmail draft in that mailbox's copy of the conversation,
     *  answering the message `answerId` (a messages row). */
    async gmailReplyDraft(a: { mailboxMemberId: string; answerId: string; to: string; subject: string; body: string }): Promise<{ draftId: string; mailbox: string } | { error: string }> {
      const box = await mailboxOf(a.mailboxMemberId);
      if (!box) return { error: "that mailbox isn't one the app reads" };
      const { data: row } = await supabaseAdmin.from("messages").select("gmail_message_id, rfc822_message_id").eq("id", a.answerId).maybeSingle();
      const replyTo = row ? await readReplyHeaders(box.email, { gmailMessageId: row.gmail_message_id as string | null, rfc822: row.rfc822_message_id as string | null }).catch(() => null) : null;
      try {
        const draftId = await createGmailDraft(box.email, { to: a.to, subject: a.subject, fromName: box.name, replyTo, bodyHtml: appendSignatureHtml(plainTextToHtml(a.body), box.signature) });
        return { draftId, mailbox: box.email };
      } catch (e) { return { error: e instanceof Error ? e.message : "Gmail didn't take it" }; }
    },
    async deleteGmailDraft(mailbox: string, draftId: string): Promise<void> {
      await deleteGmailDraft(mailbox, draftId).catch(() => {});
    },
  };
}

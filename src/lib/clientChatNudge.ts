// The "you have a new message" email to a client after a teammate replies in
// their portal chat. Shared by /api/messages/notify-client (the web app) and
// /api/extension/tasks/[id]/chat (the Inboxes Mac app), so both honour the same
// per-client cooldown and send the same email.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { sendGmailAs } from "./googleMail";
import type { AuthedUser } from "./serverAuth";

const APP_URL = "https://clickuptasks.vercel.app";
const SEND_DOMAIN = "clickuplocal.com";
// One notification per client per window, no matter how many of their tasks
// got a reply in that time — see supabase/client-chat-notify-cooldown.sql
// for why this has to be per-client rather than per-task.
const COOLDOWN_MS = 20 * 60 * 1000;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Best effort: null when the email went (or was attempted), otherwise why it
 *  was skipped. "not-found" means the client does not exist. Callers check
 *  permissions and googleConfigured first. */
export async function nudgeClientAboutChat(caller: AuthedUser, clientId: string): Promise<"not-found" | "cooldown" | "no-email" | null> {
  const { data: client } = await supabaseAdmin.from("clients").select("id, name, share_token, last_chat_notified_at, linked_contact_id").eq("id", clientId).maybeSingle();
  if (!client) return "not-found";

  const lastAt = client.last_chat_notified_at ? new Date(client.last_chat_notified_at as string).getTime() : 0;
  if (Date.now() - lastAt < COOLDOWN_MS) return "cooldown";

  const contactId = (client.linked_contact_id as string | null) || (clientId.startsWith("cl_") ? clientId.slice(3) : null);
  const { data: contact } = contactId ? await supabaseAdmin.from("contacts").select("email").eq("id", contactId).maybeSingle() : { data: null };
  const clientEmail = (contact?.email as string | null)?.trim();
  if (!clientEmail) return "no-email";

  // Mint a share token if this client has never had one — same lazy
  // creation Cockpit.tsx's copyClientShareLink does, just server-side (this
  // always has permission to write it, regardless of the caller's own admin
  // status, since it's the one persisting it).
  const token = (client.share_token as string | null) ?? randomUUID().replace(/-/g, "");
  if (!client.share_token) await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", clientId);

  // No ?task= — multiple of the client's tasks may have new activity by the
  // time this cooldown allows a send, so this points at their whole list
  // rather than just the one that happened to trigger it.
  const link = `${APP_URL}/waiting/${token}`;
  const { data: callerProfile } = await supabaseAdmin.from("profiles").select("name").eq("member_id", caller.memberId ?? "").maybeSingle();
  const senderName = ((callerProfile?.name as string | null) ?? "").trim();
  const html = [
    `<p style="margin:0">${escapeHtml(senderName || "The team")} sent you a new message on ${escapeHtml(client.name as string)}'s account.</p>`,
    `<p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#1b3a5c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">View and reply</a></p>`,
  ].join("");

  try {
    if (caller.email.toLowerCase().endsWith(`@${SEND_DOMAIN}`)) {
      await sendGmailAs(caller.email, {
        to: clientEmail,
        subject: `New message on your ${(client.name as string).trim()} account`.slice(0, 200),
        body: html, isHtml: true, fromName: senderName || undefined,
      });
      await supabaseAdmin.from("clients").update({ last_chat_notified_at: new Date().toISOString() }).eq("id", clientId);
    }
  } catch { /* the chat message itself already sent; this nudge is best-effort */ }
  return null;
}

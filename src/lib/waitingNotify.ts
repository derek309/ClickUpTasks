// Shared by the public /api/waiting/[token] routes (respond + messages) —
// tells the team someone on the client side did something on a task. No
// logged-in caller exists in either route (the client isn't a Workspace
// user), so the companion email is sent self-to-self (recipient's own
// address as both from and to) via domain-wide delegation. That means
// hitting Gmail's Reply button on it just emails yourself, not the client —
// spelled out in bold below rather than left implicit, after a real send
// surfaced exactly that confusion.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { sendGmailAs, googleConfigured } from "./googleMail";

const APP_URL = "https://clickuptasks.vercel.app";
const SEND_DOMAIN = "clickuplocal.com";
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Client's own followers (assigned_to) win; an unassigned client falls back
// to the earliest-created admin — same fallback used throughout the app for
// "whoever owns this when no one's explicitly assigned."
export async function resolveNotifyRecipient(assignedTo: string[] | null | undefined): Promise<string | null> {
  const followers = Array.isArray(assignedTo) ? assignedTo : [];
  if (followers[0]) return followers[0];
  const { data: admin } = await supabaseAdmin
    .from("profiles").select("member_id").eq("role", "admin").not("member_id", "is", null)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  return (admin?.member_id as string | null) ?? null;
}

export async function notifyTeamOfClientActivity(opts: {
  notifyRecipient: string; clientId: string; taskId: string; projectId: string | null;
  clientName: string; taskTitle: string; notifText: string; previewText?: string | null;
  kind?: "activity" | "message";
}): Promise<void> {
  await supabaseAdmin.from("notifications").insert({
    id: "n_" + randomUUID(), recipient_id: opts.notifyRecipient,
    text: opts.notifText, task_id: opts.taskId, actor_id: null, client_id: opts.clientId, project_id: opts.projectId,
    at: new Date().toISOString(), read: false, kind: opts.kind ?? "activity",
  });

  if (!googleConfigured) return;
  try {
    const { data: recipientProfile } = await supabaseAdmin.from("profiles").select("email").eq("member_id", opts.notifyRecipient).maybeSingle();
    const recipientEmail = (recipientProfile?.email as string | undefined)?.trim();
    if (!recipientEmail?.toLowerCase().endsWith(`@${SEND_DOMAIN}`)) return;

    const link = `${APP_URL}/?task=${encodeURIComponent(opts.taskId)}`;
    const clientName = escapeHtml(opts.clientName);
    const preview = opts.previewText
      ? `<p style="margin:16px 0 0">Their message:</p><p style="margin:4px 0 0;padding:10px 12px;background:#f6f9fd;border-radius:8px;white-space:pre-wrap">${escapeHtml(opts.previewText.slice(0, 1000))}</p>`
      : "";
    const html = [
      `<p style="margin:0">${escapeHtml(opts.notifText)}</p>`,
      preview,
      `<p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#1b3a5c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open in ClickUpTasks</a></p>`,
      `<p style="margin:0;color:#6b7280;font-size:13px"><strong>This is a notification only. Do not reply to this email.</strong> Replying goes nowhere. Click the button above to respond to ${clientName}.</p>`,
    ].join("");
    await sendGmailAs(recipientEmail, {
      to: recipientEmail,
      subject: `${opts.clientName} replied on "${opts.taskTitle}"`.slice(0, 200),
      body: html,
      isHtml: true,
    });
  } catch { /* email is a nice-to-have; the in-app notification already fired */ }
}

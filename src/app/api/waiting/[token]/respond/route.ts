import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { todayIso, applyWaitingStatusSync, type Attachment, type Task } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";
import { isRateLimited } from "@/lib/rateLimit";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";

const APP_URL = "https://clickuptasks.vercel.app";
const SEND_DOMAIN = "clickuplocal.com";

// Public, token-gated — the client submits (or edits) their reply to a
// waiting-on-them task. Reassignment/due-date/notification only fire when
// the task is CURRENTLY waiting_on_client (i.e. this submission is
// answering the call, whether it's the first response or a later one after
// the team re-flagged it) — tweaking an already-submitted response while
// the team hasn't picked it up yet is just an edit, not a new ping.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (await isRateLimited(req, token)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, assigned_to").eq("share_token", token).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await req.json().catch(() => null) as { taskId?: string; body?: string; attachments?: Attachment[] } | null;
  const taskId = payload?.taskId;
  const text = (payload?.body ?? "").slice(0, 10000).trim();
  // Never trust the caller's attachment objects — rebuild each from a storage
  // path we can prove belongs to this client (see sanitizeWaitingAttachments).
  const attachments = sanitizeWaitingAttachments(payload?.attachments, client.id);
  if (!taskId) return NextResponse.json({ error: "Missing taskId." }, { status: 400 });
  if (!text && attachments.length === 0) return NextResponse.json({ error: "Add a note or attachment before saving." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, project_id, title, waiting_on_client, status").eq("id", taskId).maybeSingle();
  if (!task || task.client_id !== client.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.status === "done") return NextResponse.json({ error: "This item has already been completed." }, { status: 400 });

  // Build the effective change in the app's own camelCase Task shape so it
  // can run through applyWaitingStatusSync — the same rule that keeps
  // status:"waiting" and waitingOnClient in lockstep everywhere else — before
  // translating back to snake_case columns for the actual write.
  const camelPatch: Partial<Task> = {};

  // A client attaching an image (a marked-up screenshot, a photo of
  // something wrong) is treated as feedback that needs the team's eyes on
  // it — flip status so it stands out in the list/board, distinct from a
  // plain text-only reply.
  if (attachments.some((a) => a.kind === "image")) camelPatch.status = "changes_requested";

  let notifyRecipient: string | null = null;
  let dueToday = false;
  if (task.waiting_on_client === true) {
    const followers: string[] = Array.isArray(client.assigned_to) ? client.assigned_to : [];
    let assignee: string | null = followers[0] ?? null;
    if (!assignee) {
      const { data: admin } = await supabaseAdmin
        .from("profiles").select("member_id").eq("role", "admin").not("member_id", "is", null)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      assignee = admin?.member_id ?? null;
    }
    camelPatch.waitingOnClient = false;
    camelPatch.assigneeId = assignee;
    dueToday = true;
    notifyRecipient = assignee;
  }

  const synced: Partial<Task> = { ...camelPatch, ...applyWaitingStatusSync({ status: task.status, waitingOnClient: task.waiting_on_client }, camelPatch) };

  const patch: Record<string, unknown> = {
    client_response: { body: text, attachments, submittedAt: new Date().toISOString() },
  };
  if (synced.status !== undefined) patch.status = synced.status;
  if (synced.waitingOnClient !== undefined) patch.waiting_on_client = synced.waitingOnClient;
  if (synced.assigneeId !== undefined) patch.assignee_id = synced.assigneeId;
  if (dueToday) patch.due = todayIso();

  const { error } = await supabaseAdmin.from("tasks").update(patch).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (notifyRecipient) {
    await supabaseAdmin.from("notifications").insert({
      id: "n_" + randomUUID(), recipient_id: notifyRecipient,
      text: `${client.name} responded on "${task.title}" — ready to work on`,
      task_id: taskId, actor_id: null, client_id: client.id, project_id: task.project_id ?? null,
      at: new Date().toISOString(), read: false, kind: "activity",
    });

    // Best-effort email companion to the in-app notification above, same
    // silently-degrading philosophy as mention-email/notifications-email —
    // this is a public, client-facing route and must never fail (or even
    // slow down) because email sending is unconfigured or errors. There's no
    // logged-in caller here to send "as" (the client isn't a Workspace
    // user), so this sends the recipient their own notification email —
    // still a real Workspace send via domain-wide delegation, just self-to-self.
    if (googleConfigured) {
      try {
        const { data: recipientProfile } = await supabaseAdmin.from("profiles").select("email").eq("member_id", notifyRecipient).maybeSingle();
        const recipientEmail = (recipientProfile?.email as string | undefined)?.trim();
        if (recipientEmail?.toLowerCase().endsWith(`@${SEND_DOMAIN}`)) {
          const link = `${APP_URL}/?task=${encodeURIComponent(taskId)}`;
          const preview = text ? `\n\nTheir reply:\n"${text.slice(0, 1000)}"` : "";
          await sendGmailAs(recipientEmail, {
            to: recipientEmail,
            subject: `${client.name} responded on "${task.title}"`.slice(0, 200),
            body: `${client.name} just responded on "${task.title}" — ready to work on.${preview}\n\nView in ClickUpTasks: ${link}`,
          });
        }
      } catch { /* email is a nice-to-have; the in-app notification already fired */ }
    }
  }

  return NextResponse.json({ ok: true });
}

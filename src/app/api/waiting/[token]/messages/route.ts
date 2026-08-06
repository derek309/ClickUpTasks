import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { type Attachment } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";
import { rateLimit } from "@/lib/rateLimit";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "@/lib/waitingNotify";
import { resolveWaitingToken } from "@/lib/waitingToken";

// Public, token-gated — the client sends one message in a running, per-task
// chat (as opposed to ./respond/route.ts's one-shot "submit your answer").
// Every message just lands in the same `messages` table the rest of the app
// already reads/writes (channel: "chat", task-scoped) — the team sees it in
// the task drawer's existing Activity feed with zero new UI on their side,
// and it threads alongside any real email sent from that task.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimit(req, token, "message");
  if (limited) return limited;

  const scope = await resolveWaitingToken(token);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await req.json().catch(() => null) as { taskId?: string; body?: string; attachments?: Attachment[] } | null;
  const taskId = payload?.taskId;
  const text = (payload?.body ?? "").slice(0, 10000).trim();
  const attachments = sanitizeWaitingAttachments(payload?.attachments, scope.clientId);
  if (!taskId) return NextResponse.json({ error: "Missing taskId." }, { status: 400 });
  if (!text && attachments.length === 0) return NextResponse.json({ error: "Add a message or attachment first." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, project_id, contact_id, title, status").eq("id", taskId).eq("is_private", false).maybeSingle();
  if (!task || task.client_id !== scope.clientId || (scope.projectId && task.project_id !== scope.projectId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.status === "done") return NextResponse.json({ error: "This item has already been completed." }, { status: 400 });

  // The task's own contact_id covers the normal case; a task created without
  // one (rare, but the column is nullable) falls back to the same
  // client-to-contact derivation used elsewhere in the app (resolveContact
  // in sendMessageServer.ts) — an explicit link, else the id-derived contact.
  const contactId = (task.contact_id as string | null) || scope.linkedContactId || (scope.clientId.startsWith("cl_") ? scope.clientId.slice(3) : null);
  if (!contactId) return NextResponse.json({ error: "This client isn't linked to a contact." }, { status: 400 });

  const messageId = "msg_" + randomUUID();
  const { error } = await supabaseAdmin.from("messages").insert({
    id: messageId, contact_id: contactId, client_id: scope.clientId, task_id: taskId,
    channel: "chat", direction: "inbound", subject: null, body: text, attachments, created_by: null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const notifyRecipient = await resolveNotifyRecipient(scope.assignedTo);
  if (notifyRecipient) {
    await notifyTeamOfClientActivity({
      notifyRecipient, clientId: scope.clientId, taskId, projectId: task.project_id ?? null,
      clientName: scope.clientName, taskTitle: task.title,
      notifText: `${scope.clientName} sent a message on "${task.title}".`,
      previewText: text || null,
      kind: "message",
    });
  }

  return NextResponse.json({ ok: true, messageId });
}

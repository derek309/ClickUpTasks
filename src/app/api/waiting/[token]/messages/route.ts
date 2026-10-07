import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { type Attachment, clientAnswerPatch } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";
import { rateLimit } from "@/lib/rateLimit";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "@/lib/waitingNotify";
import { resolveWaitingToken } from "@/lib/waitingToken";
import { clientAnsweredOnTask } from "@/lib/clientAnswered";

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

  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, project_id, contact_id, title, status, waiting_on_client, assignee_id, subtasks").eq("id", taskId).eq("is_private", false).is("deleted_at", null).maybeSingle();
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
  await clientAnsweredOnTask(taskId, "reply");

  // The task's own owner first, as in respond and status.
  const notifyRecipient = (task.assignee_id as string | null) ?? await resolveNotifyRecipient(scope.assignedTo);
  // Their message answers a task that was waiting on them: it comes back to
  // us in Review, the same rule as answering with a choice (Derek,
  // 2026-10-07: Pam replied and the task still said Waiting).
  const patch: Record<string, unknown> = clientAnswerPatch(task, notifyRecipient);
  // What they wrote goes on the task's checklist as one of their changes, so
  // it can be ticked off here and they see it done on their page (Derek,
  // 2026-10-07). A few words of thanks are not a change.
  const firstLine = text.split(/\n/).map((x) => x.trim()).find(Boolean) ?? "";
  if (firstLine.split(/\s+/).length >= 4) {
    const list = Array.isArray(task.subtasks) ? task.subtasks : [];
    patch.subtasks = [...list, { id: "s_" + randomUUID().replace(/-/g, "").slice(0, 12), title: firstLine.slice(0, 200), done: false, fromClient: true }];
  }
  if (Object.keys(patch).length) await supabaseAdmin.from("tasks").update({ ...patch, updated_by: null }).eq("id", taskId);
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

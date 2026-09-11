import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { clientAnswerPatch, type Attachment } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";
import { rateLimit } from "@/lib/rateLimit";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "@/lib/waitingNotify";
import { resolveWaitingToken } from "@/lib/waitingToken";

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
  const limited = await rateLimit(req, token, "respond");
  if (limited) return limited;

  const scope = await resolveWaitingToken(token);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await req.json().catch(() => null) as { taskId?: string; body?: string; attachments?: Attachment[] } | null;
  const taskId = payload?.taskId;
  const text = (payload?.body ?? "").slice(0, 10000).trim();
  // Never trust the caller's attachment objects — rebuild each from a storage
  // path we can prove belongs to this client (see sanitizeWaitingAttachments).
  const attachments = sanitizeWaitingAttachments(payload?.attachments, scope.clientId);
  if (!taskId) return NextResponse.json({ error: "Missing taskId." }, { status: 400 });
  if (!text && attachments.length === 0) return NextResponse.json({ error: "Add a note or attachment before saving." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, project_id, title, waiting_on_client, status, assignee_id").eq("id", taskId).eq("is_private", false).is("deleted_at", null).maybeSingle();
  if (!task || task.client_id !== scope.clientId || (scope.projectId && task.project_id !== scope.projectId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.status === "done") return NextResponse.json({ error: "This item has already been completed." }, { status: 400 });

  // Resolve who should hear about this: the task's own owner first, because
  // waiting keeps the assignee (whoever is following up on it). Only a task
  // nobody owns falls back to the client's followers, else the earliest admin.
  // Assigning and the due bump stay exclusive to the "this was waiting on
  // them" case; a reply on a task shared via its own ticket link (never
  // flagged waiting) still needs to reach someone, it just doesn't reassign
  // or reopen anything. That rule lives in clientAnswerPatch.
  const owner = (task.assignee_id as string | null) ?? null;
  const notifyRecipient = owner ?? await resolveNotifyRecipient(scope.assignedTo);

  // A client attaching an image (a marked-up screenshot, a photo of
  // something wrong) is treated as feedback that needs the team's eyes on
  // it — flip status so it stands out in the list/board, distinct from a
  // plain text-only reply.
  const imageFeedback = attachments.some((a) => a.kind === "image");
  const patch: Record<string, unknown> = {
    client_response: { body: text, attachments, submittedAt: new Date().toISOString() },
    ...clientAnswerPatch(task, notifyRecipient, imageFeedback ? "changes_requested" : undefined),
  };

  const { error } = await supabaseAdmin.from("tasks").update({ ...patch, updated_by: null }).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (notifyRecipient) {
    await notifyTeamOfClientActivity({
      notifyRecipient, clientId: scope.clientId, taskId, projectId: task.project_id ?? null,
      clientName: scope.clientName, taskTitle: task.title,
      notifText: `${scope.clientName} responded on "${task.title}". Ready to work on.`,
      previewText: text || null,
    });
  }

  return NextResponse.json({ ok: true });
}

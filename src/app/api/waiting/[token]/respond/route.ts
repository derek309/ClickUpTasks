import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { todayIso, applyWaitingStatusSync, type Attachment, type Task } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";
import { rateLimit } from "@/lib/rateLimit";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "@/lib/waitingNotify";

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

  // Resolve who should hear about this: the client's own followers, else
  // the earliest admin — same fallback either way. Only reassignment/due-
  // bump is exclusive to the "this was waiting on them" case below; a reply
  // on a task shared via its own ticket link (never flagged waiting) still
  // needs to reach someone, it just doesn't reassign/reopen anything.
  const notifyRecipient = await resolveNotifyRecipient(client.assigned_to as string[] | null);
  let dueToday = false;
  if (task.waiting_on_client === true) {
    camelPatch.waitingOnClient = false;
    camelPatch.assigneeId = notifyRecipient;
    dueToday = true;
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
    await notifyTeamOfClientActivity({
      notifyRecipient, clientId: client.id, taskId, projectId: task.project_id ?? null,
      clientName: client.name, taskTitle: task.title,
      notifText: `${client.name} responded on "${task.title}". Ready to work on.`,
      previewText: text || null,
    });
  }

  return NextResponse.json({ ok: true });
}

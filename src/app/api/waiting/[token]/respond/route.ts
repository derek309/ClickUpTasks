import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { todayIso, type Attachment } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";

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

  const patch: Record<string, unknown> = {
    client_response: { body: text, attachments, submittedAt: new Date().toISOString() },
  };

  // A client attaching an image (a marked-up screenshot, a photo of
  // something wrong) is treated as feedback that needs the team's eyes on
  // it — flip status so it stands out in the list/board, distinct from a
  // plain text-only reply.
  if (attachments.some((a) => a.kind === "image")) patch.status = "changes_requested";

  let notifyRecipient: string | null = null;
  if (task.waiting_on_client === true) {
    const followers: string[] = Array.isArray(client.assigned_to) ? client.assigned_to : [];
    let assignee: string | null = followers[0] ?? null;
    if (!assignee) {
      const { data: admin } = await supabaseAdmin
        .from("profiles").select("member_id").eq("role", "admin").not("member_id", "is", null)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      assignee = admin?.member_id ?? null;
    }
    patch.waiting_on_client = false;
    patch.assignee_id = assignee;
    patch.due = todayIso();
    notifyRecipient = assignee;
  }

  const { error } = await supabaseAdmin.from("tasks").update(patch).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (notifyRecipient) {
    await supabaseAdmin.from("notifications").insert({
      id: "n_" + randomUUID(), recipient_id: notifyRecipient,
      text: `${client.name} responded on "${task.title}" — ready to work on`,
      task_id: taskId, actor_id: null, client_id: client.id, project_id: task.project_id ?? null,
      at: new Date().toISOString(), read: false, kind: "activity",
    });
  }

  return NextResponse.json({ ok: true });
}

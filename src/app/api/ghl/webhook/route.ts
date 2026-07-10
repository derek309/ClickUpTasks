import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Inbound webhook: GoHighLevel → ClickUpTasks (the "pull" half of two-way sync).
// Handles two independent event families sharing one URL + secret: task sync
// (below) and, first, inbound message replies (see handleMessageReply).
//
// Wire-up (after the app is deployed to a public URL):
//   Task sync — in each sub-account: Automation → Workflow, trigger
//   "Task Added" / "Task Completed" → action "Webhook" → POST to
//   https://<your-app>/api/ghl/webhook?secret=<GHL_WEBHOOK_SECRET>
//
//   Message replies — a second Workflow, trigger "Customer Replied" → action
//   "Webhook" → same URL. Unlike the task triggers, GHL doesn't expose a fixed
//   payload shape here, you type the JSON body yourself with merge fields, so
//   this route defines the exact contract: POST a body shaped like
//     { "event": "message_reply", "contactId": "{{contact.id}}",
//       "channel": "email", "subject": "{{message.subject}}",
//       "body": "{{message.body}}", "messageId": "{{message.id}}" }
//   (channel/subject/messageId are optional; contactId + body are required.)
//
// Security: shared-secret query param (set GHL_WEBHOOK_SECRET in env). GHL
// workflow webhooks can't sign requests, so a long random secret in the URL is
// the standard guard.
//
// Behavior (deliberately conservative — GHL is not the source of truth):
//   - task completed in GHL  → mark the matching linked task done here.
//   - task deleted in GHL    → unlink here (keep our task, drop ghl_task_id).
//   - title/body/due changed → update the matching linked task's fields.
// Matching key: tasks.ghl_task_id.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  const secret = process.env.GHL_WEBHOOK_SECRET || "";
  if (!secret || req.nextUrl.searchParams.get("secret") !== secret)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));

  if (body?.event === "message_reply") return handleMessageReply(body);

  // GHL workflow webhook payloads vary; accept the common shapes.
  const ghlTaskId: string | null = body?.task?.id ?? body?.taskId ?? body?.id ?? null;
  if (!ghlTaskId) return NextResponse.json({ ok: true, skipped: "no task id in payload" });

  const { data: row } = await supabaseAdmin.from("tasks").select("id, status, subtasks").eq("ghl_task_id", ghlTaskId).maybeSingle();
  if (!row) return NextResponse.json({ ok: true, skipped: "no linked task" });

  const patch: Record<string, unknown> = {};
  const title = body?.task?.title ?? body?.title;
  const desc = body?.task?.body ?? body?.body;
  const due = body?.task?.dueDate ?? body?.dueDate;
  const completed = body?.task?.completed ?? body?.completed;
  if (typeof title === "string" && title.trim()) patch.title = title.trim();
  if (typeof desc === "string") patch.description = desc;
  if (typeof due === "string" && /^\d{4}-\d{2}-\d{2}/.test(due)) patch.due = due.slice(0, 10);
  if (completed === true && row.status !== "done") patch.status = "done";
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, skipped: "nothing to update" });

  const { error } = await supabaseAdmin.from("tasks").update(patch).eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: Object.keys(patch) });
}

// The "push" half of two-way messaging: a customer's reply, relayed by a GHL
// Workflow into the exact payload shape documented above the POST handler.
// Matching key: contacts.ghl_contact_id (a message isn't tied to any one
// task, see the Message type's doc comment in src/lib/data.ts).
async function handleMessageReply(body: any) {
  const ghlContactId: string | null = body?.contactId ?? null;
  const text: string | null = typeof body?.body === "string" ? body.body : null;
  if (!ghlContactId || !text) return NextResponse.json({ ok: true, skipped: "missing contactId or body" });

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, client_id")
    .eq("ghl_contact_id", ghlContactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ ok: true, skipped: "no contact for that ghlContactId" });

  const ghlMessageId: string | null = typeof body?.messageId === "string" ? body.messageId : null;
  const { error } = await supabaseAdmin.from("messages").insert({
    id: "msg_" + crypto.randomUUID(),
    contact_id: contact.id,
    client_id: contact.client_id,
    channel: body?.channel === "sms" ? "sms" : "email",
    direction: "inbound",
    subject: typeof body?.subject === "string" ? body.subject : null,
    body: text,
    ghl_message_id: ghlMessageId,
    created_by: null,
  });
  // A duplicate delivery of the same reply (GHL retries on a non-2xx, or the
  // workflow fires twice) hits the partial unique index on ghl_message_id —
  // treat that as already-processed, not a failure, same conservative spirit
  // as the task-sync path above.
  if (error && !error.message.includes("duplicate key")) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

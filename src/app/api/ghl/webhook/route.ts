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
//   "Webhook" → same URL. This Webhook action's UI doesn't take a raw JSON
//   body; instead you add Custom Data key/value rows, which GHL nests under
//   `customData` alongside its own standard trigger data (confirmed against
//   a real payload — do not assume flattened top-level fields here again).
//   Add these 4 Custom Data rows (Value via the merge-field picker except
//   event, which is typed literally):
//     event      -> message_reply
//     contactId  -> {{contact.id}}
//     subject    -> {{message.subject}}
//     body       -> {{message.body}}
//   Channel (email vs sms) isn't set via Custom Data — there's no reliable
//   merge field for it — it's read instead from GHL's own standard
//   `message.type` (3 = email, 2 = sms).
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

  // A GHL "Webhook" action's Custom Data fields land nested under
  // `customData`, not flattened onto the top-level body — confirmed by
  // logging a real "Customer Replied" payload. Every message_reply field
  // (event/contactId/subject/body) lives there.
  const custom = body?.customData ?? {};
  if (custom?.event === "message_reply" || body?.event === "message_reply") return handleMessageReply(body, custom);

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
// "Customer Replied" Workflow's Webhook action. `custom` is that action's
// Custom Data (contactId/subject/body/event — see wire-up notes above);
// `body` is GHL's own standard trigger data alongside it, which is where the
// message's real channel lives (no merge field for that, but GHL's own
// `message.type` numeric code — 3 = email, 2 = sms, confirmed against a real
// payload — tells us directly). Matching key: contacts.ghl_contact_id (a
// message isn't tied to any one task, see the Message type's doc comment in
// src/lib/data.ts).
async function handleMessageReply(body: any, custom: any) {
  const ghlContactId: string | null = custom?.contactId ?? body?.contact_id ?? null;
  const text: string | null = typeof custom?.body === "string" && custom.body.trim() ? custom.body : (typeof body?.message?.body === "string" ? body.message.body : null);
  if (!ghlContactId || !text) return NextResponse.json({ ok: true, skipped: "missing contactId or body" });

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, name, client_id")
    .eq("ghl_contact_id", ghlContactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ ok: true, skipped: "no contact for that ghlContactId" });

  const ghlMessageId: string | null = typeof custom?.messageId === "string" ? custom.messageId : null;
  const { error } = await supabaseAdmin.from("messages").insert({
    id: "msg_" + crypto.randomUUID(),
    contact_id: contact.id,
    client_id: contact.client_id,
    channel: body?.message?.type === 2 ? "sms" : "email",
    direction: "inbound",
    subject: typeof custom?.subject === "string" && custom.subject.trim() ? custom.subject : null,
    body: text,
    ghl_message_id: ghlMessageId,
    created_by: null,
  });
  // A duplicate delivery of the same reply (GHL retries on a non-2xx, or the
  // workflow fires twice) hits the partial unique index on ghl_message_id —
  // treat that as already-processed, not a failure, same conservative spirit
  // as the task-sync path above. Only run the Conversation-task automation
  // on a genuinely new reply, so a retried delivery doesn't bump due twice.
  if (error) {
    if (!error.message.includes("duplicate key")) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  await upsertConversationTask(contact, ghlContactId);
  return NextResponse.json({ ok: true });
}

// Priority-system spec (see PRIORITY_META in src/lib/data.ts): every inbound
// reply keeps exactly one open Conversation-priority task per contact
// thread — a second reply on a thread that already has one open just bumps
// its due date rather than creating a duplicate, per the spec's own
// "Due date updates" section. due doubles as "last touched" here, not a
// deadline, since Conversation always sorts to the top on priority alone.
// Conversation tasks are never auto-completed (spec) — only this creation/
// due-bump path writes to them; completion is left entirely to a person.
async function upsertConversationTask(contact: { id: string; name: string; client_id: string }, ghlContactId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: openTasks } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("client_id", contact.client_id)
    .eq("priority", "conversation")
    .neq("status", "done")
    .limit(1);
  if (openTasks && openTasks.length > 0) {
    await supabaseAdmin.from("tasks").update({ due: today }).eq("id", openTasks[0].id);
    return;
  }

  // Reuse whatever project the client's other tasks live under, same "Tasks"
  // fallback quickAdd/GHL-import use client-side when a client has none yet.
  let projectId: string | undefined = (
    await supabaseAdmin.from("projects").select("id").eq("client_id", contact.client_id).limit(1).maybeSingle()
  ).data?.id;
  if (!projectId) {
    projectId = "p_" + crypto.randomUUID();
    const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: contact.client_id, name: "Tasks", description: "" });
    if (projErr) return;
  }

  const { data: client } = await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", contact.client_id).maybeSingle();
  const ghlUrl = client?.ghl_location_id ? `https://app.gohighlevel.com/v2/location/${client.ghl_location_id}/contacts/detail/${ghlContactId}` : null;

  await supabaseAdmin.from("tasks").insert({
    id: "t_" + crypto.randomUUID(),
    project_id: projectId,
    client_id: contact.client_id,
    title: `Reply to ${contact.name}`,
    priority: "conversation",
    contact_id: contact.id,
    due: today,
    attachments: ghlUrl ? [{ id: "at_" + crypto.randomUUID(), name: "GHL conversation", kind: "link", size: "", url: ghlUrl }] : [],
  });
}

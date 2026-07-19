import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { titleCase } from "@/lib/data";

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
  const ev: string = custom?.event ?? body?.event ?? "";
  if (ev === "call" || ev === "inbound_call" || ev === "missed_call") return handleCall(body, custom);

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
  const messageId = "msg_" + crypto.randomUUID();
  const { error } = await supabaseAdmin.from("messages").insert({
    id: messageId,
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
  // Scope this message to its Conversation task (see the task drawer's
  // Activity feed filter, which reads messages.task_id) — resolved/created
  // after the insert above, not before, so a retried delivery still can't
  // double-bump the task's due date; this is a best-effort backfill, not
  // part of the duplicate-delivery guard.
  const taskId = await upsertConversationTask(contact, ghlContactId);
  if (taskId) await supabaseAdmin.from("messages").update({ task_id: taskId }).eq("id", messageId);
  const channel = body?.message?.type === 2 ? "sms" : "email";
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 80);
  const notifText = channel === "sms"
    ? `${titleCase(contact.name)} sent a text: ${snippet}`
    : `${titleCase(contact.name)} sent an email${typeof custom?.subject === "string" && custom.subject.trim() ? `: ${custom.subject.trim()}` : `: ${snippet}`}`;
  await notifyInbound(contact, taskId, notifText);
  return NextResponse.json({ ok: true });
}

// Ring the bell / add to the Inbox for everyone who should see this client's
// inbound activity — the client's followers (clients.assigned_to) plus all
// admins (who see every client) — so a client texting / emailing / calling in
// surfaces as a notification, not only a Dashboard Conversation task. kind
// "message" so the Inbox "Messages" filter catches it; deep-links to the
// Conversation task when there is one, else to the client. notifications is in
// the realtime publication, so this lights the bell live for open sessions.
async function notifyInbound(contact: { id: string; name: string; client_id: string }, taskId: string | null, text: string) {
  const [{ data: client }, { data: admins }] = await Promise.all([
    supabaseAdmin.from("clients").select("assigned_to").eq("id", contact.client_id).maybeSingle(),
    supabaseAdmin.from("profiles").select("member_id").eq("role", "admin"),
  ]);
  const followers: string[] = Array.isArray(client?.assigned_to) ? (client!.assigned_to as string[]) : [];
  const adminIds: string[] = (admins ?? []).map((a: any) => a.member_id).filter((m: any): m is string => typeof m === "string" && !!m);
  const recipients = Array.from(new Set([...followers, ...adminIds]));
  if (recipients.length === 0) return;
  const nowIso = new Date().toISOString();
  const rows = recipients.map((rid) => ({
    id: "n_" + crypto.randomUUID(), recipient_id: rid, text, task_id: taskId,
    actor_id: null, client_id: contact.client_id, project_id: null, at: nowIso, read: false, kind: "message",
  }));
  const { error } = await supabaseAdmin.from("notifications").insert(rows);
  if (error) console.error("[webhook] notifyInbound insert failed", error);
}

// A GHL call event. Configure a "Call"/"Missed Call" workflow → Webhook action
// with Custom Data rows: event (call | missed_call), contactId ({{contact.id}}),
// and optionally status ({{message.callStatus}} or similar). Reuses the
// one-Conversation-task-per-contact path so a call and a text on the same
// contact share a task, and rings the bell like an inbound message.
async function handleCall(body: any, custom: any) {
  const ghlContactId: string | null = custom?.contactId ?? body?.contact_id ?? null;
  if (!ghlContactId) return NextResponse.json({ ok: true, skipped: "missing contactId" });
  const { data: contact } = await supabaseAdmin.from("contacts").select("id, name, client_id").eq("ghl_contact_id", ghlContactId).maybeSingle();
  if (!contact) return NextResponse.json({ ok: true, skipped: "no contact for that ghlContactId" });
  const taskId = await upsertConversationTask(contact, ghlContactId);
  const status: string = typeof custom?.status === "string" ? custom.status : ((custom?.event ?? body?.event) === "missed_call" ? "missed" : "");
  const label = /miss|no.?answer|voicemail|unanswered/i.test(status) ? "Missed call from" : "Call from";
  await notifyInbound(contact, taskId, `📞 ${label} ${titleCase(contact.name)}`);
  return NextResponse.json({ ok: true });
}

// "Today" for a Conversation task's due date, in the team's operating
// timezone (Pacific) rather than the server's UTC clock — due doubles as
// "last touched" here (see below), and a UTC-computed date can already be
// tomorrow for a US-based reply that just arrived this evening, which would
// misrender as "Tomorrow" in the UI's local-time due-date formatting.
function todayPacific(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// Priority-system spec (see PRIORITY_META in src/lib/data.ts): every inbound
// reply keeps exactly one open Conversation-priority task per contact
// thread — a second reply on the same contact's thread that already has one
// open just bumps its due date rather than creating a duplicate, per the
// spec's own "Due date updates" section. Scoped by contact_id, not
// client_id — a client can have multiple GHL contacts, each with their own
// thread, and conflating them would silently merge one contact's reply into
// another's task. due doubles as "last touched" here, not a deadline, since
// Conversation always sorts to the top on priority alone. Conversation tasks
// are never auto-completed (spec) — only this creation/due-bump path writes
// to them; completion is left entirely to a person.
//
// The open-task lookup is check-then-act, not backed by a DB constraint that
// would make it atomic (see supabase/conversation-task-unique.sql) — instead
// the unique partial index there catches the concurrent-insert race: if two
// deliveries for the same contact both reach the insert, the loser's insert
// fails on that constraint and is treated as "someone else already created
// it," same conservative spirit as the ghl_message_id dedup above.
// Returns the resolved/created Conversation task's id (used to backfill
// task_id onto the message row that triggered this), or null if it couldn't
// be resolved — a lost race against a concurrent delivery for the same
// contact, or a real insert failure (already logged below). Either way the
// message itself is unaffected; it just won't carry a task_id this once.
async function upsertConversationTask(contact: { id: string; name: string; client_id: string }, ghlContactId: string): Promise<string | null> {
  const today = todayPacific();
  const { data: openTasks } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("contact_id", contact.id)
    .eq("priority", "conversation")
    .neq("status", "done")
    .limit(1);
  if (openTasks && openTasks.length > 0) {
    await supabaseAdmin.from("tasks").update({ due: today }).eq("id", openTasks[0].id);
    return openTasks[0].id;
  }

  // Reuse whatever project the client's other tasks live under, same "Tasks"
  // fallback quickAdd/GHL-import use client-side when a client has none yet.
  let projectId: string | undefined = (
    await supabaseAdmin.from("projects").select("id").eq("client_id", contact.client_id).limit(1).maybeSingle()
  ).data?.id;
  if (!projectId) {
    projectId = "p_" + crypto.randomUUID();
    const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: contact.client_id, name: "Tasks", description: "" });
    if (projErr) { console.error("[webhook] upsertConversationTask: fallback project insert failed", projErr); return null; }
  }

  const { data: client } = await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", contact.client_id).maybeSingle();
  const ghlUrl = client?.ghl_location_id ? `https://app.gohighlevel.com/v2/location/${client.ghl_location_id}/contacts/detail/${ghlContactId}` : null;

  const newTaskId = "t_" + crypto.randomUUID();
  const { error: taskErr } = await supabaseAdmin.from("tasks").insert({
    id: newTaskId,
    project_id: projectId,
    client_id: contact.client_id,
    title: `Reply to ${titleCase(contact.name)}`,
    priority: "conversation",
    contact_id: contact.id,
    due: today,
    attachments: ghlUrl ? [{ id: "at_" + crypto.randomUUID(), name: "GHL conversation", kind: "link", size: "", url: ghlUrl }] : [],
  });
  // A concurrent delivery for the same contact can lose the race to the
  // partial unique index in conversation-task-unique.sql — that's the other
  // request's insert having already won, not a real failure.
  if (taskErr) {
    if (!taskErr.message.includes("duplicate key")) console.error("[webhook] upsertConversationTask: task insert failed", taskErr);
    return null;
  }
  return newTaskId;
}

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { titleCase, normalizeState, type PlannerWeek } from "@/lib/data";
import { plannerWeekToRow, rowToPlannerWeek } from "@/lib/db";
import { resolveOrPromoteTrackedClient, upsertConversationTask } from "@/lib/ghlConversationTask";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";

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
//   Invite email opened/clicked — see handleEmailEngagement below for full
//   wire-up (two more Workflows, "Email Events" trigger).
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
  if (ev === "email_opened" || ev === "email_clicked") return handleEmailEngagement(ev, custom);

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
  // A contact's client_id points at the GHL sub-account it was imported from
  // (c_agency / c_directory), not the tracked client. Re-point to the tracked
  // client (cl_<contactId>, or a client manually linked to it) so the message
  // + Conversation task land on the client's page, not off in a sub-account —
  // and if this contact has never been tracked at all, promote them (a real
  // inbound message is a strong enough signal on its own), so they don't
  // silently stay invisible until someone notices and adds them by hand.
  contact.client_id = await resolveOrPromoteTrackedClient(contact);

  const channel = body?.message?.type === 2 ? "sms" : "email";
  // GHL's own message id would be the ideal dedup key, but the wire-up notes
  // above never configure a messageId Custom Data row (there's no confirmed
  // merge field for it), so custom?.messageId is null on every real delivery
  // — the partial unique index on ghl_message_id was never actually catching
  // a retried webhook (GHL retries on a non-2xx, or a workflow can fire
  // twice), so a retry silently duplicated the message + notification. Fall
  // back to a synthetic key — contact + channel + text, bucketed to the
  // hour — so a genuine retry within that window still collides on the same
  // index instead of creating a second row. Bucketing (not an unbounded
  // hash) is deliberate: two truly separate messages with identical text
  // sent hours apart should NOT be treated as the same delivery.
  const hourBucket = new Date().toISOString().slice(0, 13);
  const ghlMessageId: string = typeof custom?.messageId === "string" && custom.messageId
    ? custom.messageId
    : `synthetic:${ghlContactId}:${channel}:${hourBucket}:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
  const messageId = "msg_" + crypto.randomUUID();
  const { error } = await supabaseAdmin.from("messages").insert({
    id: messageId,
    contact_id: contact.id,
    client_id: contact.client_id,
    channel,
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
  contact.client_id = await resolveOrPromoteTrackedClient(contact);
  const taskId = await upsertConversationTask(contact, ghlContactId);
  const status: string = typeof custom?.status === "string" ? custom.status : ((custom?.event ?? body?.event) === "missed_call" ? "missed" : "");
  const missed = /miss|no.?answer|voicemail|unanswered/i.test(status);
  const label = missed ? "Missed call from" : "Call from";

  // Log it to the Journal too, same as handleMessageReply — this webhook's
  // Custom Data setup has no duration field (unlike the Conversations-API
  // backfill in refresh-messages/route.ts), so this entry is just "a call
  // happened," not timed. No confirmed messageId Custom Data merge field
  // here either, so dedup on the same synthetic-hash-bucketed-by-hour key
  // handleMessageReply uses, keyed off status instead of body text.
  const hourBucket = new Date().toISOString().slice(0, 13);
  const ghlMessageId = `synthetic:${ghlContactId}:call:${hourBucket}:${createHash("sha256").update(status || "call").digest("hex").slice(0, 16)}`;
  const { error: msgError } = await supabaseAdmin.from("messages").insert({
    id: "msg_" + crypto.randomUUID(),
    contact_id: contact.id,
    client_id: contact.client_id,
    channel: "call",
    direction: "inbound",
    subject: null,
    body: missed ? "Missed call" : "Call",
    ghl_message_id: ghlMessageId,
    created_by: null,
    task_id: taskId,
  });
  // A duplicate delivery hits the same unique index handleMessageReply
  // relies on — treat as already-processed, don't double-notify.
  if (msgError && !msgError.message.includes("duplicate key")) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }
  if (!msgError) await notifyInbound(contact, taskId, `📞 ${label} ${titleCase(contact.name)}`);
  return NextResponse.json({ ok: true });
}

// A business opened (or clicked) an invite email — "we want to call or
// visit those who opened" (Derek, Aug 3), as its own signal on the
// Businesses page, NOT a Dashboard/Conversation task (his explicit call —
// the Dashboard is for active-client work, this is cold-outreach follow-up).
// So this only ever patches the matching planner_weeks.invited[] entry;
// it never touches tasks/notifications.
//
// Wire-up — two GHL Workflows (Email Events trigger), same Webhook-action
// pattern as message_reply/call above:
//   Trigger "Email Events" -> Opened  -> Webhook, Custom Data:
//     event -> email_opened   (literal)
//     contactId -> {{contact.id}}
//   Trigger "Email Events" -> Clicked -> Webhook, Custom Data:
//     event -> email_clicked  (literal)
//     contactId -> {{contact.id}}
// There's no invite-specific scoping in GHL's trigger itself — this assumes
// the invite is the only email a business gets before claiming, which holds
// today (unclaimed businesses aren't on any other email flow yet).
//
// Contact -> gdPlaceId has no stored mapping (planner_weeks.invited only
// carries gdPlaceId, contacts only carries ghl_contact_id), so this
// re-derives it the same way the Businesses page does client-side: contact's
// city/state -> that territory's directory listings -> match by
// ghlContactId, then phone, then email (same fallback chain, see
// TerritoryDirectory.tsx's own comment on why the chain exists).
async function handleEmailEngagement(event: "email_opened" | "email_clicked", custom: any) {
  const ghlContactId: string | null = custom?.contactId ?? null;
  if (!ghlContactId) return NextResponse.json({ ok: true, skipped: "missing contactId" });

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("ghl_contact_id, phone, email, city, state")
    .eq("ghl_contact_id", ghlContactId)
    .maybeSingle();
  if (!contact?.city || !contact?.state) return NextResponse.json({ ok: true, skipped: "no contact / no city-state on file" });

  const { data: territoryRows } = await supabaseAdmin.from("territories").select("id, city, state");
  const wantState = normalizeState(contact.state);
  const territory = (territoryRows ?? []).find(
    (t: any) => String(t.city ?? "").trim().toLowerCase() === contact.city.trim().toLowerCase() && normalizeState(t.state ?? "") === wantState
  );
  if (!territory) return NextResponse.json({ ok: true, skipped: "no territory for that city/state" });

  const listingsResult = await fetchDirectoryListingsServer(contact.city, contact.state);
  if ("error" in listingsResult) return NextResponse.json({ ok: true, skipped: listingsResult.error });

  const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();
  const listing =
    listingsResult.listings.find((l) => l.ghlContactId && l.ghlContactId === ghlContactId) ??
    (digits(contact.phone) ? listingsResult.listings.find((l) => digits(l.phone) === digits(contact.phone)) : undefined) ??
    (contact.email ? listingsResult.listings.find((l) => lc(l.email) === lc(contact.email)) : undefined);
  if (!listing) return NextResponse.json({ ok: true, skipped: "no listing matched to that contact" });
  const gdPlaceId = typeof listing.id === "number" ? listing.id : parseInt(String(listing.id), 10);
  if (!Number.isFinite(gdPlaceId)) return NextResponse.json({ ok: true, skipped: "listing has no usable id" });

  const { data: weekRows } = await supabaseAdmin.from("planner_weeks").select("*").eq("territory_id", territory.id);
  const weeks: PlannerWeek[] = (weekRows ?? []).map(rowToPlannerWeek);
  // The most recent invite entry for this business, across every week —
  // an open naturally correlates to whichever send was last, not an older one.
  let targetWeek: PlannerWeek | null = null;
  let targetIdx = -1;
  for (const w of weeks) {
    w.invited.forEach((inv, i) => {
      if (inv.gdPlaceId !== gdPlaceId) return;
      if (!targetWeek || inv.at > targetWeek.invited[targetIdx].at) { targetWeek = w; targetIdx = i; }
    });
  }
  if (!targetWeek || targetIdx === -1) return NextResponse.json({ ok: true, skipped: "no invite on record for that business" });

  const nowIso = new Date().toISOString();
  const field = event === "email_opened" ? "openedAt" : "clickedAt";
  const patchedInvited = (targetWeek as PlannerWeek).invited.map((inv, i) => (i === targetIdx ? { ...inv, [field]: nowIso } : inv));
  const { error } = await supabaseAdmin.from("planner_weeks").upsert(plannerWeekToRow({ ...(targetWeek as PlannerWeek), invited: patchedInvited }));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, gdPlaceId, event });
}

// resolveTrackedClientId / upsertConversationTask now live in
// @/lib/ghlConversationTask (shared with the appointment sync poll).

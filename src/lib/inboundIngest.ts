// Shared ingest for an inbound client message that arrives outside the GHL
// webhook — right now, a client email that came back through Gmail directly
// (see /api/google/poll-replies). Mirrors what the GHL webhook's
// handleMessageReply does: log the message, keep one open "Conversation"
// task per contact (bumping its due), and ring the bell / fill the Inbox for
// the client's followers + admins. Deliberately a separate copy from the
// webhook (which stays untouched) — same behavior, different entry point.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { titleCase } from "@/lib/data";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Contact = { id: string; name: string; client_id: string };

function todayPacific(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// Map a contact to the tracked client that represents it (cl_<contactId>, or
// a client linked via linked_contact_id) — a contact's own client_id points at
// the GHL sub-account it was imported from, not the client's page.
async function resolveTrackedClientId(contactId: string, fallback: string): Promise<string> {
  const { data } = await supabaseAdmin.from("clients").select("id").or(`id.eq.cl_${contactId},linked_contact_id.eq.${contactId}`).limit(1);
  if (data?.[0]) return data[0].id;
  // Absorbed-by-merge fallback (jsonb array containment) — see the twin of
  // this function in ghlConversationTask.ts for why it's a separate query.
  const { data: merged } = await supabaseAdmin.from("clients").select("id").contains("linked_contact_ids", [contactId]).limit(1);
  return merged?.[0]?.id ?? fallback;
}

// Twin of ghlConversationTask.ts's resolveOrPromoteTrackedClient (kept as its
// own copy for the same "deliberately separate from the webhook" reason as
// the rest of this file) — auto-creates a tracked client the first time a
// contact who was never promoted sends a real inbound message, instead of
// silently filing it under the GHL sub-account until someone notices.
async function resolveOrPromoteTrackedClient(contact: Contact): Promise<string> {
  const resolved = await resolveTrackedClientId(contact.id, contact.client_id);
  if (resolved !== contact.client_id) return resolved;

  const trackedId = "cl_" + contact.id;
  const { data: existing } = await supabaseAdmin.from("clients").select("id").eq("id", trackedId).maybeSingle();
  if (!existing) {
    const { error } = await supabaseAdmin.from("clients").insert({
      id: trackedId, name: contact.name, color: "#a855f7", ghl_location_id: "", status: "claimed", type: "prospect", assigned_to: [],
    });
    if (error) {
      console.error("[inboundIngest] resolveOrPromoteTrackedClient: client insert failed", error);
      return await resolveTrackedClientId(contact.id, contact.client_id);
    }
  }
  await supabaseAdmin.from("contacts").update({ client_id: trackedId }).eq("id", contact.id);
  return trackedId;
}

// Ticket-style threading: if this inbound message's Gmail thread already has
// an outbound message tied to a specific task (composed from that task's own
// email tab, not just the generic Conversation task), route the reply back
// to that same task instead of bumping/creating a "Reply to X" task. Gmail
// assigns the SAME threadId to a client's reply as the message we sent it
// replied to (standard References/In-Reply-To threading), so this is a
// simple most-recent-match lookup — no header parsing needed. Once a thread
// has been matched to a task once (even the generic Conversation task, on a
// cold thread's first inbound), every later reply in that thread keeps
// landing on the same task, since the inbound rows also get tagged with the
// thread id below.
async function resolveTaskForThread(contactId: string, gmailThreadId: string | null | undefined): Promise<string | null> {
  if (!gmailThreadId) return null;
  const { data } = await supabaseAdmin
    .from("messages").select("task_id").eq("contact_id", contactId).eq("gmail_thread_id", gmailThreadId)
    .not("task_id", "is", null).order("created_at", { ascending: false }).limit(1);
  return (data?.[0]?.task_id as string | undefined) ?? null;
}

// One open Conversation-priority task per contact — bump due if one exists,
// else create it under the client's first project (or a fallback "Tasks").
async function upsertConversationTask(contact: Contact, ghlContactId: string | null): Promise<string | null> {
  const today = todayPacific();
  const { data: openTasks } = await supabaseAdmin
    .from("tasks").select("id").eq("contact_id", contact.id).eq("priority", "conversation").neq("status", "done").limit(1);
  if (openTasks && openTasks.length > 0) {
    await supabaseAdmin.from("tasks").update({ due: today, updated_by: null }).eq("id", openTasks[0].id);
    return openTasks[0].id;
  }
  let projectId: string | undefined = (
    await supabaseAdmin.from("projects").select("id").eq("client_id", contact.client_id).limit(1).maybeSingle()
  ).data?.id;
  if (!projectId) {
    projectId = "p_" + crypto.randomUUID();
    const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: contact.client_id, name: "Tasks", description: "" });
    if (projErr) return null;
  }
  const { data: client } = await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", contact.client_id).maybeSingle();
  const ghlUrl = client?.ghl_location_id && ghlContactId ? `https://app.gohighlevel.com/v2/location/${client.ghl_location_id}/contacts/detail/${ghlContactId}` : null;
  const newTaskId = "t_" + crypto.randomUUID();
  const { error: taskErr } = await supabaseAdmin.from("tasks").insert({
    id: newTaskId, project_id: projectId, client_id: contact.client_id,
    title: `Reply to ${titleCase(contact.name)}`, priority: "conversation", contact_id: contact.id, due: today,
    attachments: ghlUrl ? [{ id: "at_" + crypto.randomUUID(), name: "GHL conversation", kind: "link", size: "", url: ghlUrl }] : [],
    created_by: null,
  });
  if (taskErr) return null;
  return newTaskId;
}

// Returns the recipient list so the caller can hand it straight to
// sendInboundReplyEmail without recomputing followers + admins.
async function notifyInbound(contact: Contact, taskId: string | null, text: string): Promise<string[]> {
  const [{ data: client }, { data: admins }] = await Promise.all([
    supabaseAdmin.from("clients").select("assigned_to").eq("id", contact.client_id).maybeSingle(),
    supabaseAdmin.from("profiles").select("member_id").eq("role", "admin"),
  ]);
  const followers: string[] = Array.isArray(client?.assigned_to) ? (client!.assigned_to as string[]) : [];
  const adminIds: string[] = (admins ?? []).map((a: any) => a.member_id).filter((m: any): m is string => typeof m === "string" && !!m);
  const recipients = Array.from(new Set([...followers, ...adminIds]));
  if (recipients.length === 0) return recipients;
  const nowIso = new Date().toISOString();
  const rows = recipients.map((rid) => ({
    id: "n_" + crypto.randomUUID(), recipient_id: rid, text, task_id: taskId,
    actor_id: null, client_id: contact.client_id, project_id: null, at: nowIso, read: false, kind: "message",
  }));
  await supabaseAdmin.from("notifications").insert(rows);
  return recipients;
}

const APP_URL = "https://clickuptasks.vercel.app";
const SEND_DOMAIN = "clickuplocal.com";
// One inbound-reply email per CLIENT per window, however many messages they
// fire off inside it — a client sending four texts in a row is one
// conversation, not four alerts. Same 20-minute figure and same
// read-the-timestamp shape as the client-facing chat nudge
// (/api/messages/notify-client), but deliberately its OWN column: sharing
// clients.last_chat_notified_at would let an inbound text silently suppress
// the client's own "you have a new message" email, and vice versa. Those two
// are opposite directions of traffic and must not throttle each other.
// See supabase/inbound-reply-notify-cooldown.sql.
//
// Keyed on the client, NOT client+channel: a client who texts and then emails
// in the same five minutes is still one conversation, and the two ingest
// paths (Gmail poller and the GHL webhook) can both see the same message,
// which a per-channel key would not collapse. The channel still appears in
// the subject of whichever alert wins the window, and every message keeps its
// own bell row regardless.
const INBOUND_EMAIL_COOLDOWN_MS = 20 * 60 * 1000;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The email half of "notify me when a client replies", for replies that
// arrive by REAL email or SMS rather than through the client portal (the
// portal's own routes have had this since day one via waitingNotify). Shared
// by both inbound entry points — this file's ingestInboundMessage (Gmail
// poller) and /api/ghl/webhook's handleMessageReply.
//
// No logged-in caller exists on either path, so, exactly like waitingNotify,
// the mail is sent self-to-self (each recipient's own Workspace address as
// both From and To) through domain-wide delegation — hence the explicit
// do-not-reply line, since hitting Reply would just email yourself.
//
// Entirely best effort: the bell row has already been written by the time
// this runs, and every failure path here returns quietly. Ingestion must
// never fail because Gmail did.
export async function sendInboundReplyEmail(opts: {
  clientId: string;
  contactName: string;
  channel: "email" | "sms";
  subject?: string | null;
  body: string;
  taskId: string | null;
  recipientIds: string[];
}): Promise<void> {
  if (!googleConfigured || opts.recipientIds.length === 0) return;
  try {
    const { data: client } = await supabaseAdmin
      .from("clients").select("name, last_inbound_notified_at").eq("id", opts.clientId).maybeSingle();
    // Also the guard for "the migration hasn't been run yet" — an unknown
    // column makes this select error, data comes back null, and we quietly
    // send nothing rather than throwing inside message ingestion.
    if (!client) return;

    const lastAt = client.last_inbound_notified_at ? new Date(client.last_inbound_notified_at as string).getTime() : 0;
    if (Date.now() - lastAt < INBOUND_EMAIL_COOLDOWN_MS) return;
    // Claim the window BEFORE sending, not after: two messages landing at
    // once (the poller and the webhook can both see the same reply) would
    // otherwise both read a stale timestamp and both send. A send that then
    // fails costs one missed alert, which is the cheaper mistake.
    await supabaseAdmin.from("clients").update({ last_inbound_notified_at: new Date().toISOString() }).eq("id", opts.clientId);

    const { data: profiles } = await supabaseAdmin
      .from("profiles").select("member_id, email, email_notify_message").in("member_id", opts.recipientIds);
    // Same two gates the in-app notification email route applies: honor the
    // per-user "message" email opt-out, and only send to addresses this
    // Workspace can actually send as.
    const targets = (profiles ?? []).filter((p: any) =>
      p.email_notify_message !== false && typeof p.email === "string" && p.email.trim().toLowerCase().endsWith(`@${SEND_DOMAIN}`));
    if (targets.length === 0) return;

    const who = titleCase(opts.contactName) || (client.name as string) || "A client";
    const flat = opts.body.replace(/\s+/g, " ").trim();
    const trimmedSubject = opts.subject?.trim();
    // Enough of the message to judge whether it needs answering now, without
    // dragging a paragraph into the subject line. An email with a real
    // subject line leads with that; a text has only its body.
    const headline = opts.channel === "sms" ? flat.slice(0, 90) : (trimmedSubject || flat.slice(0, 90));
    const subject = `${who} replied by ${opts.channel === "sms" ? "text" : "email"}${headline ? `: ${headline}` : ""}`.slice(0, 200);

    const link = opts.taskId ? `${APP_URL}/?task=${encodeURIComponent(opts.taskId)}` : `${APP_URL}/?client=${encodeURIComponent(opts.clientId)}`;
    const html = [
      `<p style="margin:0">${escapeHtml(who)} replied by ${opts.channel === "sms" ? "text" : "email"}.</p>`,
      trimmedSubject && opts.channel !== "sms" ? `<p style="margin:16px 0 0"><strong>${escapeHtml(trimmedSubject)}</strong></p>` : "",
      `<p style="margin:8px 0 0;padding:10px 12px;background:#f6f9fd;border-radius:8px;white-space:pre-wrap">${escapeHtml(opts.body.slice(0, 1500))}</p>`,
      `<p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#1b3a5c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open in ClickUpTasks</a></p>`,
      `<p style="margin:0;color:#6b7280;font-size:13px"><strong>This is a notification only. Do not reply to this email.</strong> Replying goes nowhere. Click the button above to answer ${escapeHtml(who)}.</p>`,
    ].join("");

    // Per-recipient try/catch — one bad mailbox must not cost everyone else
    // their alert, and the window has already been claimed either way.
    await Promise.all(targets.map(async (p: any) => {
      try {
        await sendGmailAs(p.email.trim(), { to: p.email.trim(), subject, body: html, isHtml: true });
      } catch (e) {
        console.error("[inboundIngest] sendInboundReplyEmail: send failed", p.member_id, e);
      }
    }));
  } catch (e) {
    console.error("[inboundIngest] sendInboundReplyEmail failed", e);
  }
}

// Ingest one inbound message. Deduped on gmail_message_id — a message already
// pulled (or the app's own sent copy) is skipped. Returns true if a new
// message was ingested.
export async function ingestInboundMessage(opts: {
  contact: Contact; ghlContactId?: string | null; channel: "email" | "sms";
  subject?: string | null; body: string; gmailMessageId?: string | null; gmailThreadId?: string | null; at?: string;
}): Promise<boolean> {
  const contact = { ...opts.contact, client_id: await resolveOrPromoteTrackedClient(opts.contact) };
  const { channel, subject, body } = opts;
  if (opts.gmailMessageId) {
    const { data: dupe } = await supabaseAdmin.from("messages").select("id").eq("gmail_message_id", opts.gmailMessageId).limit(1);
    if (dupe && dupe.length > 0) return false;
  }
  const messageId = "msg_" + crypto.randomUUID();
  const { error } = await supabaseAdmin.from("messages").insert({
    id: messageId, contact_id: contact.id, client_id: contact.client_id, channel, direction: "inbound",
    subject: subject?.trim() || null, body, gmail_message_id: opts.gmailMessageId ?? null, gmail_thread_id: opts.gmailThreadId ?? null, created_by: null,
    ...(opts.at ? { created_at: opts.at } : {}),
  });
  if (error) {
    // A unique-index hit (e.g. gmail_message_id) means it was already ingested.
    return false;
  }
  // A reply within a thread that started from a specific task's own email tab
  // (ticket-style) lands back on that same task, bumped to today so it
  // resurfaces; only a thread with no such history falls back to the
  // generic per-contact Conversation task.
  let taskId = await resolveTaskForThread(contact.id, opts.gmailThreadId);
  if (taskId) await supabaseAdmin.from("tasks").update({ due: todayPacific(), updated_by: null }).eq("id", taskId);
  else taskId = await upsertConversationTask(contact, opts.ghlContactId ?? null);
  if (taskId) await supabaseAdmin.from("messages").update({ task_id: taskId }).eq("id", messageId);
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 80);
  const text = channel === "sms"
    ? `${titleCase(contact.name)} sent a text: ${snippet}`
    : `${titleCase(contact.name)} sent an email${subject?.trim() ? `: ${subject.trim()}` : `: ${snippet}`}`;
  const recipients = await notifyInbound(contact, taskId, text);
  // The bell above is what this path has always done; the email is the half
  // that was missing — "notify me when a client replies" only ever mailed for
  // portal replies, never for a real email or text. Rate-limited per client
  // inside the helper, and swallows its own failures.
  await sendInboundReplyEmail({
    clientId: contact.client_id, contactName: contact.name, channel,
    subject: subject ?? null, body, taskId, recipientIds: recipients,
  });
  return true;
}

// Shared by refresh-messages/route.ts and ingestOutboundMessage below: an
// email sent through the app's own composer has no gmail_message_id (it
// wasn't read back from Gmail), so a later scan that sees GHL's or Gmail's
// own copy of the same send can't dedup on that id — match by contact +
// normalized body within a time window instead. `normalizeBody`/`DEDUP_WINDOW_MS`
// are exported so a caller looping over many candidate messages (refresh-messages)
// can fetch the contact's existing outbound rows ONCE and match in-memory,
// rather than re-querying per message the way the one-shot `isDuplicateOutboundBody`
// convenience below does (fine for its single-message call site, wrong for a loop).
export const normalizeBody = (s: string) => (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200);
export const DEDUP_WINDOW_MS = 10 * 60 * 1000;
export async function isDuplicateOutboundBody(contactId: string, body: string, dateAdded: string): Promise<boolean> {
  const { data: outRows } = await supabaseAdmin.from("messages").select("body, created_at").eq("contact_id", contactId).eq("direction", "outbound");
  const nb = normalizeBody(body);
  const t = new Date(dateAdded).getTime();
  return (outRows ?? []).some((r) => normalizeBody(r.body as string) === nb && Math.abs(new Date(r.created_at as string).getTime() - t) <= DEDUP_WINDOW_MS);
}

// Twin of ingestInboundMessage, for a teammate's own reply sent directly from
// their Gmail (not the in-app composer) — see /api/google/poll-replies'
// Sent-folder pass. Deliberately minimal: just makes the message visible in
// the Journal. Does NOT touch the Conversation task or fire a notification —
// nobody needs pinging that the team sent something, unlike an inbound reply.
export async function ingestOutboundMessage(opts: {
  contact: Contact; channel: "email"; subject?: string | null; body: string; gmailMessageId: string; gmailThreadId?: string | null; createdBy: string; at?: string;
}): Promise<boolean> {
  const contact = { ...opts.contact, client_id: await resolveOrPromoteTrackedClient(opts.contact) };
  const { data: dupe } = await supabaseAdmin.from("messages").select("id").eq("gmail_message_id", opts.gmailMessageId).limit(1);
  if (dupe && dupe.length > 0) return false;
  if (await isDuplicateOutboundBody(contact.id, opts.body, opts.at ?? new Date().toISOString())) return false;
  const { error } = await supabaseAdmin.from("messages").insert({
    id: "msg_" + crypto.randomUUID(), contact_id: contact.id, client_id: contact.client_id,
    channel: opts.channel, direction: "outbound",
    subject: opts.subject?.trim() || null, body: opts.body, gmail_message_id: opts.gmailMessageId, gmail_thread_id: opts.gmailThreadId ?? null, created_by: opts.createdBy,
    ...(opts.at ? { created_at: opts.at } : {}),
  });
  if (error) return false; // unique-index hit (already ingested) — not a real failure
  return true;
}

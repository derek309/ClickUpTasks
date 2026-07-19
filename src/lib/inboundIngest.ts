// Shared ingest for an inbound client message that arrives outside the GHL
// webhook — right now, a client email that came back through Gmail directly
// (see /api/google/poll-replies). Mirrors what the GHL webhook's
// handleMessageReply does: log the message, keep one open "Conversation"
// task per contact (bumping its due), and ring the bell / fill the Inbox for
// the client's followers + admins. Deliberately a separate copy from the
// webhook (which stays untouched) — same behavior, different entry point.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { titleCase } from "@/lib/data";

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
  return data?.[0]?.id ?? fallback;
}

// One open Conversation-priority task per contact — bump due if one exists,
// else create it under the client's first project (or a fallback "Tasks").
async function upsertConversationTask(contact: Contact, ghlContactId: string | null): Promise<string | null> {
  const today = todayPacific();
  const { data: openTasks } = await supabaseAdmin
    .from("tasks").select("id").eq("contact_id", contact.id).eq("priority", "conversation").neq("status", "done").limit(1);
  if (openTasks && openTasks.length > 0) {
    await supabaseAdmin.from("tasks").update({ due: today }).eq("id", openTasks[0].id);
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
  });
  if (taskErr) return null;
  return newTaskId;
}

async function notifyInbound(contact: Contact, taskId: string | null, text: string) {
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
  await supabaseAdmin.from("notifications").insert(rows);
}

// Ingest one inbound message. Deduped on gmail_message_id — a message already
// pulled (or the app's own sent copy) is skipped. Returns true if a new
// message was ingested.
export async function ingestInboundMessage(opts: {
  contact: Contact; ghlContactId?: string | null; channel: "email" | "sms";
  subject?: string | null; body: string; gmailMessageId?: string | null; at?: string;
}): Promise<boolean> {
  const contact = { ...opts.contact, client_id: await resolveTrackedClientId(opts.contact.id, opts.contact.client_id) };
  const { channel, subject, body } = opts;
  if (opts.gmailMessageId) {
    const { data: dupe } = await supabaseAdmin.from("messages").select("id").eq("gmail_message_id", opts.gmailMessageId).limit(1);
    if (dupe && dupe.length > 0) return false;
  }
  const messageId = "msg_" + crypto.randomUUID();
  const { error } = await supabaseAdmin.from("messages").insert({
    id: messageId, contact_id: contact.id, client_id: contact.client_id, channel, direction: "inbound",
    subject: subject?.trim() || null, body, gmail_message_id: opts.gmailMessageId ?? null, created_by: null,
    ...(opts.at ? { created_at: opts.at } : {}),
  });
  if (error) {
    // A unique-index hit (e.g. gmail_message_id) means it was already ingested.
    return false;
  }
  const taskId = await upsertConversationTask(contact, opts.ghlContactId ?? null);
  if (taskId) await supabaseAdmin.from("messages").update({ task_id: taskId }).eq("id", messageId);
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 80);
  const text = channel === "sms"
    ? `${titleCase(contact.name)} sent a text: ${snippet}`
    : `${titleCase(contact.name)} sent an email${subject?.trim() ? `: ${subject.trim()}` : `: ${snippet}`}`;
  await notifyInbound(contact, taskId, text);
  return true;
}

// Data-access layer over Supabase. Maps snake_case DB rows <-> our camelCase
// domain types, seeds demo data on first run, and exposes upsert/delete helpers.

import { supabase } from "./supabase";
import {
  clientsSeed,
  contactsSeed,
  projectsSeed,
  seedTasks,
  seedNotifications,
  type Task,
  type Client,
  type Project,
  type Contact,
  type Notification,
  type ClientLink,
  type ClientNote,
  type NoteType,
  type Comment,
  type Message,
  type MessageChannel,
  type MessageDirection,
} from "./data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Capitalize the first letter of each word (leaves existing caps + numbers alone).
export const titleCase = (s: string) => (s || "").replace(/\b([a-z])/g, (m) => m.toUpperCase());

// --- mappers ----------------------------------------------------------------

const clientToRow = (c: Client) => ({ id: c.id, name: c.name, color: c.color, ghl_location_id: c.ghlLocationId, status: c.status ?? "lead", type: c.type ?? "client", assigned_to: c.assignedTo ?? [] });
export const rowToClient = (r: any): Client => ({ id: r.id, name: titleCase(r.name), color: r.color, ghlLocationId: r.ghl_location_id ?? "", status: (r.status as Client["status"]) ?? "lead", type: (r.type as Client["type"]) ?? "client", assignedTo: r.assigned_to ?? [] });

const contactToRow = (c: Contact) => ({ id: c.id, client_id: c.clientId, name: c.name, email: c.email, ghl_contact_id: c.ghlContactId });
const rowToContact = (r: any): Contact => ({ id: r.id, clientId: r.client_id, name: titleCase(r.name), email: r.email ?? "", ghlContactId: r.ghl_contact_id ?? "" });

const projectToRow = (p: Project) => ({ id: p.id, client_id: p.clientId, name: p.name, description: p.description });
const rowToProject = (r: any): Project => ({ id: r.id, clientId: r.client_id, name: r.name, description: r.description ?? "" });

// `updatedBy` is DB-only metadata (Realtime echo-suppression signal) — it is
// not part of the domain Task type, so it's a separate write-time parameter
// rather than a Task field. See src/lib/realtime.ts for how it's consumed.
const taskToRow = (t: Task, updatedBy?: string | null) => ({
  id: t.id, project_id: t.projectId, client_id: t.clientId, title: t.title, description: t.description,
  status: t.status, priority: t.priority, assignee_id: t.assigneeId, contact_id: t.contactId, due: t.due,
  recurrence: t.recurrence, ghl_task_id: t.ghlTaskId, label_ids: t.labelIds, subtasks: t.subtasks,
  attachments: t.attachments, comments: t.comments, updated_by: updatedBy ?? null,
});
export const rowToTask = (r: any): Task => ({
  id: r.id, projectId: r.project_id, clientId: r.client_id, title: r.title, description: r.description ?? "",
  status: r.status, priority: r.priority, assigneeId: r.assignee_id, contactId: r.contact_id, due: r.due,
  recurrence: r.recurrence, ghlTaskId: r.ghl_task_id, labelIds: r.label_ids ?? [], subtasks: r.subtasks ?? [],
  attachments: r.attachments ?? [], comments: r.comments ?? [], createdAt: r.created_at ?? new Date().toISOString(),
});

const notifToRow = (n: Notification) => ({ id: n.id, recipient_id: n.recipientId, text: n.text, task_id: n.taskId, at: n.at, read: n.read });
export const rowToNotif = (r: any): Notification => ({ id: r.id, recipientId: r.recipient_id, text: r.text, taskId: r.task_id, at: r.at ?? "", read: r.read });

// Free text (link labels, note bodies) — no titleCase, unlike GHL-sourced names.
const clientLinkToRow = (l: ClientLink) => ({ id: l.id, client_id: l.clientId, group_label: l.groupLabel, label: l.label, url: l.url, position: l.position });
const rowToClientLink = (r: any): ClientLink => ({ id: r.id, clientId: r.client_id, groupLabel: r.group_label ?? "", label: r.label, url: r.url, position: r.position ?? 0 });

const clientNoteToRow = (n: ClientNote) => ({ id: n.id, client_id: n.clientId, type: n.type, body: n.body, author_id: n.authorId, created_at: n.at });
const rowToClientNote = (r: any): ClientNote => ({ id: r.id, clientId: r.client_id, type: (r.type as NoteType) ?? "note", body: r.body ?? "", authorId: r.author_id, at: r.created_at });

const messageToRow = (m: Message) => ({
  id: m.id, contact_id: m.contactId, client_id: m.clientId, channel: m.channel, direction: m.direction,
  subject: m.subject, body: m.body, ghl_message_id: m.ghlMessageId, created_by: m.createdBy, read: m.read,
});
export const rowToMessage = (r: any): Message => ({
  id: r.id, contactId: r.contact_id, clientId: r.client_id, channel: (r.channel as MessageChannel) ?? "email",
  direction: r.direction as MessageDirection, subject: r.subject ?? null, body: r.body ?? "",
  ghlMessageId: r.ghl_message_id ?? null, createdBy: r.created_by ?? null, at: r.created_at,
  read: r.read ?? true,
});

// --- load + seed ------------------------------------------------------------

export async function seedIfEmpty(): Promise<void> {
  const { count, error } = await supabase.from("clients").select("*", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) return;
  await supabase.from("clients").insert(clientsSeed.map(clientToRow));
  await supabase.from("contacts").insert(contactsSeed.map(contactToRow));
  await supabase.from("projects").insert(projectsSeed.map(projectToRow));
  // NOT `.map(taskToRow)` directly — Array.map invokes its callback with
  // (element, index, array), and taskToRow's 2nd param is now `updatedBy`,
  // so a bare `.map(taskToRow)` would pass the array index as updatedBy.
  await supabase.from("tasks").insert(seedTasks.map((t) => taskToRow(t)));
  await supabase.from("notifications").insert(seedNotifications.map(notifToRow));
}

// PostgREST caps a single response at 1000 rows (Supabase's default
// db-max-rows) regardless of how many actually match — a plain .select("*")
// silently truncates past that, no error. With 3,500+ contacts (and tasks
// headed the same way once every ClickUpLocal client is migrated in), that
// silently hid ~2,500 contacts from search/add entirely. Pages through with
// .range() until a page comes back short.
async function fetchAllRows(table: string, orderCol?: string, ascending = true) {
  const PAGE_SIZE = 1000;
  let all: any[] = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (orderCol) q = q.order(orderCol, { ascending });
    const { data, error } = await q;
    if (error) return { data: null as any[] | null, error };
    all = all.concat(data ?? []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null as null | { message: string } };
}

export async function fetchAll() {
  const [c, ct, p, t, n, cl, cn, m] = await Promise.all([
    fetchAllRows("clients", "created_at"),
    fetchAllRows("contacts"),
    fetchAllRows("projects"),
    fetchAllRows("tasks", "created_at"),
    fetchAllRows("notifications", "created_at", false),
    // Fetched separately from the hard-fail set below: these tables ship via a
    // manually-run migration (client-links-notes.sql / messages.sql), so a
    // not-yet-run migration must degrade to "nothing yet", not break the app.
    fetchAllRows("client_links", "position"),
    fetchAllRows("client_notes", "created_at", false),
    fetchAllRows("messages", "created_at"),
  ]);
  const err = c.error || ct.error || p.error || t.error || n.error;
  if (err) throw err;
  if (cl.error) console.warn("[db] client_links unavailable — run supabase/client-links-notes.sql", cl.error.message);
  if (cn.error) console.warn("[db] client_notes unavailable — run supabase/client-links-notes.sql", cn.error.message);
  if (m.error) console.warn("[db] messages unavailable — run supabase/messages.sql", m.error.message);
  return {
    clients: (c.data ?? []).map(rowToClient),
    contacts: (ct.data ?? []).map(rowToContact),
    projects: (p.data ?? []).map(rowToProject),
    tasks: (t.data ?? []).map(rowToTask),
    notifications: (n.data ?? []).map(rowToNotif),
    clientLinks: cl.error ? [] : (cl.data ?? []).map(rowToClientLink),
    clientNotes: cn.error ? [] : (cn.data ?? []).map(rowToClientNote),
    messages: m.error ? [] : (m.data ?? []).map(rowToMessage),
  };
}

export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await fetchAllRows("contacts");
  if (error) throw error;
  return (data ?? []).map(rowToContact);
}

// --- mutations (fire-and-forget from the UI; errors surface via console) -----

export const upsertTask = (t: Task, updatedBy?: string | null) => supabase.from("tasks").upsert(taskToRow(t, updatedBy)).then(logErr);
// Atomic JSONB array-append (see supabase/realtime.sql append_comment) —
// avoids the read-then-full-row-replace race that a plain upsertTask() would
// have if two teammates comment on the same task within the same window.
export const appendCommentDb = (taskId: string, comment: Comment) => supabase.rpc("append_comment", { task_id: taskId, comment }).then(logErr);
export const deleteTaskDb = (id: string) => supabase.from("tasks").delete().eq("id", id).then(logErr);
export const upsertClient = (c: Client) => supabase.from("clients").upsert(clientToRow(c)).then(logErr);
export const upsertProject = (p: Project) => supabase.from("projects").upsert(projectToRow(p)).then(logErr);
export const deleteProjectDb = (id: string) => supabase.from("projects").delete().eq("id", id).then(logErr);
export const deleteClientDb = (id: string) => supabase.from("clients").delete().eq("id", id).then(logErr);
export const insertNotif = (n: Notification) => supabase.from("notifications").insert(notifToRow(n)).then(logErr);
export const markNotifsReadDb = (recipientId: string) => supabase.from("notifications").update({ read: true }).eq("recipient_id", recipientId).then(logErr);
export const upsertClientLink = (l: ClientLink) => supabase.from("client_links").upsert(clientLinkToRow(l)).then(logErr);
export const deleteClientLinkDb = (id: string) => supabase.from("client_links").delete().eq("id", id).then(logErr);
export const upsertClientNote = (n: ClientNote) => supabase.from("client_notes").upsert(clientNoteToRow(n)).then(logErr);
export const deleteClientNoteDb = (id: string) => supabase.from("client_notes").delete().eq("id", id).then(logErr);
// Messages are append-only (never edited), so insert not upsert. The caller
// awaits the GHL send first (see Cockpit.tsx sendMessage) and only inserts an
// outbound row after a confirmed success; this call itself is still
// fire-and-forget from the UI's perspective, same as every other mutation here.
export const insertMessage = (m: Message) => supabase.from("messages").insert(messageToRow(m)).then(logErr);
// One write per opened conversation, not per message — flips every unread
// inbound row for that contact in a single UPDATE.
export const markMessagesReadDb = (contactId: string) =>
  supabase.from("messages").update({ read: true }).eq("contact_id", contactId).eq("read", false).then(logErr);

// Every upsert/delete above is fire-and-forget from the UI's perspective — this
// is the single choke point where a failed save gets surfaced. Dispatches a
// DOM event rather than importing a toast function so db.ts stays UI-agnostic;
// Cockpit listens once and turns it into a visible toast.
function logErr({ error }: { error: any }) {
  if (error) {
    console.error("[db]", error.message);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("cut:save-error", { detail: error.message }));
  }
}

// --- file storage (Supabase Storage) ----------------------------------------
// Task attachments live in a private `task-files` bucket, keyed by task id.
// Uploads run under the signed-in user; downloads use short-lived signed URLs.
export const TASK_FILES_BUCKET = "task-files";

export async function uploadTaskFile(path: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.storage.from(TASK_FILES_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signedUrlForFile(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(TASK_FILES_BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

export async function deleteTaskFile(path: string): Promise<void> {
  await supabase.storage.from(TASK_FILES_BUCKET).remove([path]).then(logErr);
}

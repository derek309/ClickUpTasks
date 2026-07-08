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
} from "./data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Capitalize the first letter of each word (leaves existing caps + numbers alone).
export const titleCase = (s: string) => (s || "").replace(/\b([a-z])/g, (m) => m.toUpperCase());

// --- mappers ----------------------------------------------------------------

const clientToRow = (c: Client) => ({ id: c.id, name: c.name, color: c.color, ghl_location_id: c.ghlLocationId });
const rowToClient = (r: any): Client => ({ id: r.id, name: titleCase(r.name), color: r.color, ghlLocationId: r.ghl_location_id ?? "" });

const contactToRow = (c: Contact) => ({ id: c.id, client_id: c.clientId, name: c.name, email: c.email, ghl_contact_id: c.ghlContactId });
const rowToContact = (r: any): Contact => ({ id: r.id, clientId: r.client_id, name: titleCase(r.name), email: r.email ?? "", ghlContactId: r.ghl_contact_id ?? "" });

const projectToRow = (p: Project) => ({ id: p.id, client_id: p.clientId, name: p.name, description: p.description });
const rowToProject = (r: any): Project => ({ id: r.id, clientId: r.client_id, name: r.name, description: r.description ?? "" });

const taskToRow = (t: Task) => ({
  id: t.id, project_id: t.projectId, client_id: t.clientId, title: t.title, description: t.description,
  status: t.status, priority: t.priority, assignee_id: t.assigneeId, contact_id: t.contactId, due: t.due,
  recurrence: t.recurrence, ghl_task_id: t.ghlTaskId, label_ids: t.labelIds, subtasks: t.subtasks,
  attachments: t.attachments, comments: t.comments,
});
const rowToTask = (r: any): Task => ({
  id: r.id, projectId: r.project_id, clientId: r.client_id, title: r.title, description: r.description ?? "",
  status: r.status, priority: r.priority, assigneeId: r.assignee_id, contactId: r.contact_id, due: r.due,
  recurrence: r.recurrence, ghlTaskId: r.ghl_task_id, labelIds: r.label_ids ?? [], subtasks: r.subtasks ?? [],
  attachments: r.attachments ?? [], comments: r.comments ?? [],
});

const notifToRow = (n: Notification) => ({ id: n.id, recipient_id: n.recipientId, text: n.text, task_id: n.taskId, at: n.at, read: n.read });
const rowToNotif = (r: any): Notification => ({ id: r.id, recipientId: r.recipient_id, text: r.text, taskId: r.task_id, at: r.at ?? "", read: r.read });

// --- load + seed ------------------------------------------------------------

export async function seedIfEmpty(): Promise<void> {
  const { count, error } = await supabase.from("clients").select("*", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) return;
  await supabase.from("clients").insert(clientsSeed.map(clientToRow));
  await supabase.from("contacts").insert(contactsSeed.map(contactToRow));
  await supabase.from("projects").insert(projectsSeed.map(projectToRow));
  await supabase.from("tasks").insert(seedTasks.map(taskToRow));
  await supabase.from("notifications").insert(seedNotifications.map(notifToRow));
}

export async function fetchAll() {
  const [c, ct, p, t, n] = await Promise.all([
    supabase.from("clients").select("*").order("created_at"),
    supabase.from("contacts").select("*"),
    supabase.from("projects").select("*"),
    supabase.from("tasks").select("*").order("created_at"),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }),
  ]);
  const err = c.error || ct.error || p.error || t.error || n.error;
  if (err) throw err;
  return {
    clients: (c.data ?? []).map(rowToClient),
    contacts: (ct.data ?? []).map(rowToContact),
    projects: (p.data ?? []).map(rowToProject),
    tasks: (t.data ?? []).map(rowToTask),
    notifications: (n.data ?? []).map(rowToNotif),
  };
}

export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await supabase.from("contacts").select("*");
  if (error) throw error;
  return (data ?? []).map(rowToContact);
}

// --- mutations (fire-and-forget from the UI; errors surface via console) -----

export const upsertTask = (t: Task) => supabase.from("tasks").upsert(taskToRow(t)).then(logErr);
export const deleteTaskDb = (id: string) => supabase.from("tasks").delete().eq("id", id).then(logErr);
export const upsertClient = (c: Client) => supabase.from("clients").upsert(clientToRow(c)).then(logErr);
export const upsertProject = (p: Project) => supabase.from("projects").upsert(projectToRow(p)).then(logErr);
export const deleteProjectDb = (id: string) => supabase.from("projects").delete().eq("id", id).then(logErr);
export const deleteClientDb = (id: string) => supabase.from("clients").delete().eq("id", id).then(logErr);
export const insertNotif = (n: Notification) => supabase.from("notifications").insert(notifToRow(n)).then(logErr);
export const markNotifsReadDb = (recipientId: string) => supabase.from("notifications").update({ read: true }).eq("recipient_id", recipientId).then(logErr);

function logErr({ error }: { error: any }) {
  if (error) console.error("[db]", error.message);
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

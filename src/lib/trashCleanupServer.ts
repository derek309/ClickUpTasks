// Server-only: daily sweep that permanently removes anything past its
// 30-day Trash window (see supabase/soft-delete.sql). Fired by
// /api/cron/purge-trash (see vercel.json). Clients first — ON DELETE
// CASCADE takes their still-trashed projects/tasks with them, so the later
// project/task passes only ever hit rows an expired client didn't already
// carry away.
import { supabaseAdmin } from "./supabaseAdmin";
import { deleteDocStorage } from "./taskDocumentFiles";

const RETENTION_DAYS = 30;

export async function purgeExpiredTrash(): Promise<{ documents: number; clients: number; projects: number; tasks: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Client documents deleted from a task (supabase/task-document-trash.sql). Their
  // stored files go first, then the row, whose cascade takes versions, saved
  // drafts, file rows, comments and the link.
  const { data: expiredDocs } = await supabaseAdmin.from("task_documents").select("id").lt("deleted_at", cutoff).limit(200);
  for (const d of expiredDocs ?? []) await deleteDocStorage(d.id as string);
  const documents = expiredDocs?.length
    ? await supabaseAdmin.from("task_documents").delete().in("id", expiredDocs.map((d) => d.id as string)).select("id")
    : { data: [] };
  const clients = await supabaseAdmin.from("clients").delete().lt("deleted_at", cutoff).select("id");
  const projects = await supabaseAdmin.from("projects").delete().lt("deleted_at", cutoff).select("id");
  const tasks = await supabaseAdmin.from("tasks").delete().lt("deleted_at", cutoff).select("id");
  return { documents: documents.data?.length ?? 0, clients: clients.data?.length ?? 0, projects: projects.data?.length ?? 0, tasks: tasks.data?.length ?? 0 };
}

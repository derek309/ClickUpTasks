// Server-only: daily sweep that permanently removes anything past its
// 30-day Trash window (see supabase/soft-delete.sql). Fired by
// /api/cron/purge-trash (see vercel.json). Clients first — ON DELETE
// CASCADE takes their still-trashed projects/tasks with them, so the later
// project/task passes only ever hit rows an expired client didn't already
// carry away.
import { supabaseAdmin } from "./supabaseAdmin";

const RETENTION_DAYS = 30;

export async function purgeExpiredTrash(): Promise<{ clients: number; projects: number; tasks: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const clients = await supabaseAdmin.from("clients").delete().lt("deleted_at", cutoff).select("id");
  const projects = await supabaseAdmin.from("projects").delete().lt("deleted_at", cutoff).select("id");
  const tasks = await supabaseAdmin.from("tasks").delete().lt("deleted_at", cutoff).select("id");
  return { clients: clients.data?.length ?? 0, projects: projects.data?.length ?? 0, tasks: tasks.data?.length ?? 0 };
}

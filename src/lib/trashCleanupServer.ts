// Server-only: daily sweep that permanently removes anything past its
// 30-day Trash window (see supabase/soft-delete.sql). Fired by
// /api/cron/purge-trash (see vercel.json). Clients first — ON DELETE
// CASCADE takes their still-trashed projects/tasks with them, so the later
// project/task passes only ever hit rows an expired client didn't already
// carry away.
//
// Two guards on that cascade:
// - A client or project that still holds something live (a task restored on
//   its own, or a reply that brought its "Reply to" task back) is kept rather
//   than taking the live rows down with it.
// - Review files are removed for every task about to go, directly or by
//   cascade. The rows cascade on their own; their stored files did not.
import { supabaseAdmin } from "./supabaseAdmin";
import { deleteDocStorage } from "./taskDocumentFiles";

const RETENTION_DAYS = 30;
// Per run, and per .in() list, so no request carries an overlong URL.
const BATCH = 200;

type Trashable = "task_documents" | "clients" | "projects" | "tasks";

export type PurgeResult = { documents: number; clients: number; projects: number; tasks: number; kept: number; errors: string[] };

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

async function expiredIds(table: Trashable, cutoff: string, errors: string[]): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from(table).select("id").lt("deleted_at", cutoff).limit(BATCH);
  if (error) errors.push(`${table}: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

/** Parent ids that still have a child row outside the Trash. On a failed check
 *  every parent is treated as occupied: keeping a row a day longer is safe,
 *  deleting a live one is not. */
async function withLiveChildren(table: "tasks" | "projects", column: "client_id" | "project_id", parentIds: string[], errors: string[]): Promise<Set<string>> {
  const occupied = new Set<string>();
  for (const ids of chunks(parentIds)) {
    const { data, error } = await supabaseAdmin.from(table).select(column).in(column, ids).is("deleted_at", null);
    if (error) { errors.push(`${table} live check: ${error.message}`); ids.forEach((id) => occupied.add(id)); continue; }
    for (const r of (data ?? []) as Record<string, unknown>[]) occupied.add(r[column] as string);
  }
  return occupied;
}

/** Ids of every task whose column is one of ids. */
async function taskIdsWhere(column: "client_id" | "project_id", ids: string[], errors: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const group of chunks(ids)) {
    const { data, error } = await supabaseAdmin.from("tasks").select("id").in(column, group);
    if (error) { errors.push(`task lookup: ${error.message}`); continue; }
    out.push(...(data ?? []).map((t) => t.id as string));
  }
  return out;
}

/** Stored files of every review document on these tasks. */
async function deleteReviewFilesOfTasks(taskIds: string[], errors: string[]): Promise<void> {
  for (const group of chunks(taskIds)) {
    const { data: docs, error } = await supabaseAdmin.from("task_documents").select("id").in("task_id", group);
    if (error) { errors.push(`document lookup: ${error.message}`); continue; }
    for (const d of docs ?? []) await deleteDocStorage(d.id as string);
  }
}

async function remove(table: Trashable, ids: string[], errors: string[]): Promise<number> {
  let removed = 0;
  for (const group of chunks(ids)) {
    const { data, error } = await supabaseAdmin.from(table).delete().in("id", group).select("id");
    if (error) errors.push(`${table} delete: ${error.message}`);
    removed += data?.length ?? 0;
  }
  return removed;
}

export async function purgeExpiredTrash(): Promise<PurgeResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const errors: string[] = [];

  // Client documents deleted from a task (supabase/task-document-trash.sql). Their
  // stored files go first, then the row, whose cascade takes versions, saved
  // drafts, file rows, comments and the link.
  const docIds = await expiredIds("task_documents", cutoff, errors);
  for (const id of docIds) await deleteDocStorage(id);
  const documents = await remove("task_documents", docIds, errors);

  const expiredClients = await expiredIds("clients", cutoff, errors);
  const liveInClient = new Set([
    ...(await withLiveChildren("tasks", "client_id", expiredClients, errors)),
    ...(await withLiveChildren("projects", "client_id", expiredClients, errors)),
  ]);
  const clientIds = expiredClients.filter((id) => !liveInClient.has(id));

  const expiredProjects = await expiredIds("projects", cutoff, errors);
  const liveInProject = await withLiveChildren("tasks", "project_id", expiredProjects, errors);
  const projectIds = expiredProjects.filter((id) => !liveInProject.has(id));

  const taskIds = await expiredIds("tasks", cutoff, errors);

  // Every task about to go, directly or by cascade, counted once: one task can
  // sit in an expired client and an expired project and be expired itself.
  const doomedTasks = new Set([
    ...(await taskIdsWhere("client_id", clientIds, errors)),
    ...(await taskIdsWhere("project_id", projectIds, errors)),
    ...taskIds,
  ]);
  await deleteReviewFilesOfTasks([...doomedTasks], errors);

  const clients = await remove("clients", clientIds, errors);
  const projects = await remove("projects", projectIds, errors);
  const tasks = await remove("tasks", taskIds, errors);
  return { documents, clients, projects, tasks, kept: liveInClient.size + liveInProject.size, errors };
}

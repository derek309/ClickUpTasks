// SERVER-ONLY: may this caller act on this task? Routes that use the service
// role skip row level security, so they apply its rule by hand
// (supabase/private-tasks.sql): a private task belongs to its assignee only;
// any other task needs its client visible to the caller (admin, a task of
// theirs there, or following the client). Trashed tasks are refused too, so
// nothing gets filed where nobody will look.
import { type AuthedUser } from "./serverAuth";
import { isClientVisible } from "./extensionApi";

/** Select at least these columns for the task you pass in. */
export type TaskAccessRow = { client_id: string; assignee_id: string | null; is_private: boolean | null; deleted_at: string | null };

export async function canActOnTask(caller: AuthedUser, task: TaskAccessRow): Promise<boolean> {
  if (task.deleted_at) return false;
  if (task.is_private) return !!caller.memberId && task.assignee_id === caller.memberId;
  return isClientVisible(caller, task.client_id);
}

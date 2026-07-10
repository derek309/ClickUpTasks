-- ClickUpTasks — Realtime sync + comment-append fix.
-- Run once in the Supabase SQL editor, after rls.sql.
--
-- 1. Adds `tasks`, `clients`, `notifications` to the supabase_realtime
--    publication (postgres_changes respects existing RLS per-subscriber —
--    no policy changes needed; tasks_select/clients_select/notifications_select
--    already scope this correctly).
-- 2. Adds tasks.updated_by for server-confirmed echo suppression (tasks only
--    — the keystroke-driven title/description writes need an exact signal,
--    not a client-side timing heuristic; other tables don't have this
--    collision surface so they don't get the column).
-- 3. append_comment(): atomic JSONB array-append RPC, replacing the full-row
--    upsertTask() addComment() previously used for comments, which could
--    drop a concurrent teammate's comment when two people comment on the
--    same task in the same race window.

-- --- 1. publication -----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients') then
    alter publication supabase_realtime add table public.clients;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- --- 2. echo-suppression column (tasks only) -----------------------------
alter table tasks add column if not exists updated_by text;

-- --- 3. atomic comment append ---------------------------------------------
-- security invoker (the default — stated explicitly): runs as the calling
-- user, so this UPDATE is still gated by the existing tasks_update policy
-- (is_admin() or assignee_id = my_member_id()). A VA can only comment on
-- tasks assigned to them anyway (tasks_select), and the row's assignee_id
-- is untouched here, so the policy's `with check` trivially passes.
create or replace function public.append_comment(task_id text, comment jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  update tasks
  set comments = coalesce(comments, '[]'::jsonb) || jsonb_build_array(comment),
      updated_by = coalesce(comment->>'authorId', updated_by)
  where id = task_id;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default; tighten to
-- match this schema's "to authenticated" convention. RLS still fully
-- protects the row either way — this is defense-in-depth, not the real gate.
revoke execute on function public.append_comment(text, jsonb) from public;
grant execute on function public.append_comment(text, jsonb) to authenticated;

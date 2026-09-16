-- ClickUpTasks — September 2026 review, the parts that live in the database.
-- Run once, in the Supabase SQL editor, top to bottom. Read every result back.
--
-- Three things:
--   1. File storage: who can read which file in the task-files bucket.
--   2. Scheduled sends: count the tries, so a failed one can be retried.
--   3. Signed-out callers can no longer run the app's own helper functions.
--
-- One thing is NOT here because it is a dashboard switch, not SQL:
--   Authentication → Policies → turn ON "Leaked password protection". It checks
--   a new password against known breached ones. One click, no downtime.


-- ===========================================================================
-- 1. File storage: one rule per kind of path
-- ===========================================================================
-- Until now the three task-files policies said only "bucket_id = task-files",
-- which means any signed-in account could read, list and delete every file in
-- it: every client's attachments, every portal upload, every review asset,
-- every direct message attachment, whether or not that account had anything to
-- do with the client.
--
-- The bucket holds six shapes of path, and only the first three are ever
-- written from a browser (the rest go through service-role API routes, which
-- bypass these rules entirely and are unaffected):
--
--   <taskId>/<file>                      a task's own attachments
--   messages/<clientId>/<file>           client chat attachments
--   dm/dm_<memberA>__<memberB>/<file>    direct message attachments
--   waiting/<clientId>/<taskId>/<file>   what a client uploaded in their portal
--   doc/<documentId>/<file>              review and client document files
--   extension/<clientId>/<file>          screenshots clipped from Gmail
--
-- The rule below reads the path and asks the ordinary question: can this
-- account see the task, the client or the conversation the file belongs to?
-- It asks by selecting from those tables WITHOUT security definer, so row
-- level security answers — which means file access follows task access for
-- free, today and after any future change to who can see what.

create or replace function public.can_touch_task_file(path text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case split_part(path, '/', 1)
    when 'messages'  then exists (select 1 from clients c where c.id = split_part(path, '/', 2))
    when 'waiting'   then exists (select 1 from clients c where c.id = split_part(path, '/', 2))
    when 'extension' then exists (select 1 from clients c where c.id = split_part(path, '/', 2))
    when 'doc'       then exists (select 1 from task_documents d where d.id = split_part(path, '/', 2))
    -- A conversation id is "dm_" and the two member ids, sorted and joined by
    -- "__". Being in the conversation is being one of the two, matched whole:
    -- a LIKE on the id would also match a member id that merely contains it.
    when 'dm'        then public.my_member_id() in (
                            split_part(substr(split_part(path, '/', 2), 4), '__', 1),
                            split_part(substr(split_part(path, '/', 2), 4), '__', 2))
    -- Anything else is a task attachment, keyed by the task's own id.
    else exists (select 1 from tasks t where t.id = split_part(path, '/', 1))
  end;
$$;

-- Replaced in one step rather than added alongside: Postgres ORs permissive
-- policies together, so while the old wide ones are still there the new ones
-- change nothing and a test proves nothing. If anything does go wrong, the
-- rollback at the bottom of this section puts the old ones back as they were.
drop policy if exists "task-files read" on storage.objects;
drop policy if exists "task-files insert" on storage.objects;
drop policy if exists "task-files delete" on storage.objects;

create policy "task-files read" on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and public.can_touch_task_file(name));

create policy "task-files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and public.can_touch_task_file(name));

create policy "task-files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'task-files' and public.can_touch_task_file(name));

-- Read back: three policies, each naming can_touch_task_file.
select policyname, cmd, coalesce(qual, with_check) as rule
from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'task-files%' order by policyname;

-- NOW TEST, before doing anything else, signed in as Michaella (not as an
-- admin — an admin can see everything either way, so an admin test proves
-- nothing):
--   a) open a task she is assigned to that has an attachment, and open the file
--   b) open a client chat with an image in it
--   c) open a direct message with an attachment
--   d) open a client document or review that has a file
--   e) drag a new file onto one of her tasks
-- All five must work. If any of them does not, paste this and tell Claude what
-- broke — it puts back exactly what was there before:
--
--   drop policy if exists "task-files read" on storage.objects;
--   drop policy if exists "task-files insert" on storage.objects;
--   drop policy if exists "task-files delete" on storage.objects;
--   create policy "task-files read" on storage.objects for select
--     using (bucket_id = 'task-files');
--   create policy "task-files insert" on storage.objects for insert
--     with check (bucket_id = 'task-files');
--   create policy "task-files delete" on storage.objects for delete
--     using (bucket_id = 'task-files');


-- ===========================================================================
-- 2. Scheduled sends: count the tries
-- ===========================================================================
-- A scheduled message is claimed (pending → sending) before it is sent, so one
-- cut off half way through stays at "sending" and is never picked up again.
-- There is already an `error` column; this adds the count, so the cron can tell
-- a first failure from a fourth and stop after three.

alter table scheduled_messages add column if not exists attempts int not null default 0;

-- Read back: the column is there and every existing row starts at zero.
select count(*) as rows, coalesce(max(attempts), 0) as highest_attempts from scheduled_messages;


-- ===========================================================================
-- 3. Signed-out callers cannot run the app's helper functions
-- ===========================================================================
-- Supabase's own linter flags these as callable over the public REST endpoint
-- by the anon role, which is anyone at all with the public key. They are the
-- app's internal helpers and nothing signed out has any business calling them.
--
-- Only `anon` is revoked here, deliberately. Four of these are called inside
-- the row level security policies on tasks, clients and the rest, and those
-- policies are evaluated as the signed-in user — take EXECUTE away from
-- `authenticated` and every query in the app fails with "permission denied for
-- function is_admin". All of those policies are `to authenticated`, so the
-- anon role never evaluates them and losing EXECUTE costs it nothing.

revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.my_member_id() from anon;
revoke execute on function public.is_following_client(text) from anon;
revoke execute on function public.is_assigned_to_territory(text) from anon;

-- Read back: no row should come out of this. Each row that does is a function
-- the anon role can still run.
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('handle_new_user', 'is_admin', 'my_member_id', 'is_following_client', 'is_assigned_to_territory')
  and has_function_privilege('anon', p.oid, 'execute');

-- merge_clients was on the linter's list too and needs nothing: it already
-- refuses anyone who is not an admin, in its own first line.

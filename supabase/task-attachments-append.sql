-- append_task_attachments(): adds files to a task's attachments in one
-- statement, skipping any whose emailSource (or path) is already there
-- (2026-10-10). The email-files copy (src/lib/emailFilesServer.ts) read the
-- list, downloaded, then wrote the whole list back, so a file someone added
-- in between could be dropped. Same idea as append_comment.
--
-- Safe to run before or after the deploy: the code falls back to the old
-- read-then-write while this function is missing. Safe to run more than once.
-- Run in the Supabase SQL editor (project fiuikmynexwdewnazuab).
create or replace function public.append_task_attachments(task_id text, items jsonb)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  with cur as (
    select coalesce(attachments, '[]'::jsonb) as list from tasks where id = task_id
  ), fresh as (
    select coalesce(jsonb_agg(i), '[]'::jsonb) as add
    from jsonb_array_elements(items) i, cur
    where not exists (
      select 1 from jsonb_array_elements(cur.list) a
      where (i->>'emailSource' is not null and a->>'emailSource' = i->>'emailSource')
         or (i->>'path' is not null and a->>'path' = i->>'path')
    )
  ), done as (
    update tasks set attachments = cur.list || fresh.add, updated_by = null
    from cur, fresh
    where id = task_id and jsonb_array_length(fresh.add) > 0
    returning fresh.add
  )
  select coalesce((select add from done), '[]'::jsonb);
$$;

-- Read back: should return one row named append_task_attachments.
select proname from pg_proc where proname = 'append_task_attachments';

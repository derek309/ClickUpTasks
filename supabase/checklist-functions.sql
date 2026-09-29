-- ClickUpTasks: one checklist item at a time (audit 2026-09-29, wave 3.2).
--
-- The app wrote a task's whole checklist on every tick, so two people working
-- one checklist at once overwrote each other: the owner editing a handoff's
-- brief while the teammate ticks a step, and one of the two changes is gone.
-- These change one item (or add some) inside a locked row, the way
-- append_comment adds a comment.
--
-- Each recomputes delegated_to (the teammates a checklist item is assigned to,
-- other than the task's owner), which the row rules use to let a delegatee see
-- the task, exactly as the app computes it when it writes a whole row.
--
-- Security invoker, like append_comment: the caller's own row rules apply, so
-- nobody can change a checklist on a task they could not otherwise edit.
--
-- ⚠ Run this BEFORE the deploy that calls them. The build running now does
-- not use them, so running it first changes nothing. Safe to run more than
-- once. Run it in the Supabase SQL editor (project fiuikmynexwdewnazuab), then
-- the read backs.

create or replace function public.task_delegated_to(subs jsonb, owner text)
returns jsonb
language sql immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(distinct s->>'assigneeId'), '[]'::jsonb)
  from jsonb_array_elements(coalesce(subs, '[]'::jsonb)) s
  where coalesce(s->>'assigneeId', '') <> '' and (s->>'assigneeId') is distinct from owner;
$$;

-- Merges `patch` into the item with this id. A key the patch sets to null is
-- removed from the item (the app's way of clearing an assignee or a due date);
-- nulls anywhere else are left as they are.
create or replace function public.patch_subtask(task_id text, subtask_id text, patch jsonb, author text default null)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  subs jsonb;
  owner text;
begin
  select t.subtasks, t.assignee_id into subs, owner from tasks t where t.id = patch_subtask.task_id for update;
  if not found then return; end if;
  select coalesce(jsonb_agg(case when e.s->>'id' = patch_subtask.subtask_id then (e.s || patch_subtask.patch) - cleared.keys else e.s end order by e.ord), '[]'::jsonb)
    into subs
    from jsonb_array_elements(coalesce(subs, '[]'::jsonb)) with ordinality as e(s, ord),
         (select coalesce(array_agg(key), '{}'::text[]) as keys from jsonb_each(patch_subtask.patch) where value = 'null'::jsonb) as cleared;
  update tasks t set subtasks = subs, delegated_to = task_delegated_to(subs, owner), updated_by = author
   where t.id = patch_subtask.task_id;
end;
$$;

-- Adds items to the end of the checklist, in the order given.
create or replace function public.append_subtasks(task_id text, items jsonb, author text default null)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  subs jsonb;
  owner text;
begin
  select t.subtasks, t.assignee_id into subs, owner from tasks t where t.id = append_subtasks.task_id for update;
  if not found then return; end if;
  subs := coalesce(subs, '[]'::jsonb) || append_subtasks.items;
  update tasks t set subtasks = subs, delegated_to = task_delegated_to(subs, owner), updated_by = author
   where t.id = append_subtasks.task_id;
end;
$$;

-- Removes the item with this id.
create or replace function public.remove_subtask(task_id text, subtask_id text, author text default null)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  subs jsonb;
  owner text;
begin
  select t.subtasks, t.assignee_id into subs, owner from tasks t where t.id = remove_subtask.task_id for update;
  if not found then return; end if;
  select coalesce(jsonb_agg(e.s order by e.ord), '[]'::jsonb) into subs
    from jsonb_array_elements(coalesce(subs, '[]'::jsonb)) with ordinality as e(s, ord)
   where e.s->>'id' is distinct from remove_subtask.subtask_id;
  update tasks t set subtasks = subs, delegated_to = task_delegated_to(subs, owner), updated_by = author
   where t.id = remove_subtask.task_id;
end;
$$;

revoke execute on function public.patch_subtask(text, text, jsonb, text) from public, anon;
revoke execute on function public.append_subtasks(text, jsonb, text) from public, anon;
revoke execute on function public.remove_subtask(text, text, text) from public, anon;
grant execute on function public.patch_subtask(text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.append_subtasks(text, jsonb, text) to authenticated, service_role;
grant execute on function public.remove_subtask(text, text, text) to authenticated, service_role;

-- Read back 1: three rows, all security invoker (prosecdef false).
select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('patch_subtask', 'append_subtasks', 'remove_subtask')
order by proname;

-- Read back 2: the helper gives what the app gives. Expect ["u_b"].
select task_delegated_to('[{"id":"s1","assigneeId":"u_a"},{"id":"s2","assigneeId":"u_b"},{"id":"s3"}]'::jsonb, 'u_a');

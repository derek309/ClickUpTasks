-- ClickUpTasks — let a delegatee see (and tick off) the task they were handed.
--
-- Delegation looked broken from Michaella's side: nothing showed up on her All
-- Tasks. The row was right in every way — status "delegated", her checklist
-- item assigned with its own due date, delegated_to carrying her member id —
-- and Postgres filtered it out before the app ever saw it, because the live
-- SELECT policy on this database only ever admitted admins and the assignee:
--
--   is_admin() OR assignee_id = my_member_id()
--
-- supabase/task-delegation.sql has the delegated_to clause, but it was never
-- run here, and the rest of that file assumes policies this database does not
-- have (is_private handling, is_following_client). So this applies the
-- delegatee clause on its own and loosens nothing else.
--
-- UPDATE is widened for the same reason SELECT is: a checklist item lives in
-- the task row's subtasks jsonb, so ticking your own item done is an update to
-- the task. Small trusted team; a delegatee gets full edit on a task they are
-- holding a piece of, which is the same trade task-delegation.sql already made.
--
-- Run once in the Supabase SQL editor.

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated using (
  (select is_admin())
  or assignee_id = (select my_member_id())
  or delegated_to @> jsonb_build_array((select my_member_id()))
);

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated using (
  (select is_admin())
  or assignee_id = (select my_member_id())
  or delegated_to @> jsonb_build_array((select my_member_id()))
) with check (
  (select is_admin())
  or assignee_id = (select my_member_id())
  or delegated_to @> jsonb_build_array((select my_member_id()))
);

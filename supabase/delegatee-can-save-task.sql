-- ClickUpTasks — let a delegatee's edits to a task they were handed actually save.
--
-- delegatee-can-see-task.sql widened tasks_select and tasks_update with the
-- delegated_to clause, but not tasks_insert. That looked safe, since a
-- delegatee never creates the task. It is not: the app writes every task with
-- upsert (INSERT ... ON CONFLICT DO UPDATE), and Postgres checks the INSERT
-- policy's WITH CHECK against the proposed row even when it conflicts and
-- becomes an update. So every save a VA made on a task someone else owns was
-- refused with "new row violates row-level security policy for table tasks"
-- (13 of them on 2026-09-10 alone), including ticking her own handoff done.
-- The app showed "1 change did not save" and the database kept the old row.
--
-- This adds the same clause to INSERT and loosens nothing else. Side effect: a
-- VA could create a new task owned by someone else if they list themselves as
-- a delegatee on it, which is within the team rule that a VA can do
-- everything except email and text a client.
--
-- Applied to production 2026-09-10.

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (
  (select is_admin())
  or assignee_id = (select my_member_id())
  or delegated_to @> jsonb_build_array((select my_member_id()))
);

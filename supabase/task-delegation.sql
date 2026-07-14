-- ClickUpTasks — task delegation via assigned checklist items.
-- Assigning a checklist item (subtask) to a teammate delegates that step of
-- the task. The whole parent task should then surface on that teammate's
-- list, and they need to be able to mark their item done — even if they
-- don't own the task or follow the client. delegated_to is derived by the
-- app (taskToRow) from the checklist assignees on every task write.
-- Run once, after private-tasks.sql.

alter table tasks add column if not exists delegated_to jsonb not null default '[]';

-- SELECT: owner, admin, client-follower, private-owner (unchanged) PLUS a
-- delegatee. Delegation only applies to non-private tasks (private/personal
-- tasks are your own and never delegated).
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated using (
  (is_private and assignee_id = my_member_id())
  or (not is_private and (
    is_admin()
    or assignee_id = my_member_id()
    or is_following_client(tasks.client_id)
    or delegated_to @> jsonb_build_array(my_member_id())
  ))
);

-- UPDATE: a delegatee can edit the task too, so they can tick their checklist
-- item done (that's a task row update, since checklist items live in the
-- subtasks jsonb). Small trusted team — full edit is an acceptable trade-off.
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using ((is_private and assignee_id = my_member_id()) or (not is_private and (is_admin() or assignee_id = my_member_id() or delegated_to @> jsonb_build_array(my_member_id()))))
  with check ((is_private and assignee_id = my_member_id()) or (not is_private and (is_admin() or assignee_id = my_member_id() or delegated_to @> jsonb_build_array(my_member_id()))));

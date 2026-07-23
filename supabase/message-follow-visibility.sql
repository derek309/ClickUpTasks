-- ClickUpTasks — a user should always see (and be able to reply to) a
-- conversation they personally sent messages in, even after the task gets
-- reassigned or they're not in the client's assigned_to/follower list.
-- Run once, after messages.sql and client-assignment.sql.
--
-- client-assignment.sql already widened messages_select with
-- is_following_client(), but that only helps once an admin explicitly adds
-- someone to a client's assigned_to array — it doesn't cover the reported
-- bug (t_mrtmcxxhb): Justin's own sent messages disappearing from his view
-- once the underlying task moved off him. The fix is authorship, not
-- following: if you wrote a message in this conversation, you can always
-- see and keep replying to it, independent of current task/follow state.

drop policy if exists messages_select on messages;
create policy messages_select on messages for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = my_member_id())
  or is_following_client(messages.client_id)
  or created_by = my_member_id()
);

drop policy if exists messages_insert on messages;
create policy messages_insert on messages for insert to authenticated with check (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = my_member_id())
  or is_following_client(messages.client_id)
  or exists (select 1 from messages m2 where m2.client_id = messages.client_id and m2.created_by = my_member_id())
);

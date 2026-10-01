-- ClickUpTasks: Inbox audit fixes (2026-10-01). Run once. Safe to re-run.

-- 1. A GoHighLevel conversation assigned to nobody shows for the whole TEAM,
--    not for any signed-in account: an account with no roster id (anyone who
--    signed up on their own) sees none of it.
drop policy if exists ghl_conversations_select on ghl_conversations;
create policy ghl_conversations_select on ghl_conversations for select to authenticated using (
  (select is_admin())
  or ((select my_member_id()) is not null
      and (assigned_member_id is null or assigned_member_id = (select my_member_id())))
);

drop policy if exists messages_select on messages;
create policy messages_select on messages for select to authenticated using (
  (select is_admin())
  or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = (select my_member_id()))
  or is_following_client(client_id)
  or mailbox_member_id = (select my_member_id())
  or ((select my_member_id()) is not null
      and exists (select 1 from ghl_conversations g where g.id = messages.ghl_conversation_id
                  and (g.assigned_member_id is null or g.assigned_member_id = (select my_member_id()))))
);

-- 2. Assign in the Inbox: what GoHighLevel said at that moment, so the
--    15 minute pull keeps our choice until GoHighLevel shows something new.
alter table ghl_conversations add column if not exists local_assign_from text;
alter table ghl_conversations add column if not exists assigned_at timestamptz;

-- Read back: one row per check, each should say true.
select 'conversations rule needs a roster id' as check, exists (select 1 from pg_policies where tablename = 'ghl_conversations' and policyname = 'ghl_conversations_select' and qual like '%IS NOT NULL%') as ok
union all select 'messages rule needs a roster id', exists (select 1 from pg_policies where tablename = 'messages' and policyname = 'messages_select' and qual like '%my_member_id() AS my_member_id) IS NOT NULL%')
union all select 'messages rule keeps following', exists (select 1 from pg_policies where tablename = 'messages' and policyname = 'messages_select' and qual like '%is_following_client%')
union all select 'local_assign_from column', exists (select 1 from information_schema.columns where table_name = 'ghl_conversations' and column_name = 'local_assign_from')
union all select 'assigned_at column', exists (select 1 from information_schema.columns where table_name = 'ghl_conversations' and column_name = 'assigned_at');

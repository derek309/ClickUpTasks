-- ClickUpTasks — Conversations inbox: read/unread tracking on messages.
-- Run once, after messages.sql.
--
-- Read state is shared team-wide (one flag per message, not per-user) — same
-- trust model as messages_insert: any signed-in teammate with access to that
-- client's conversation can mark it read, matching how a shared team inbox
-- (not a personal one) behaves. Outbound rows are inserted already-read (you
-- obviously "read" your own sent message); inbound rows land unread until
-- someone opens that conversation.

alter table messages add column if not exists read boolean not null default true;

drop policy if exists messages_update on messages;
create policy messages_update on messages for update to authenticated
  using (is_admin() or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = my_member_id()))
  with check (is_admin() or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = my_member_id()));

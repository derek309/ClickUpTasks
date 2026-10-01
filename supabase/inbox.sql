-- ClickUpTasks: the Inbox (2026-10-01).
-- One place for every email, text and task chat. Each person sees their own
-- Gmail plus GoHighLevel conversations assigned to them or unassigned, and
-- keeps their own read / snooze / done state per conversation.
-- Run once. Safe to re-run.

-- 1. Whose Gmail a message came into (null for GoHighLevel and portal chat).
alter table messages add column if not exists mailbox_member_id text;
create index if not exists messages_mailbox_idx on messages (mailbox_member_id, created_at desc)
  where mailbox_member_id is not null;

-- 2. A stranger's email is a real message before anyone makes them a contact.
alter table messages alter column contact_id drop not null;
alter table messages alter column client_id drop not null;

-- 3. GoHighLevel conversations, with who they are assigned to on our roster.
create table if not exists ghl_conversations (
  id text primary key,                 -- GoHighLevel conversation id
  location_id text not null,
  ghl_contact_id text,
  assigned_member_id text,             -- our roster id; null = unassigned
  contact_name text,
  phone text,
  email text,
  last_message_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ghl_conversations_assigned_idx on ghl_conversations (assigned_member_id);
alter table ghl_conversations enable row level security;
drop policy if exists ghl_conversations_select on ghl_conversations;
create policy ghl_conversations_select on ghl_conversations for select to authenticated using (
  (select is_admin()) or assigned_member_id is null or assigned_member_id = (select my_member_id())
);
-- Writes come only from the server (service role), so no insert/update policy.

-- 4. Each person's own state for a conversation.
--    thread_key: 'gm:<gmail thread id>', 'ghl:<conversation id>', 'chat:<task id>'
create table if not exists inbox_state (
  member_id text not null,
  thread_key text not null,
  read_at timestamptz,
  snoozed_until timestamptz,
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (member_id, thread_key)
);
alter table inbox_state enable row level security;
drop policy if exists inbox_state_own on inbox_state;
create policy inbox_state_own on inbox_state for all to authenticated
  using (member_id = (select my_member_id()))
  with check (member_id = (select my_member_id()));

-- 5. Messages: the live rules, plus "it came into my mailbox" and
--    "it is a GoHighLevel conversation assigned to me or unassigned".
drop policy if exists messages_select on messages;
create policy messages_select on messages for select to authenticated using (
  (select is_admin())
  or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = (select my_member_id()))
  or is_following_client(client_id)
  or mailbox_member_id = (select my_member_id())
  or exists (select 1 from ghl_conversations g where g.id = messages.ghl_conversation_id
             and (g.assigned_member_id is null or g.assigned_member_id = (select my_member_id())))
);

drop policy if exists messages_update on messages;
create policy messages_update on messages for update to authenticated
  using (
    (select is_admin())
    or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = (select my_member_id()))
    or mailbox_member_id = (select my_member_id())
  )
  with check (
    (select is_admin())
    or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = (select my_member_id()))
    or mailbox_member_id = (select my_member_id())
  );

-- Read back: one row per check, each should say true.
select 'mailbox column' as check, exists (select 1 from information_schema.columns where table_name = 'messages' and column_name = 'mailbox_member_id') as ok
union all select 'contact_id nullable', (select is_nullable = 'YES' from information_schema.columns where table_name = 'messages' and column_name = 'contact_id')
union all select 'client_id nullable', (select is_nullable = 'YES' from information_schema.columns where table_name = 'messages' and column_name = 'client_id')
union all select 'ghl_conversations', exists (select 1 from information_schema.tables where table_name = 'ghl_conversations')
union all select 'inbox_state', exists (select 1 from information_schema.tables where table_name = 'inbox_state')
union all select 'select policy has mailbox', exists (select 1 from pg_policies where tablename = 'messages' and policyname = 'messages_select' and qual like '%mailbox_member_id%');

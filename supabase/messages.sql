-- ClickUpTasks — Contact messages (email now, SMS later via the same shape).
-- Run once in the Supabase SQL editor, after rls.sql and realtime.sql (needs
-- is_admin()/my_member_id(), and adds this table to supabase_realtime).
--
-- A message belongs to a Contact, not a Task — a contact can have many tasks,
-- and the conversation is with the person, not any one piece of work. Sent
-- via GoHighLevel's Conversations API (so it goes out from the sub-account's
-- own connected email/number, not a separate provider); replies land here via
-- the same inbound webhook already used for GHL task sync
-- (src/app/api/ghl/webhook/route.ts), extended to also branch on a
-- message-shaped payload.

create table if not exists messages (
  id text primary key,
  contact_id text not null references contacts(id) on delete cascade,
  client_id text not null references clients(id) on delete cascade,
  channel text not null default 'email',   -- email | sms (sms lands in a later pass)
  direction text not null,                 -- outbound | inbound
  subject text,                            -- email only; null for sms
  body text not null default '',
  ghl_message_id text,                     -- GHL's id for this message, for idempotent inbound writes
  created_by text,                         -- roster id for outbound; null for inbound
  created_at timestamptz default now()
);
create index if not exists messages_contact_id_created_at_idx on messages(contact_id, created_at);
create unique index if not exists messages_ghl_message_id_idx on messages(ghl_message_id) where ghl_message_id is not null;

-- --- RLS: same shape as client_notes (team-wide read scoped to clients you
-- have an assigned task on; write is unrestricted beyond that, matching the
-- product decision that any signed-in user can send a message directly, the
-- same trust level as the existing Push to GHL button) ----------------------
alter table messages enable row level security;

drop policy if exists messages_select on messages;
create policy messages_select on messages for select to authenticated using (
  is_admin() or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = my_member_id())
);

drop policy if exists messages_insert on messages;
create policy messages_insert on messages for insert to authenticated with check (
  is_admin() or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = my_member_id())
);

-- Inbound webhook writes use the service-role key (supabaseAdmin), which
-- bypasses RLS entirely, same as the existing task webhook — no separate
-- policy needed for that path.

-- --- realtime: so a reply that lands via webhook appears in an open thread
-- without a refresh, the same reasoning as tasks/clients/notifications in
-- realtime.sql -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

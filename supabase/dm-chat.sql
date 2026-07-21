-- ClickUpTasks — Direct Messages: private 1:1 chat between two teammates,
-- merged into the sidebar's Chat hub alongside Team Chat. Deliberately not a
-- dm_conversations/dm_participants join table — v1 is 1:1 only, and
-- conversation_id (a sorted pair of the two member ids, see dmConversationId
-- in data.ts) plus explicit author_id/recipient_id columns cover every query
-- this table needs without one. Run once, after rls.sql (needs
-- is_admin()/my_member_id()).

create table if not exists dm_messages (
  id text primary key,
  conversation_id text not null,
  author_id text not null,
  recipient_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_conversation_id_created_at_idx on dm_messages(conversation_id, created_at);

alter table dm_messages enable row level security;

-- Select: only the two participants, or an admin — the one genuinely new
-- predicate this feature needs; team_messages_select ("using (true)") is the
-- wrong shape here since a DM is private, not everyone-sees-everything.
drop policy if exists dm_messages_select on dm_messages;
create policy dm_messages_select on dm_messages for select to authenticated using (
  is_admin() or my_member_id() = author_id or my_member_id() = recipient_id
);

-- Insert: only as yourself, and only to someone else (blocks a degenerate
-- self-DM row at the DB layer; the UI never offers one either).
drop policy if exists dm_messages_insert on dm_messages;
create policy dm_messages_insert on dm_messages for insert to authenticated with check (
  author_id = my_member_id() and recipient_id <> my_member_id()
);

-- Delete: your own message, or an admin moderating — identical to
-- team_messages_delete.
drop policy if exists dm_messages_delete on dm_messages;
create policy dm_messages_delete on dm_messages for delete to authenticated using (
  is_admin() or author_id = my_member_id()
);

-- Realtime — a DM feature is pointless without it showing up live.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dm_messages') then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end $$;

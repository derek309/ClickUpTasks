-- ClickUpTasks — Team Chat: one shared, workspace-wide feed for internal
-- team talk (e.g. "who's covering X today"), deliberately separate from any
-- client's Journal. Run once, after rls.sql (needs is_admin()/my_member_id()).

create table if not exists team_messages (
  id text primary key,
  author_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists team_messages_created_at_idx on team_messages(created_at);

alter table team_messages enable row level security;

-- Select: everyone signed in — there's no client/project scoping to gate on,
-- and the whole point is "the whole team sees this."
drop policy if exists team_messages_select on team_messages;
create policy team_messages_select on team_messages for select to authenticated using (true);

-- Insert: only as yourself (or an admin posting as themselves too) — same
-- author-scoped-write shape as client_notes_insert.
drop policy if exists team_messages_insert on team_messages;
create policy team_messages_insert on team_messages for insert to authenticated with check (
  is_admin() or author_id = my_member_id()
);

-- Delete: your own message, or an admin moderating.
drop policy if exists team_messages_delete on team_messages;
create policy team_messages_delete on team_messages for delete to authenticated using (
  is_admin() or author_id = my_member_id()
);

-- Realtime — a chat feature is pointless without it showing up live.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='team_messages') then
    alter publication supabase_realtime add table public.team_messages;
  end if;
end $$;

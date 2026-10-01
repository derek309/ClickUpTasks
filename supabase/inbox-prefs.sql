-- ClickUpTasks: Inbox settings that follow you to every device (Derek,
-- 2026-10-01). One row per person, their own only. Run once.
create table if not exists inbox_prefs (
  member_id text primary key,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table inbox_prefs enable row level security;
drop policy if exists inbox_prefs_own on inbox_prefs;
create policy inbox_prefs_own on inbox_prefs for all to authenticated
  using (member_id = (select my_member_id()))
  with check (member_id = (select my_member_id()));

select 'inbox_prefs' as check, exists (select 1 from information_schema.tables where table_name = 'inbox_prefs') as ok;

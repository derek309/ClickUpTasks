-- ClickUpTasks: Block sender in the Inbox (Derek, 2026-10-01). Each person's
-- own list: an email address, a phone number, or a whole domain ("@kp.org").
-- Blocked mail from people who are not contacts is not stored at all, and
-- anything else from them stays out of that person's Inbox. Run once.
create table if not exists inbox_blocks (
  member_id text not null,
  address text not null,          -- lower case; "@domain" blocks the domain
  created_at timestamptz not null default now(),
  primary key (member_id, address)
);
alter table inbox_blocks enable row level security;
drop policy if exists inbox_blocks_own on inbox_blocks;
create policy inbox_blocks_own on inbox_blocks for all to authenticated
  using (member_id = (select my_member_id()))
  with check (member_id = (select my_member_id()));

select 'inbox_blocks' as check, exists (select 1 from information_schema.tables where table_name = 'inbox_blocks') as ok;

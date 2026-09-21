-- ClickUpTasks: when each person last looked at a feed.
--
-- Derek, 2026-09-20, on the Finished feed: a marker for what has happened
-- since he last looked, so finding out does not depend on remembering to check.
--
-- Why a table and not a column on profiles, which is where
-- team_chat_last_read_at already sits: profiles has a SELECT policy and no
-- UPDATE policy, so nobody can write their own profile row from the browser.
-- That is almost certainly why team_chat_last_read_at was added and never
-- used. Giving profiles a self update policy would be worse than useless: the
-- table holds `role`, Postgres RLS cannot limit an UPDATE to certain columns,
-- and a policy letting people write their own row would let anyone make
-- themselves an admin.
--
-- So this is shaped like dm_reads, whose policies are the ones copied below. It
-- holds nothing but a member id, a feed name and a time, so a self write policy
-- on it gives nothing away.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab). The app
-- works before it is run: with no table the marker and the count simply do not
-- appear, and nothing errors.

create table if not exists feed_reads (
  member_id text not null,
  feed text not null,
  last_seen_at timestamptz not null,
  primary key (member_id, feed)
);

alter table feed_reads enable row level security;

drop policy if exists feed_reads_select on feed_reads;
create policy feed_reads_select on feed_reads for select
  using (member_id = my_member_id());

drop policy if exists feed_reads_upsert on feed_reads;
create policy feed_reads_upsert on feed_reads for insert
  with check (member_id = my_member_id());

drop policy if exists feed_reads_update on feed_reads;
create policy feed_reads_update on feed_reads for update
  using (member_id = my_member_id()) with check (member_id = my_member_id());

-- Read back: the three columns, and three policies scoped to my_member_id().
select column_name, data_type from information_schema.columns
  where table_name = 'feed_reads' order by ordinal_position;
select policyname, cmd from pg_policies where tablename = 'feed_reads' order by cmd;

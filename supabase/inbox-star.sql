-- ClickUpTasks: stars in the Inbox (Derek, 2026-10-01). Starring an email
-- also stars it in Gmail. Run once. Safe to re-run.
alter table inbox_state add column if not exists starred_at timestamptz;

select 'starred_at' as check, exists (select 1 from information_schema.columns where table_name = 'inbox_state' and column_name = 'starred_at') as ok;

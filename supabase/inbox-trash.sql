-- ClickUpTasks: Inbox Trash (Derek, 2026-10-01: "can we add a delete / or
-- move to trash"). Delete moves a conversation to the Inbox's Trash and its
-- email to Gmail's Trash. Run once. Safe to re-run.
alter table inbox_state add column if not exists trashed_at timestamptz;

select 'trashed_at' as check, exists (select 1 from information_schema.columns where table_name = 'inbox_state' and column_name = 'trashed_at') as ok;

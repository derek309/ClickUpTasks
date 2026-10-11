-- Project instructions can be restored for 30 days after a delete, like a
-- task's reviews (Derek, 2026-10-11). Run once in the Supabase SQL editor
-- (project fiuikmynexwdewnazuab) BEFORE the deploy that ships it: the code
-- reads deleted_at. Read back with the last query.

alter table task_briefs add column if not exists deleted_at timestamptz;

-- One LIVE set per task; deleted ones wait beside it to be restored.
drop index if exists task_briefs_one_per_task;
create unique index if not exists task_briefs_one_live_per_task on task_briefs (task_id) where deleted_at is null;

select column_name from information_schema.columns where table_name = 'task_briefs' and column_name = 'deleted_at';

-- ClickUpTasks — client/project follow-up date. Run once, after rls.sql.
alter table clients add column if not exists follow_up_at text;
alter table projects add column if not exists follow_up_at text;

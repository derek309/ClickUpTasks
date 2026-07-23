-- ClickUpTasks — Claude-drafted emails, reviewed and sent from the task.
-- Run once in the Supabase SQL editor. Hard deploy-blocker, same as
-- task-client-response.sql: taskToRow builds an unconditional row literal,
-- so every task write breaks with a "column does not exist" error until
-- this runs.
alter table tasks add column if not exists draft_email jsonb;

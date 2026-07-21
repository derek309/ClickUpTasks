-- ClickUpTasks — client responses from the public /waiting/[token] page.
-- Run once in the Supabase SQL editor. Hard deploy-blocker: taskToRow builds
-- an unconditional row literal, so every task write breaks with a "column
-- does not exist" error until this runs.
alter table tasks add column if not exists client_response jsonb;

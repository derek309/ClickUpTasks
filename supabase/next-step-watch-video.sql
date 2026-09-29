-- ClickUpTasks: a next step may wait on a video approval (2026-09-29).
--
-- The check on task_actions.next_step_watch was written on 2026-09-16, the day
-- before video review existed, so it only allowed approved:doc, approved:image
-- and approved:page. The app suggests "Get <client>'s approval on <video>" with
-- approved:video, and the database refused the whole row, so the logged action
-- and the step were both lost.
--
-- The pattern below must stay equal to STEP_WATCH_PATTERN in src/lib/data.ts;
-- src/lib/stepWatch.test.ts reads this file and fails when they differ.
--
-- Safe to run more than once. Nothing else changes and no deploy is needed.
-- Run it in the Supabase SQL editor (project fiuikmynexwdewnazuab), then run
-- the read back at the bottom.

alter table task_actions drop constraint if exists task_actions_next_step_watch_check;
alter table task_actions add constraint task_actions_next_step_watch_check
  check (next_step_watch is null or next_step_watch ~ '^(approved:(doc|image|page|video)|reply|handoff:[A-Za-z0-9_-]+)$');

-- Read back: one row, and the definition includes video.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname = 'task_actions_next_step_watch_check';

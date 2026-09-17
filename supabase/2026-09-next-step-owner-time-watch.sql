-- ClickUpTasks: next steps that know who they're for, when in the day, and
-- what finishes them (Derek, 2026-09-16, next step card part 2).
--
--   next_step_owner  the member the step is for, when it isn't the task owner
--   next_step_time   a time of day for the step, "17:00"
--   next_step_watch  what ticks the step off by itself:
--                      approved:doc | approved:image | approved:page  the client approves that review
--                      reply                                          the client writes back on any channel
--                      handoff:<checklist item id>                    a delegation is marked done
--
-- All three are optional, so every existing step keeps working unchanged.
-- Run it in the Supabase SQL editor, then run the read back at the bottom.

alter table task_actions add column if not exists next_step_owner text;
alter table task_actions add column if not exists next_step_time text;
alter table task_actions add column if not exists next_step_watch text;

alter table task_actions drop constraint if exists task_actions_next_step_time_check;
alter table task_actions add constraint task_actions_next_step_time_check
  check (next_step_time is null or next_step_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

alter table task_actions drop constraint if exists task_actions_next_step_watch_check;
alter table task_actions add constraint task_actions_next_step_watch_check
  check (next_step_watch is null or next_step_watch ~ '^(approved:(doc|image|page)|reply|handoff:[A-Za-z0-9_-]+)$');

-- Read back: three rows, all text, all nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'task_actions' and column_name in ('next_step_owner', 'next_step_time', 'next_step_watch')
order by column_name;

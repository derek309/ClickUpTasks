-- ClickUpTasks — custom recurrence ("every N days/weeks/months"), for
-- recurring tasks the preset options (daily/weekly/monthly/...) don't fit.
-- Run once in the Supabase SQL editor.
alter table tasks add column if not exists recurrence_interval integer;
alter table tasks add column if not exists recurrence_unit text; -- 'day' | 'week' | 'month'

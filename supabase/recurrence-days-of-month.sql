-- ClickUpTasks — custom recurrence on specific day(s) of the month (e.g. the
-- 1st and the 15th), an alternative to "every N days/weeks/months". Run once.
alter table tasks add column if not exists recurrence_days_of_month integer[];

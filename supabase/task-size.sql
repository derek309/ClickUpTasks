-- Rough size of a task, for filling a day rather than tracking time.
--
-- Five buckets and not a number of hours: nobody types "2.5" honestly on a
-- Tuesday afternoon, and the decision being made is only ever "do three of
-- these fit today". The hours behind each bucket live in the app, so they can
-- be retuned without re-sizing a single task.
alter table tasks add column if not exists size text
  check (size is null or size in ('quick','hour','half','full','multi'));

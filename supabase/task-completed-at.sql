-- ClickUpTasks: when a task was really finished (Derek, 2026-10-13, the
-- client portal's Done tab by month).
--
-- There was no column for it. The portal used updated_at, which moves on any
-- later edit, so a task finished in July and renamed in October showed as
-- done in October.
--
-- completed_at is set by a trigger when status becomes done and cleared when
-- it leaves done, so no app code has to remember it. Existing done tasks are
-- filled in from the best evidence there is:
--   1. the latest "changed status ... to Done" event in the task's comments,
--   2. else the doneAt of its "Task done" step (addedFor "finished"),
--   3. else updated_at.
--
-- The backfill turns the touch_updated_at trigger off while it runs, so the
-- ~2,140 done tasks keep their updated_at (the app loads "finished in the
-- last 30 days" by updated_at; stamping them all would load every one).
-- Every open tab still receives the rewritten rows as live updates, so run it
-- in a quiet moment.
--
-- The portal reads completed_at when it is there and falls back to
-- updated_at when it is not, so the app works before and after this runs.
-- Safe to run more than once. Run it in the Supabase SQL editor (project
-- fiuikmynexwdewnazuab), then run the read back at the bottom.

alter table tasks add column if not exists completed_at timestamptz;

-- Backfill, without stamping updated_at.
alter table tasks disable trigger tasks_touch_updated_at;
update tasks t set completed_at = coalesce(
  (select max((c->>'at')::timestamptz)
     from jsonb_array_elements(case when jsonb_typeof(t.comments) = 'array' then t.comments else '[]'::jsonb end) c
    where c->>'kind' = 'event'
      and c->>'body' ~* 'status (from .+ )?to done$'
      and (c->>'at') ~ '^\d{4}-\d{2}-\d{2}T'),
  (select max((s->>'doneAt')::timestamptz)
     from jsonb_array_elements(case when jsonb_typeof(t.subtasks) = 'array' then t.subtasks else '[]'::jsonb end) s
    where s->>'addedFor' = 'finished'
      and (s->>'doneAt') ~ '^\d{4}-\d{2}-\d{2}T'),
  t.updated_at)
where t.status = 'done' and t.completed_at is null;
alter table tasks enable trigger tasks_touch_updated_at;

-- From now on: stamped when a task becomes done, kept while it stays done,
-- cleared when it is reopened.
create or replace function stamp_task_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.completed_at = coalesce(new.completed_at, now());
    elsif old.status is distinct from 'done' then
      new.completed_at = now();
    else
      new.completed_at = coalesce(new.completed_at, old.completed_at, now());
    end if;
  else
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_stamp_completed_at on tasks;
create trigger tasks_stamp_completed_at before insert or update on tasks
  for each row execute function stamp_task_completed_at();

-- The portal's Done tab: one client's finished tasks, newest first.
create index if not exists tasks_client_completed_at_idx on tasks (client_id, completed_at desc) where status = 'done';

-- Read back: every done task has a date, no open task has one, the trigger is
-- in. Expect done_without_date 0, open_with_date 0, has_trigger true.
select count(*) filter (where status = 'done' and completed_at is null) as done_without_date,
       count(*) filter (where status <> 'done' and completed_at is not null) as open_with_date,
       count(*) filter (where status = 'done') as done_tasks,
       exists (select 1 from pg_trigger g join pg_class r on r.oid = g.tgrelid
                where r.relname = 'tasks' and g.tgname = 'tasks_stamp_completed_at') as has_trigger
from tasks;

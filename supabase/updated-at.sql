-- ClickUpTasks: updated_at on the five tables the app keeps in step live
-- (audit 2026-09-29, wave 3.1).
--
-- What it is for:
--   * The app loads open tasks and the tasks finished in the last 30 days at
--     start, not all of them. Tasks had no column saying when they last
--     changed, so "finished lately" could not be asked of the database.
--   * Coming back to the tab asks only for rows changed since the last look,
--     instead of downloading every table again.
--
-- ⚠ Run this BEFORE the perf/load-less deploy. That build asks for updated_at
-- and does not load without it. The build running now ignores the column, so
-- running this first changes nothing anyone can see.
--
-- Best run in a quiet moment: filling in the tasks column rewrites all 1,980
-- task rows once, and every open tab receives that as live updates.
--
-- Safe to run more than once. Run it in the Supabase SQL editor (project
-- fiuikmynexwdewnazuab), then run the read back at the bottom.

-- One trigger function for all five tables: any update stamps the row.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- tasks: filled in from the last thing that happened to each task (its newest
-- comment or event, its last activity, or when it was made), so a task
-- finished months ago does not look like it changed today.
alter table tasks add column if not exists updated_at timestamptz;
update tasks set updated_at = greatest(
  created_at,
  last_activity_at,
  (select max((c->>'at')::timestamptz)
     from jsonb_array_elements(case when jsonb_typeof(comments) = 'array' then comments else '[]'::jsonb end) c
    where (c->>'at') ~ '^\d{4}-\d{2}-\d{2}T')
) where updated_at is null;
alter table tasks alter column updated_at set default now();
alter table tasks alter column updated_at set not null;

-- The other four only need a starting point older than the next refetch; the
-- time of this migration will do, and a default fills it without rewriting
-- any row.
alter table clients add column if not exists updated_at timestamptz not null default now();
alter table messages add column if not exists updated_at timestamptz not null default now();
alter table client_notes add column if not exists updated_at timestamptz not null default now();
alter table notifications add column if not exists updated_at timestamptz not null default now();

drop trigger if exists tasks_touch_updated_at on tasks;
create trigger tasks_touch_updated_at before update on tasks for each row execute function touch_updated_at();
drop trigger if exists clients_touch_updated_at on clients;
create trigger clients_touch_updated_at before update on clients for each row execute function touch_updated_at();
drop trigger if exists messages_touch_updated_at on messages;
create trigger messages_touch_updated_at before update on messages for each row execute function touch_updated_at();
drop trigger if exists client_notes_touch_updated_at on client_notes;
create trigger client_notes_touch_updated_at before update on client_notes for each row execute function touch_updated_at();
drop trigger if exists notifications_touch_updated_at on notifications;
create trigger notifications_touch_updated_at before update on notifications for each row execute function touch_updated_at();

create index if not exists tasks_updated_at_idx on tasks (updated_at);
create index if not exists messages_updated_at_idx on messages (updated_at);
create index if not exists notifications_updated_at_idx on notifications (updated_at);

-- Read back 1: five rows, each with a trigger.
select c.table_name, c.is_nullable, c.column_default,
       exists (select 1 from pg_trigger t join pg_class r on r.oid = t.tgrelid
                where r.relname = c.table_name and t.tgname = c.table_name || '_touch_updated_at') as has_trigger
from information_schema.columns c
where c.table_schema = 'public' and c.column_name = 'updated_at'
  and c.table_name in ('tasks', 'clients', 'messages', 'client_notes', 'notifications')
order by c.table_name;

-- Read back 2: what the app will load at start. Expect about 110 open and
-- about 380 finished lately, out of about 1,980.
select count(*) filter (where status <> 'done') as open_tasks,
       count(*) filter (where status = 'done' and updated_at >= now() - interval '30 days') as finished_lately,
       count(*) as all_tasks
from tasks where deleted_at is null;

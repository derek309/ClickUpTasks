-- ClickUpTasks: queues (Derek, 2026-10-14: "most dates are the order I'll
-- get to things").
--
-- A list can be a queue: one task (or N) is Now with a real due date, the
-- rest wait in line with no date, and finishing the Now one gives the next
-- its date (spacing business days out). The rules are in mcp/queue.mjs.
--
--   projects.queue          null = off (every list today). On:
--                           {"now": 1, "spacing": 3}: how many are Now at
--                           once, and how many business days out the next
--                           one's due date is.
--   tasks.queue_pos         its place in line. Gaps of 1000, so moving one
--                           task is one write. Null: not placed yet (it shows
--                           where its priority puts it until the next queue
--                           write places it). Kept, unused, when the task
--                           leaves the list or the queue is turned off.
--   tasks.deadline          its due date is a real deadline: the queue never
--                           clears or moves it, and warns when the line would
--                           land after it.
--   tasks.queue_saved_due   the due date the queue cleared when it was turned
--                           on (or the task came into the list); turning it off
--                           puts it back.
--
-- Nothing is backfilled and no list is switched on here: every column is null
-- or false, so nothing changes until someone turns a list's Queue switch on.
-- The app works before and after this runs (it reads the columns when they
-- are there and treats them as "no queue" when they are not), and only shows
-- the Queue switch once projects.queue exists. Adding a nullable column, or
-- one with a constant default, is a catalog change in Postgres 11 and later:
-- no table rewrite, no long lock on tasks.
--
-- Safe to run more than once. Run it in the Supabase SQL editor (project
-- fiuikmynexwdewnazuab), then run the read back at the bottom.

alter table projects add column if not exists queue jsonb;
alter table tasks add column if not exists queue_pos integer;
alter table tasks add column if not exists deadline boolean not null default false;
alter table tasks add column if not exists queue_saved_due date;

-- A queue list reads its open tasks in line order.
create index if not exists tasks_project_queue_pos_idx on tasks (project_id, queue_pos) where queue_pos is not null;

-- Read back: the four columns are there and nothing is switched on yet.
-- Expect 4 columns, queues_on 0, placed 0, deadlines 0, saved 0.
select (select count(*) from information_schema.columns
         where table_schema = 'public'
           and ((table_name = 'projects' and column_name = 'queue')
             or (table_name = 'tasks' and column_name in ('queue_pos', 'deadline', 'queue_saved_due')))) as columns,
       (select count(*) from projects where queue is not null) as queues_on,
       (select count(*) from tasks where queue_pos is not null) as placed,
       (select count(*) from tasks where deadline) as deadlines,
       (select count(*) from tasks where queue_saved_due is not null) as saved;

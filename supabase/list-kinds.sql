-- ClickUpTasks: what kind of list a list is (Derek, 2026-10-17, mockup:
-- CUL Tasks/lists-finish-repeat-mockup.html). Still called Lists.
--
--   projects.plan   null = holds work (every list today, and the default).
--                   {"kind": "finishes", "endsOn": "2027-02-26"}: a job with
--                   an optional end date; done when every task is done.
--                   {"kind": "repeats", "rhythm": {...}, "recipe": [...],
--                   "owner": "u_derek"}: each round is one task made from the
--                   recipe, its step dates counted back from the goes out day.
--                   The rules are in mcp/listKinds.mjs.
--
-- Nothing is backfilled: every list stays null, so nothing changes until
-- someone picks a kind. The app works before and after this runs (it reads
-- the column when it is there and treats every list as holds work when it is
-- not), and only offers the kinds once projects.plan exists. Adding a
-- nullable column is a catalog change: no table rewrite, no lock on tasks,
-- and no task row is touched.
--
-- Safe to run more than once. Run it in the Supabase SQL editor (project
-- fiuikmynexwdewnazuab), then run the read back at the bottom.

alter table projects add column if not exists plan jsonb;

-- Read back: the column is there and no list has a kind yet.
-- Expect columns 1, with_kind 0.
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'projects' and column_name = 'plan') as columns,
       (select count(*) from projects where plan is not null) as with_kind;

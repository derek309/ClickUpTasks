-- ClickUpTasks — follow a project directly, same as client-assignment.sql
-- does for clients. Run once, after client-assignment.sql.
--
-- App-level only (the "My Work" tab's assigned-or-following filter) — not
-- an RLS/visibility change. A VA who can already see a project (via an
-- assigned task there, or following its parent client, per
-- client-assignment.sql's projects_select policy) doesn't need anything
-- new to keep seeing it; this column only controls whether a project
-- without any of that shows up in "My Work".

alter table projects add column if not exists assigned_to jsonb not null default '[]';

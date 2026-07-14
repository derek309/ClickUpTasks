-- ClickUpTasks — Inbox: give notifications enough context to render a real
-- "who sent this, where does it go" row instead of just a text line, and to
-- deep-link chat mentions (which have no task_id) back to their client/project.
-- Run once in the Supabase SQL editor, after rls.sql.

alter table notifications add column if not exists actor_id text;
alter table notifications add column if not exists client_id text references clients(id) on delete cascade;
alter table notifications add column if not exists project_id text references projects(id) on delete cascade;

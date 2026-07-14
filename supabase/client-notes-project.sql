-- ClickUpTasks — let a note belong to one project within a client, not just
-- the client as a whole (e.g. internal Workspace clients with many unrelated
-- projects need separate Knowledge tabs per project). Nullable: existing
-- notes stay client-level; a note with project_id set is scoped to that
-- project's Knowledge tab instead.
-- Run once in the Supabase SQL editor, after client-links-notes.sql.

alter table client_notes add column if not exists project_id text references projects(id) on delete cascade;
create index if not exists client_notes_project_id_idx on client_notes(project_id);

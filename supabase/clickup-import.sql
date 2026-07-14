-- ClickUpTasks — one-time ClickUp import dedup key.
-- Each task imported from ClickUp stores its source ClickUp task id here so
-- re-running the importer never creates duplicates (upsert on this column).
-- Not surfaced in the app UI; taskToRow doesn't write it, so app edits to an
-- imported task leave it intact. Run once.

alter table tasks add column if not exists clickup_task_id text;
create index if not exists tasks_clickup_task_id_idx on tasks (clickup_task_id);

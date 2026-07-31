-- ClickUpTasks — records who (or what) created each task, for the "Created
-- by" label in TaskDrawer. Null for legacy rows and any creation path that
-- predates this field. Run once. taskToRow writes this column on every task
-- upsert, so this must exist before the app is deployed.
alter table tasks add column if not exists created_by text;

-- Soft delete for clients/projects/tasks — Derek accidentally hard-deleted
-- the "Lincoln, CA" project (and, via ON DELETE CASCADE, every task under
-- it) with no way to get it back. Deleting any of these three now sets
-- deleted_at instead of removing the row; a daily cron
-- (/api/cron/purge-trash) hard-deletes anything past 30 days.
alter table clients add column if not exists deleted_at timestamptz;
alter table projects add column if not exists deleted_at timestamptz;
alter table tasks add column if not exists deleted_at timestamptz;
create index if not exists clients_deleted_at_idx on clients(deleted_at) where deleted_at is not null;
create index if not exists projects_deleted_at_idx on projects(deleted_at) where deleted_at is not null;
create index if not exists tasks_deleted_at_idx on tasks(deleted_at) where deleted_at is not null;

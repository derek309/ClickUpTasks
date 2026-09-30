-- ClickUpTasks: who moved a task, list or client to the Trash (Derek, 2026-09-29:
-- "can we say who deleted and what client it went with").
--
-- The member id of whoever trashed it, the same convention task_documents
-- already uses for its own deleted_by. Empty for everything trashed before this
-- ran; the Trash shows those without a name.
--
-- ⚠ Run this BEFORE the feat/trash-who-and-client deploy: that build reads and
-- writes the column. The build running now ignores it, so running it first
-- changes nothing anyone can see. Safe to run more than once.

alter table tasks add column if not exists deleted_by text;
alter table projects add column if not exists deleted_by text;
alter table clients add column if not exists deleted_by text;

-- Read back: three rows.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and column_name = 'deleted_by' and table_name in ('tasks', 'projects', 'clients')
order by table_name;

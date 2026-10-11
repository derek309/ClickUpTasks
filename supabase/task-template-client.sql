-- ClickUpTasks: a template can be saved for one client (task detail redesign
-- phase 5, 2026-10-11, Derek: "stage the stages to use with other clients or
-- for that client"). No client_id means the template is everyone's, as all
-- templates were before. Run once in the Supabase SQL editor; safe to re-run.

alter table task_templates add column if not exists client_id text;
create index if not exists task_templates_client_idx on task_templates(client_id);

-- Read it back:
-- select column_name, data_type from information_schema.columns
--   where table_name = 'task_templates' order by ordinal_position;

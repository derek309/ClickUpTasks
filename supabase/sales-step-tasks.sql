-- ClickUpTasks — Sales checklist steps as real tasks. Each of the
-- code-defined SALES_STEPS (src/lib/data.ts) becomes a real Task row per
-- client, marked with sales_step_key so it can't be deleted or retitled by
-- hand (see TaskDrawer.tsx) and stays reconciled to the catalog by
-- reconcileSalesTasks() (Cockpit.tsx). Deliberately a separate column from
-- playbook_step_key (supabase/playbook-step-tasks.sql), not an overload of
-- it — Sales and Playbook are two distinct checklists with their own
-- projects per client.
--
-- No new RLS needed: tasks already has full RLS from rls.sql.

alter table tasks add column if not exists sales_step_key text;
create index if not exists tasks_sales_step_key_idx on tasks(client_id, sales_step_key) where sales_step_key is not null;

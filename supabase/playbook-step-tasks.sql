-- ClickUpTasks — Owner Growth Plan steps as real tasks. Each of the 18
-- code-defined PLAYBOOK_STEPS (src/lib/data.ts) becomes a real Task row per
-- client, marked with playbook_step_key so it can't be deleted or retitled
-- by hand (see TaskDrawer.tsx) and stays reconciled to the catalog by
-- reconcilePlaybookTasks() (Cockpit.tsx). Superseds the standalone
-- playbook_progress table/tracker (supabase/playbook-progress.sql) — that
-- migration already ran and the table is harmless to leave in place, just
-- unused going forward.
--
-- No new RLS needed: tasks already has full RLS from rls.sql.

alter table tasks add column if not exists playbook_step_key text;
create index if not exists tasks_playbook_step_key_idx on tasks(client_id, playbook_step_key) where playbook_step_key is not null;

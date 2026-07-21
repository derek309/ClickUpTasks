-- ClickUpTasks — playbooks: a named, admin-authored list of tasks that gets
-- loaded onto a client at once (manually for now — "Load…" from Settings;
-- stage-triggered auto-loading is a planned follow-up, not built yet). Run
-- once in the Supabase SQL editor, after rls.sql (needs is_admin()).
--
-- Distinct from task_templates (one task's checklist items) — a playbook is
-- several separate tasks, each optionally carrying its own due-date offset
-- and priority.

create table if not exists playbooks (
  id text primary key,
  name text not null,
  tasks jsonb not null default '[]',
  created_at timestamptz default now()
);

alter table playbooks enable row level security;

-- Team-wide read (anyone can load a playbook onto a client), admin-only
-- write — same shape as task_templates/client_links/territories.
drop policy if exists playbooks_select on playbooks;
create policy playbooks_select on playbooks for select to authenticated using (true);

drop policy if exists playbooks_write on playbooks;
create policy playbooks_write on playbooks for all to authenticated
  using (is_admin()) with check (is_admin());

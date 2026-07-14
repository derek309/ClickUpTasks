-- ClickUpTasks — reusable task templates (name + a checklist of item
-- titles), applied either to quick-populate a new task or to append a
-- ready-made checklist onto an existing one. Run once in the Supabase SQL
-- editor, after rls.sql (needs is_admin()).

create table if not exists task_templates (
  id text primary key,
  name text not null,
  checklist_items jsonb not null default '[]',
  created_at timestamptz default now()
);

alter table task_templates enable row level security;

-- Team-wide read (anyone can apply a template), admin-only write — same
-- shape as client_links/territories (shared reference data, curated by an
-- admin).
drop policy if exists task_templates_select on task_templates;
create policy task_templates_select on task_templates for select to authenticated using (true);

drop policy if exists task_templates_write on task_templates;
create policy task_templates_write on task_templates for all to authenticated
  using (is_admin()) with check (is_admin());

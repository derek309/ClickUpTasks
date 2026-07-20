-- ClickUpTasks — Custom Kanban stages for a project's own task board (e.g.
-- "Backlog / Designing / In Review / Shipped" instead of the fixed
-- Todo/In Progress/Review/Done). Run once, after rls.sql (needs is_admin()
-- and is_following_client()) and projects/tasks already existing.
--
-- Layered ON TOP OF tasks.status, not a replacement: is_done marks which
-- stage(s) count as "done" so the app can sync status when a task moves in
-- or out of one — every existing done/not-done consumer (urgency scoring,
-- GHL sync, MCP, recurrence-on-complete, journal completion detection)
-- keeps working unmodified. A project with no stages defined just keeps
-- today's fixed 4-column status board.

create table if not exists stages (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists stages_project_pos_idx on stages(project_id, position);

alter table tasks add column if not exists stage_id text references stages(id) on delete set null;

alter table stages enable row level security;

-- Select: team-wide within the owning project's client visibility (mirror
-- folders_select, joined through projects since stages hang off a project
-- rather than a client directly).
drop policy if exists stages_select on stages;
create policy stages_select on stages for select to authenticated using (
  is_admin()
  or exists (
    select 1 from projects p
    where p.id = stages.project_id
      and (
        exists (select 1 from tasks t where t.client_id = p.client_id and t.assignee_id = my_member_id())
        or is_following_client(p.client_id)
      )
  )
);

-- Write: admin-only, matching folders_write — stages are board structure,
-- not collaborative content.
drop policy if exists stages_write on stages;
create policy stages_write on stages for all to authenticated
  using (is_admin()) with check (is_admin());

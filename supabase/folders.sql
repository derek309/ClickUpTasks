-- ClickUpTasks — Folders: group a space's Lists (Folder → List → Task). A
-- "project" already IS a List (it holds tasks directly); this adds an optional
-- Folder layer above lists. Run once, after client-assignment.sql (needs
-- is_following_client()) and rls.sql.
--
-- projects.folder_id NULL = a standalone list. ON DELETE SET NULL means
-- deleting a folder reparents its lists to standalone (never cascades tasks).
-- position orders folders within a space and lists within their folder bucket.

create table if not exists folders (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists folders_client_pos_idx on folders(client_id, position);

alter table projects add column if not exists folder_id text references folders(id) on delete set null;
alter table projects add column if not exists position integer not null default 0;

alter table folders enable row level security;

-- Select: team-wide within the client's visibility (mirror vault_folders_select)
-- so VAs can see folder headings on clients they work.
drop policy if exists folders_select on folders;
create policy folders_select on folders for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = folders.client_id and t.assignee_id = my_member_id())
  or is_following_client(folders.client_id)
);

-- Write: admin-only, matching projects_write — folders are structure, not
-- collaborative content.
drop policy if exists folders_write on folders;
create policy folders_write on folders for all to authenticated
  using (is_admin()) with check (is_admin());

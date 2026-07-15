-- ClickUpTasks — Vault folders: organize a client's photos/files into named
-- groups. Run once, after client-assignment.sql (needs is_following_client()).
--
-- Access mirrors client_notes' current policy shape (team-wide within the
-- client's visibility, not admin-only like client_links) — organizing files
-- is a collaborative act, not structural client metadata.

create table if not exists vault_folders (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  project_id text references projects(id) on delete set null, -- reserved for future per-project narrowing; unused (always null) in v1 UI
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists vault_folders_client_id_idx on vault_folders(client_id);

alter table vault_folders enable row level security;

drop policy if exists vault_folders_select on vault_folders;
create policy vault_folders_select on vault_folders for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = vault_folders.client_id and t.assignee_id = my_member_id())
  or is_following_client(vault_folders.client_id)
);

drop policy if exists vault_folders_insert on vault_folders;
create policy vault_folders_insert on vault_folders for insert to authenticated with check (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = vault_folders.client_id and t.assignee_id = my_member_id())
  or is_following_client(vault_folders.client_id)
);

drop policy if exists vault_folders_update on vault_folders;
create policy vault_folders_update on vault_folders for update to authenticated
  using (
    is_admin()
    or exists (select 1 from tasks t where t.client_id = vault_folders.client_id and t.assignee_id = my_member_id())
    or is_following_client(vault_folders.client_id)
  )
  with check (
    is_admin()
    or exists (select 1 from tasks t where t.client_id = vault_folders.client_id and t.assignee_id = my_member_id())
    or is_following_client(vault_folders.client_id)
  );

drop policy if exists vault_folders_delete on vault_folders;
create policy vault_folders_delete on vault_folders for delete to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = vault_folders.client_id and t.assignee_id = my_member_id())
  or is_following_client(vault_folders.client_id)
);

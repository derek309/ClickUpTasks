-- ClickUpTasks — private/personal tasks.
-- A private task is visible ONLY to the person it's assigned to — not even
-- admins can see its content. Every private task lives under one shared
-- "Personal" pseudo-client/project pair (seeded below) rather than a real
-- GHL contact, so it reuses all the existing task machinery (list rendering,
-- columns, etc.) without needing a nullable client_id/project_id — RLS is
-- what actually keeps a private task hidden from everyone but its assignee,
-- regardless of the fact this pseudo-client id is shared across every user.
-- Run once, after client-assignment.sql.

alter table tasks add column if not exists is_private boolean not null default false;

insert into clients (id, name, color, ghl_location_id, status, type, assigned_to)
values ('personal', 'Personal', '#64748b', '', 'active_client', 'client', '[]')
on conflict (id) do nothing;

insert into projects (id, client_id, name, description)
values ('personal_project', 'personal', 'Personal', '')
on conflict (id) do nothing;

-- A private task is only ever visible/writable by its own assignee — the
-- is_admin() bypass that applies to every other task does not apply here.
-- Non-private tasks keep exactly the same access rules as before.
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated using (
  (is_private and assignee_id = my_member_id())
  or (not is_private and (is_admin() or assignee_id = my_member_id() or is_following_client(tasks.client_id)))
);

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (
  (is_private and assignee_id = my_member_id())
  or (not is_private and (is_admin() or assignee_id = my_member_id()))
);

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using ((is_private and assignee_id = my_member_id()) or (not is_private and (is_admin() or assignee_id = my_member_id())))
  with check ((is_private and assignee_id = my_member_id()) or (not is_private and (is_admin() or assignee_id = my_member_id())));

-- Delete stays admin-only for non-private tasks (unchanged); a private
-- task's own assignee can also delete it, since nobody else can even see it
-- to ask an admin to do it for them.
drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete to authenticated using (
  is_admin() or (is_private and assignee_id = my_member_id())
);

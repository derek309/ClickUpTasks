-- ClickUpTasks — assign clients to team members so they can follow one
-- without needing an assigned task first. Run once, after rls.sql,
-- client-links-notes.sql, and messages.sql.
--
-- This is a real visibility change, not just a UI label: a VA in a client's
-- `assigned_to` list can now see that client (and its contact/projects/
-- tasks/links/notes/messages) even with zero tasks assigned to them there —
-- previously the only way a VA could see a client at all was already having
-- a task on it. Everything else about existing RLS is unchanged: an
-- assigned-but-not-task-owner VA still can't edit a task that isn't theirs
-- (tasks_insert/update/delete are untouched), and only admins can still
-- write clients/contacts/projects/links directly.

alter table clients add column if not exists assigned_to jsonb not null default '[]';

-- SECURITY DEFINER for the same reason as is_admin()/my_member_id(): reads
-- `clients` on behalf of policies on OTHER tables (contacts/projects/tasks/
-- client_links/client_notes/messages), which would otherwise need their own
-- redundant client-lookup logic repeated seven times.
create or replace function public.is_following_client(cid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c where c.id = cid and c.assigned_to @> jsonb_build_array(my_member_id())
  );
$$;

drop policy if exists clients_select on clients;
create policy clients_select on clients for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = clients.id and t.assignee_id = my_member_id())
  or is_following_client(clients.id)
);

drop policy if exists contacts_select on contacts;
create policy contacts_select on contacts for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = 'cl_' || contacts.id and t.assignee_id = my_member_id())
  or is_following_client('cl_' || contacts.id)
);

drop policy if exists projects_select on projects;
create policy projects_select on projects for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.project_id = projects.id and t.assignee_id = my_member_id())
  or is_following_client(projects.client_id)
);

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated using (
  is_admin() or assignee_id = my_member_id() or is_following_client(tasks.client_id)
);

drop policy if exists client_links_select on client_links;
create policy client_links_select on client_links for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = client_links.client_id and t.assignee_id = my_member_id())
  or is_following_client(client_links.client_id)
);

drop policy if exists client_notes_select on client_notes;
create policy client_notes_select on client_notes for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = client_notes.client_id and t.assignee_id = my_member_id())
  or is_following_client(client_notes.client_id)
);

drop policy if exists messages_select on messages;
create policy messages_select on messages for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = messages.client_id and t.assignee_id = my_member_id())
  or is_following_client(messages.client_id)
);

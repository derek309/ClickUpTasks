-- ClickUpTasks — Phase 1c: Row-Level Security hardening
-- Run this ONCE in the Supabase SQL editor, AFTER schema.sql and auth.sql.
--
-- Model: every logged-in user has a `profiles` row (id = auth.uid()) with a
-- `role` ('admin' | 'va') and a `member_id` (roster id like 'u_maria') that
-- matches tasks.assignee_id. Admins see and manage everything. VAs see only the
-- clients, contacts, projects and tasks tied to work assigned to them.
--
-- Server routes that must bypass RLS (GHL contact sync, team management, the
-- founder bootstrap) use the service-role key via src/lib/supabaseAdmin.ts.
-- Everything the browser does runs under the signed-in user's JWT, so these
-- policies are what actually protect the data.

-- --- helper functions -------------------------------------------------------
-- SECURITY DEFINER so they can read `profiles` without tripping profiles' own
-- RLS (which would otherwise recurse). Keep search_path pinned for safety.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_member_id()
returns text language sql stable security definer set search_path = public as $$
  select member_id from profiles where id = auth.uid();
$$;

-- --- clients ----------------------------------------------------------------
alter table clients enable row level security;

drop policy if exists clients_select on clients;
create policy clients_select on clients for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = clients.id and t.assignee_id = my_member_id())
);

drop policy if exists clients_write on clients;
create policy clients_write on clients for all to authenticated
  using (is_admin()) with check (is_admin());

-- --- contacts ---------------------------------------------------------------
-- A client is a GHL contact: its id is 'cl_' || contacts.id. A VA can see a
-- contact if they have a task on the client derived from it.
alter table contacts enable row level security;

drop policy if exists contacts_select on contacts;
create policy contacts_select on contacts for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = 'cl_' || contacts.id and t.assignee_id = my_member_id())
);

drop policy if exists contacts_write on contacts;
create policy contacts_write on contacts for all to authenticated
  using (is_admin()) with check (is_admin());

-- --- projects ---------------------------------------------------------------
alter table projects enable row level security;

drop policy if exists projects_select on projects;
create policy projects_select on projects for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.project_id = projects.id and t.assignee_id = my_member_id())
);

drop policy if exists projects_write on projects;
create policy projects_write on projects for all to authenticated
  using (is_admin()) with check (is_admin());

-- --- tasks ------------------------------------------------------------------
-- VAs may see and edit the tasks assigned to them; only admins delete or
-- reassign away. Admins have full control.
alter table tasks enable row level security;

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated using (
  is_admin() or assignee_id = my_member_id()
);

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (
  is_admin() or assignee_id = my_member_id()
);

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using (is_admin() or assignee_id = my_member_id())
  with check (is_admin() or assignee_id = my_member_id());

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete to authenticated using (is_admin());

-- --- notifications ----------------------------------------------------------
-- You read/clear your own; anyone signed in can create one (e.g. to notify an
-- assignee). Admins see all.
alter table notifications enable row level security;

drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated using (
  is_admin() or recipient_id = my_member_id()
);

drop policy if exists notifications_insert on notifications;
create policy notifications_insert on notifications for insert to authenticated with check (true);

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update to authenticated
  using (is_admin() or recipient_id = my_member_id())
  with check (is_admin() or recipient_id = my_member_id());

-- --- profiles (tighten the Phase-1b policy) ---------------------------------
-- Was: readable by any authenticated user. Now: you see your own; admins see
-- all. (The team roster shown in the UI comes from the app's static user list,
-- and the Team panel reads profiles via the service role, so this is safe.)
drop policy if exists "profiles readable by authenticated" on profiles;
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated using (
  id = auth.uid() or is_admin()
);

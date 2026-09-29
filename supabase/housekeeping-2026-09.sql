-- ClickUpTasks: database housekeeping (audit 2026-09-29, wave 3.7).
--
-- Nothing here changes what anyone can see or do in the app. Safe to run at
-- any time, before or after any deploy, and more than once. Run it in the
-- Supabase SQL editor (project fiuikmynexwdewnazuab), then the read backs.
-- ⚠ Afterwards, sign in as Michaella and check a teammate picker still lists
-- everyone: profiles_select must stay exactly as wide as it is.

-- 1. Indexes for the columns the app filters on most.
create index if not exists tasks_project_id_idx on tasks (project_id);
create index if not exists messages_client_id_idx on messages (client_id);
create index if not exists contacts_client_id_idx on contacts (client_id);
create index if not exists projects_client_id_idx on projects (client_id);
create index if not exists scheduled_messages_task_id_idx on scheduled_messages (task_id);
create index if not exists notifications_recipient_created_idx on notifications (recipient_id, created_at desc);

-- 2. The same rules, with auth.uid() read once per query instead of once per
-- row. Each USING / WITH CHECK below is the live rule as of 2026-09-29 with
-- only that wrapping changed.
alter policy profiles_select on profiles
  using ((select auth.uid()) is not null);
alter policy api_tokens_select on api_tokens
  using ((owner_id = (select auth.uid())) or is_admin());
alter policy api_tokens_delete on api_tokens
  using ((owner_id = (select auth.uid())) or is_admin());
alter policy api_tokens_insert on api_tokens
  with check (owner_id = (select auth.uid()));
alter policy sender_client_memory_write on sender_client_memory
  using ((owner_id = (select auth.uid())) or is_admin())
  with check ((owner_id = (select auth.uid())) or is_admin());

-- 3. Only the server calls increment_rate_limit.
revoke execute on function increment_rate_limit(text) from authenticated;
revoke execute on function increment_rate_limit(text) from public;

-- Read back 1: six rows.
select indexname from pg_indexes
where schemaname = 'public' and indexname in (
  'tasks_project_id_idx', 'messages_client_id_idx', 'contacts_client_id_idx',
  'projects_client_id_idx', 'scheduled_messages_task_id_idx', 'notifications_recipient_created_idx')
order by indexname;

-- Read back 2: five rows, each rule showing "SELECT auth.uid()" and otherwise
-- the same as before.
select tablename, policyname, qual, with_check from pg_policies
where schemaname = 'public'
  and (policyname = 'profiles_select' or tablename = 'api_tokens' or policyname = 'sender_client_memory_write')
order by tablename, policyname;

-- Read back 3: false, false, true. The server keeps its own grant.
select has_function_privilege('authenticated', 'increment_rate_limit(text)', 'execute') as signed_in_can_call,
       has_function_privilege('anon', 'increment_rate_limit(text)', 'execute') as signed_out_can_call,
       has_function_privilege('service_role', 'increment_rate_limit(text)', 'execute') as server_can_call;

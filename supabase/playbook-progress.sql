-- ClickUpTasks — Playbook progress: per-client completion tracking for the
-- 18-step Owner Growth Plan (see PLAYBOOK_STEPS in src/lib/data.ts). Lets
-- ambassadors see + toggle which steps a business has finished, right from
-- the territory dashboard or the client's own Playbook tab. Run once, after
-- client-assignment.sql (needs is_following_client()).
--
-- NOT the same as the existing `playbooks` table (an admin-authored, reusable
-- task-bundle template loaded onto one client at a time) — this is per-client
-- state against a fixed, code-defined step catalog.
--
-- A row's mere existence means that step is done (toggle off = delete, not a
-- boolean flip) — keeps the table trivial.
--
-- Access mirrors vault_folders' policy shape (team-wide within the client's
-- visibility, not admin-only) — checking off a step is a collaborative act
-- between whichever ambassadors are working that business, not structural
-- client metadata.

create table if not exists playbook_progress (
  id text primary key,              -- 'pp_' + clientId + '_' + stepKey (deterministic)
  client_id text not null references clients(id) on delete cascade,
  step_key text not null,           -- catalog key — see PLAYBOOK_STEPS in data.ts
  completed_at timestamptz not null default now(),
  completed_by text,                -- roster member id, informational only
  unique (client_id, step_key)
);
create index if not exists playbook_progress_client_id_idx on playbook_progress(client_id);

alter table playbook_progress enable row level security;

drop policy if exists playbook_progress_select on playbook_progress;
create policy playbook_progress_select on playbook_progress for select to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = playbook_progress.client_id and t.assignee_id = my_member_id())
  or is_following_client(playbook_progress.client_id)
);

drop policy if exists playbook_progress_insert on playbook_progress;
create policy playbook_progress_insert on playbook_progress for insert to authenticated with check (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = playbook_progress.client_id and t.assignee_id = my_member_id())
  or is_following_client(playbook_progress.client_id)
);

drop policy if exists playbook_progress_update on playbook_progress;
create policy playbook_progress_update on playbook_progress for update to authenticated
  using (
    is_admin()
    or exists (select 1 from tasks t where t.client_id = playbook_progress.client_id and t.assignee_id = my_member_id())
    or is_following_client(playbook_progress.client_id)
  )
  with check (
    is_admin()
    or exists (select 1 from tasks t where t.client_id = playbook_progress.client_id and t.assignee_id = my_member_id())
    or is_following_client(playbook_progress.client_id)
  );

drop policy if exists playbook_progress_delete on playbook_progress;
create policy playbook_progress_delete on playbook_progress for delete to authenticated using (
  is_admin()
  or exists (select 1 from tasks t where t.client_id = playbook_progress.client_id and t.assignee_id = my_member_id())
  or is_following_client(playbook_progress.client_id)
);

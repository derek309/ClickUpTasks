-- ClickUpTasks — work contexts: the set of browser tabs a teammate keeps open
-- for a client, and optionally for one task under that client.
-- Run once in the Supabase SQL editor.
--
-- Why server-side and not chrome.storage.local: the Clipper is loaded
-- unpacked, so its extension id is derived from the folder path. Move the
-- folder or re-clone the repo and Chrome treats it as a different extension
-- with empty local storage. Local-only storage here would not be "per
-- machine", it would be "per checkout path", and it would evaporate silently.
--
-- Why tabs is jsonb and not a child table: a context is always read and
-- written whole, its ordering is intrinsic to the array, and nothing ever
-- queries a single tab. A child table would buy nothing and cost id churn on
-- every reorder plus a join in the hot path. This is deliberate, not an
-- oversight.
--
-- task_id null means the client's baseline context. Opening a task opens the
-- baseline plus the task's own tabs, deduped — see layerContexts in
-- chrome-extension/lib/context.js.
create table if not exists work_contexts (
  id text primary key,
  owner_member_id text not null,
  client_id text not null references clients(id) on delete cascade,
  task_id text,
  label text not null default '',
  group_color text not null default 'blue',
  tabs jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now(),
  last_opened_at timestamptz
);

-- One row per (owner, client, task). coalesce so the baseline row, where
-- task_id is null, participates in the uniqueness rule like any other.
create unique index if not exists work_contexts_scope_idx
  on work_contexts(owner_member_id, client_id, coalesce(task_id, ''));
create index if not exists work_contexts_owner_client_idx
  on work_contexts(owner_member_id, client_id);

alter table work_contexts enable row level security;

-- Personal working state, unlike client_links which is shared client metadata
-- and admin-write-only. Every teammate owns their own contexts outright, and
-- nobody else reads them. The extension routes go through the service-role
-- client and do their own owner + isClientVisible checks, so this is
-- belt-and-braces for any future direct-from-browser access.
drop policy if exists work_contexts_read on work_contexts;
create policy work_contexts_read on work_contexts for select to authenticated
  using (owner_member_id = my_member_id());

drop policy if exists work_contexts_write on work_contexts;
create policy work_contexts_write on work_contexts for all to authenticated
  using (owner_member_id = my_member_id())
  with check (owner_member_id = my_member_id());

-- ClickUpTasks — Client Hub: Quick Links + typed Notes per client.
-- Run once in the Supabase SQL editor, after rls.sql (needs is_admin()/my_member_id()).

create table if not exists client_links (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  group_label text not null default '',
  label text not null,
  url text not null,
  position integer not null default 0,
  created_at timestamptz default now()
);
create index if not exists client_links_client_id_position_idx on client_links(client_id, position);

create table if not exists client_notes (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  type text not null default 'note',      -- meeting | content | contact | deliverable | note
  body text not null default '',
  author_id text,                          -- roster id, same convention as tasks.assignee_id
  created_at timestamptz default now()
);
create index if not exists client_notes_client_id_idx on client_notes(client_id);
create index if not exists client_notes_type_created_at_idx on client_notes(type, created_at desc);

-- Pre-existing gap this migration also closes: no index backs the
-- "exists (select 1 from tasks where client_id=... and assignee_id=...)"
-- subquery used by 4 existing RLS policies + the 2 new ones below.
create index if not exists tasks_client_id_assignee_id_idx on tasks(client_id, assignee_id);

-- --- client_links: admin-only write (structural client metadata, same shape
-- as contacts_write/projects_write) -----------------------------------------
alter table client_links enable row level security;

drop policy if exists client_links_select on client_links;
create policy client_links_select on client_links for select to authenticated using (
  is_admin() or exists (select 1 from tasks t where t.client_id = client_links.client_id and t.assignee_id = my_member_id())
);

drop policy if exists client_links_write on client_links;
create policy client_links_write on client_links for all to authenticated
  using (is_admin()) with check (is_admin());

-- --- client_notes: team-wide read, author-scoped write ----------------------
-- (the one thing a JSONB-on-clients column couldn't do: let a VA write their
-- own note without also being able to touch client metadata)
alter table client_notes enable row level security;

drop policy if exists client_notes_select on client_notes;
create policy client_notes_select on client_notes for select to authenticated using (
  is_admin() or exists (select 1 from tasks t where t.client_id = client_notes.client_id and t.assignee_id = my_member_id())
);

drop policy if exists client_notes_insert on client_notes;
create policy client_notes_insert on client_notes for insert to authenticated with check (
  is_admin() or (author_id = my_member_id()
    and exists (select 1 from tasks t where t.client_id = client_notes.client_id and t.assignee_id = my_member_id()))
);

drop policy if exists client_notes_update on client_notes;
create policy client_notes_update on client_notes for update to authenticated
  using (is_admin() or author_id = my_member_id())
  with check (is_admin() or author_id = my_member_id());

drop policy if exists client_notes_delete on client_notes;
create policy client_notes_delete on client_notes for delete to authenticated using (
  is_admin() or author_id = my_member_id()
);

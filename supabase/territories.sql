-- ClickUpTasks — Ambassador territory dashboard.
-- Run once in the Supabase SQL editor, after rls.sql (needs is_admin()/my_member_id()).

-- GHL contacts already carry city/state; we just weren't syncing them.
alter table contacts add column if not exists city text;
alter table contacts add column if not exists state text;
create index if not exists contacts_city_state_idx on contacts(city, state);

-- A territory = a city+state assigned to one ambassador (existing team
-- member). "Claimed" vs "unclaimed" is derived at query time by matching
-- contacts.city/state against a territory and checking whether a `clients`
-- row (id = 'cl_' || contact.id) already exists — no separate pipeline state
-- to keep in sync with the existing client status funnel.
create table if not exists territories (
  id text primary key,
  name text not null,
  city text not null,
  state text not null,
  member_id text,               -- roster id of the assigned ambassador; null = unassigned
  created_at timestamptz default now()
);
create index if not exists territories_member_id_idx on territories(member_id);

alter table territories enable row level security;

drop policy if exists territories_select on territories;
create policy territories_select on territories for select to authenticated using (
  is_admin() or member_id = my_member_id()
);

drop policy if exists territories_write on territories;
create policy territories_write on territories for all to authenticated
  using (is_admin()) with check (is_admin());

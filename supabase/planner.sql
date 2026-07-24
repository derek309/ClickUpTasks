-- ClickUpTasks — Content Planner (the per-city weekly newsletter workflow),
-- moved in from WordPress's /sales Content Planner tab. ClickUpTasks is now
-- the source of truth for this data — WordPress becomes a push-target only
-- (see planner-push.sql / the /api/planner/push route), not somewhere
-- anyone edits from. Run once, after territories.sql/territory-multi-assign.sql
-- (needs is_admin()/my_member_id(), and territories.assigned_to).

-- A week is identified by its Wednesday ship date (matches the WordPress
-- key exactly, so push-sync needs no date translation). `picks` mirrors the
-- WP week-picks blob directly (spotlight/gem/gem2/gem3/story, each
-- {client_id, gd_place_id, name, url, cat, note}, plus a __dismissed
-- array) — one jsonb column ships faster than 5 normalized slot rows, and
-- splits out later without a breaking migration if rotation-history
-- queries ever need it.
create table if not exists planner_weeks (
  id text primary key,
  territory_id text not null references territories(id) on delete cascade,
  week date not null,
  theme_override text,
  notes text,
  picks jsonb not null default '{}',
  archived boolean not null default false,
  sent_date date,
  wp_pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists planner_weeks_territory_week_idx on planner_weeks(territory_id, week);

-- Repeatable typed write-ups ("The Story", "New In Town", "Ask Your
-- Concierge", "Last Call", or a custom title), each with an optional
-- attached business — mirrors WP's __sections array, one row per section
-- so an individual section can be reordered/edited without rewriting the
-- whole week's jsonb blob.
create table if not exists planner_sections (
  id text primary key,
  week_id text not null references planner_weeks(id) on delete cascade,
  position int not null default 0,
  type text not null default '',
  text text not null default '',
  biz_client_id text,
  biz_gd_place_id int,
  biz_name text,
  biz_url text,
  biz_cat text,
  created_at timestamptz not null default now()
);
create index if not exists planner_sections_week_id_idx on planner_sections(week_id, position);

-- Repeatable event write-ups, same optional-business shape as sections
-- minus the type field — mirrors WP's __events_list array.
create table if not exists planner_events (
  id text primary key,
  week_id text not null references planner_weeks(id) on delete cascade,
  position int not null default 0,
  text text not null default '',
  biz_client_id text,
  biz_gd_place_id int,
  biz_name text,
  biz_url text,
  biz_cat text,
  created_at timestamptz not null default now()
);
create index if not exists planner_events_week_id_idx on planner_events(week_id, position);

-- The newsletter backlog — a queue of items (business/video/event/offer/
-- news/social/blog), added from a business's own page or the planner
-- sidebar, optionally assigned to a week. week_id is nullable ("backlog")
-- and ON DELETE SET NULL: a deleted week shouldn't cascade-delete queued
-- items that happened to be assigned to it, just orphan them back to the
-- backlog — same reasoning as message-task-scope.sql's task_id link.
create table if not exists newsletter_items (
  id text primary key,
  territory_id text not null references territories(id) on delete cascade,
  type text not null default 'business',
  client_id text,
  gd_place_id int,
  week_id text references planner_weeks(id) on delete set null,
  title text not null default '',
  note text not null default '',
  url text,
  status text not null default 'pending',
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists newsletter_items_territory_id_idx on newsletter_items(territory_id);
create index if not exists newsletter_items_week_id_idx on newsletter_items(week_id);

-- The seasonal theme calendar (60 fixed entries, 5/month) — a real table
-- instead of a hardcoded TS file so it stays admin-editable without a
-- deploy, matching what it already is in WordPress (a wp_option). Shared
-- across every city, not territory-scoped. Seeding the 60 defaults is a
-- separate migration (planner-theme-calendar-seed.sql) so this file stays
-- pure schema.
create table if not exists planner_theme_calendar (
  id serial primary key,
  month int not null check (month between 1 and 12),
  week_of_month int not null check (week_of_month between 1 and 5),
  title text not null,
  categories jsonb not null default '[]'
);
create unique index if not exists planner_theme_calendar_month_week_idx on planner_theme_calendar(month, week_of_month);

-- Push-sync needs WordPress's exact city slug (PHP sanitize_title()) to
-- write into the right wp_options key — an explicit override instead of
-- re-deriving it in JS avoids silent drift from punctuation/spelling edge
-- cases. Nullable: populate per territory before Phase 4 (push-sync) ships.
alter table territories add column if not exists wp_city_slug text;

-- --- RLS ---------------------------------------------------------------
-- One helper, reused by every planner table below, same shape as
-- is_following_client (client-assignment.sql) but for territories: visible
-- to admins or a member in the territory's own assigned_to array.
create or replace function public.is_assigned_to_territory(tid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from territories t where t.id = tid and t.assigned_to ? my_member_id()
  );
$$;

alter table planner_weeks enable row level security;
drop policy if exists planner_weeks_select on planner_weeks;
create policy planner_weeks_select on planner_weeks for select to authenticated using (
  is_admin() or is_assigned_to_territory(territory_id)
);
drop policy if exists planner_weeks_write on planner_weeks;
create policy planner_weeks_write on planner_weeks for all to authenticated
  using (is_admin() or is_assigned_to_territory(territory_id))
  with check (is_admin() or is_assigned_to_territory(territory_id));

alter table planner_sections enable row level security;
drop policy if exists planner_sections_select on planner_sections;
create policy planner_sections_select on planner_sections for select to authenticated using (
  is_admin() or exists (select 1 from planner_weeks w where w.id = week_id and is_assigned_to_territory(w.territory_id))
);
drop policy if exists planner_sections_write on planner_sections;
create policy planner_sections_write on planner_sections for all to authenticated
  using (is_admin() or exists (select 1 from planner_weeks w where w.id = week_id and is_assigned_to_territory(w.territory_id)))
  with check (is_admin() or exists (select 1 from planner_weeks w where w.id = week_id and is_assigned_to_territory(w.territory_id)));

alter table planner_events enable row level security;
drop policy if exists planner_events_select on planner_events;
create policy planner_events_select on planner_events for select to authenticated using (
  is_admin() or exists (select 1 from planner_weeks w where w.id = week_id and is_assigned_to_territory(w.territory_id))
);
drop policy if exists planner_events_write on planner_events;
create policy planner_events_write on planner_events for all to authenticated
  using (is_admin() or exists (select 1 from planner_weeks w where w.id = week_id and is_assigned_to_territory(w.territory_id)))
  with check (is_admin() or exists (select 1 from planner_weeks w where w.id = week_id and is_assigned_to_territory(w.territory_id)));

alter table newsletter_items enable row level security;
drop policy if exists newsletter_items_select on newsletter_items;
create policy newsletter_items_select on newsletter_items for select to authenticated using (
  is_admin() or is_assigned_to_territory(territory_id)
);
drop policy if exists newsletter_items_write on newsletter_items;
create policy newsletter_items_write on newsletter_items for all to authenticated
  using (is_admin() or is_assigned_to_territory(territory_id))
  with check (is_admin() or is_assigned_to_territory(territory_id));

-- Shared reference data, not territory-scoped: every signed-in teammate can
-- read it (needed to show themes when picking), only admins edit it.
alter table planner_theme_calendar enable row level security;
drop policy if exists planner_theme_calendar_select on planner_theme_calendar;
create policy planner_theme_calendar_select on planner_theme_calendar for select to authenticated using (true);
drop policy if exists planner_theme_calendar_write on planner_theme_calendar;
create policy planner_theme_calendar_write on planner_theme_calendar for all to authenticated
  using (is_admin()) with check (is_admin());

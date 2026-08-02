-- ClickUpTasks — shared, admin-controlled app settings. Run once in the
-- Supabase SQL editor, after rls.sql (needs is_admin()).
--
-- Key/value rather than one column or table per toggle: this starts with
-- just "is DM chat enabled" (Derek: "we don't need DMs for now... make it so
-- we can turn it on and off in case we want it later"), and future on/off
-- switches that should be the same for the whole team — not per-browser
-- (localStorage, like cut_sidebarHidden) or per-user (a profiles column,
-- like the notification-prefs toggles) — can reuse this table instead of
-- each needing their own migration.
create table if not exists app_settings (
  key text primary key,
  value boolean not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Every signed-in user can read (e.g. to know whether to show the DM list),
-- only an admin can change a setting.
drop policy if exists app_settings_select on app_settings;
create policy app_settings_select on app_settings for select to authenticated using (true);

drop policy if exists app_settings_upsert on app_settings;
create policy app_settings_upsert on app_settings for insert to authenticated with check (is_admin());

drop policy if exists app_settings_update on app_settings;
create policy app_settings_update on app_settings for update to authenticated using (is_admin()) with check (is_admin());

insert into app_settings (key, value) values ('dm_enabled', false)
on conflict (key) do nothing;

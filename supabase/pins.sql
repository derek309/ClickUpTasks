-- Starred clients/lists (the sidebar's Pinned section) were localStorage-only
-- ("cut_starred"/"cut_starredLists") — worked fine in a normal tab, but a
-- cross-origin iframe (the app loaded as a GHL custom menu link) gets a
-- separate, partitioned storage context. Same login, same data everywhere
-- else, but an empty Pinned section — because it was never actually reading
-- the same localStorage. Per-user, DB-backed columns follow the same
-- pattern as email_notify_* (see notifications/prefs), which already works
-- correctly inside that iframe since it goes through the authenticated API
-- route, not localStorage.
alter table profiles add column if not exists starred_client_ids jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists starred_list_ids jsonb not null default '[]'::jsonb;

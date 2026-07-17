-- ClickUpTasks — weekly Review / Check-in tracking. `reviewed_at` (yyyy-mm-dd)
-- records the last time a client/project was reviewed, so the Review tier can
-- reset weekly (undated work) or monthly (nurture check-in) instead of
-- nagging forever. Run once.
alter table clients add column if not exists reviewed_at text;
alter table projects add column if not exists reviewed_at text;

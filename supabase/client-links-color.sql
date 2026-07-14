-- ClickUpTasks — color per quick link (random on create, editable via a
-- color picker in the app). Run once, after client-links-notes.sql.
alter table client_links add column if not exists color text not null default '#94a3b8';

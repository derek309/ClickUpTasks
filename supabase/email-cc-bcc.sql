-- ClickUpTasks — Cc / Bcc recipients on sent emails. Run once.
alter table messages add column if not exists cc jsonb not null default '[]';
alter table messages add column if not exists bcc jsonb not null default '[]';

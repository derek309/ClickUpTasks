-- ClickUpTasks — Knowledge -> Chat rename support: image attachments on
-- chat messages (client_notes). Task comments already store attachments
-- inside tasks.comments' existing jsonb blob, so no migration needed there.
-- Run once in the Supabase SQL editor.
alter table client_notes add column if not exists attachments jsonb not null default '[]';

-- ClickUpTasks — Scope messages to the task they were composed from (or the
-- Conversation task an inbound reply landed on), so the task drawer's
-- Activity feed can show a task's own messages instead of its whole
-- contact's full history. Run once, after messages.sql.
--
-- Nullable and on delete set null: a deleted task shouldn't cascade-delete
-- the message history that happened to be linked to it, just orphan the
-- link — the message itself still belongs to its contact/client either way.
-- No RLS policy changes needed; this only adds a filter dimension, it
-- doesn't change who can read/write messages rows.

alter table messages add column if not exists task_id text references tasks(id) on delete set null;
create index if not exists messages_task_id_idx on messages(task_id);

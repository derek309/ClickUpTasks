-- ClickUpTasks: deleted client documents can be restored for 30 days.
--
-- Derek, 2026-09-11: "deleted document we should have a restore same them for 30
-- days". Delete sets deleted_at; the daily purge-trash cron removes a document
-- (and its stored files) 30 days later, the same window as tasks, lists and
-- clients (supabase/soft-delete.sql).
--
-- A task still has one LIVE document: the unique rule on task_id becomes a
-- partial index that ignores deleted ones, so a new document can be made while an
-- old one waits in the trash.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships document restore.

alter table task_documents add column if not exists deleted_at timestamptz;
alter table task_documents add column if not exists deleted_by text;
alter table task_documents drop constraint if exists task_documents_task_id_key;
create unique index if not exists task_documents_one_live_per_task
  on task_documents (task_id) where deleted_at is null;

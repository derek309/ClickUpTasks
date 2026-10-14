-- ClickUpTasks: Saved files and links (Derek, 2026-10-14). A client's saved
-- quick links can also hold FILES saved from a task ("Save to client" on the
-- task's Files card), to put on any of the client's steps later. A saved file
-- points at the same stored object as the task it came from (task-files
-- bucket); nothing is copied. Its url is ''.
--
-- Run once in the Supabase SQL editor, after client-links-notes.sql. Until it
-- is run, links keep working; saving a file fails.

alter table client_links add column if not exists path text;
alter table client_links add column if not exists kind text;
alter table client_links add column if not exists size text;

-- Check:
-- select column_name, data_type from information_schema.columns
--  where table_name = 'client_links' and column_name in ('path', 'kind', 'size');

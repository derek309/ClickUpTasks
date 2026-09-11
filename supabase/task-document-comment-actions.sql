-- ClickUpTasks: edit, delete and complete a comment on a client review document.
--
-- Derek, 2026-09-11: "make it so we can edit, delete and mark a comment complete
-- like a task." Deleting removes the row; these columns carry the rest.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships the comment tick box. Needs supabase/task-document-comments.sql.

alter table task_document_comments add column if not exists edited_at timestamptz;
alter table task_document_comments add column if not exists completed_at timestamptz;
alter table task_document_comments add column if not exists completed_by_label text;

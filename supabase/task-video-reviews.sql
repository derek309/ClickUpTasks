-- ClickUpTasks: video review on a task, a fourth kind of client document.
--
-- Derek, 2026-09-17: he edits a video, the client watches it, pauses, and
-- comments where they paused, the way they already pin comments on an image
-- review and an HTML review. Derek chose: the file lives in the private
-- task-files bucket beside every other review file, played by our own page
-- through a signed link, so no client ever sees someone else's player.
--
-- It reuses the document tables whole, exactly as image and page review do
-- (supabase/task-image-reviews.sql, task-page-reviews.sql): the link,
-- versions, stages, files and comments. task_documents.body and each
-- version's body hold the id of the video file (tdf_...), not HTML.
--
-- This slice is only the review existing, uploading and playing. The moment a
-- comment was left at (pin_t) is a later slice and is not in this file.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE
-- the deploy that ships video review.

alter table task_documents drop constraint if exists task_documents_kind_check;
alter table task_documents add constraint task_documents_kind_check check (kind in ('doc', 'image', 'page', 'video'));

alter table task_document_files drop constraint if exists task_document_files_purpose_check;
alter table task_document_files add constraint task_document_files_purpose_check check (purpose in ('file', 'image', 'page', 'video'));

-- Read back: both constraints should now list video.
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conname in ('task_documents_kind_check', 'task_document_files_purpose_check');

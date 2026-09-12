-- ClickUpTasks: image review on a task, a second kind of client document.
--
-- Derek, 2026-09-12: "uploading an image and then we can send a link to a client
-- where they do not have to login and then they can click on a spot to add a
-- number then add a comment or upload a file ... review, suggest changes or
-- approve. want it to work similar to docs and email." Derek chose: it lives on
-- the task, a revised image is a new version that keeps the old pins, images only.
--
-- It reuses the document tables whole: the link, versions, stages, files and
-- comments. What is new:
--   task_documents.kind            'doc' (the text document) or 'image'; a task
--                                  has one live document of each kind
--   task_document_files.purpose    'image' for an uploaded version of the image,
--                                  'file' for everything else in the Files list
--   task_document_comments.pin_*   where a pin sits on which image: x and y as a
--                                  share of the width and height (0 to 1), and its
--                                  number, given by the server and never reused
--                                  while a higher number is still on that image
--   task_document_comments.attachment_file_id  a file added with the comment
--
-- For an image review, task_documents.body and each version's body hold the id of
-- the image file (tdf_...), not HTML.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships image review. Every document query filters on kind after it.

alter table task_documents add column if not exists kind text not null default 'doc';
alter table task_documents drop constraint if exists task_documents_kind_check;
alter table task_documents add constraint task_documents_kind_check check (kind in ('doc', 'image'));

-- One live document per task per kind. The new index goes in before the old one
-- comes out, so the rule is never off.
create unique index if not exists task_documents_one_live_per_task_kind
  on task_documents (task_id, kind) where deleted_at is null;
drop index if exists task_documents_one_live_per_task;

alter table task_document_files add column if not exists purpose text not null default 'file';
alter table task_document_files drop constraint if exists task_document_files_purpose_check;
alter table task_document_files add constraint task_document_files_purpose_check check (purpose in ('file', 'image'));

-- A pin goes with its image (cascade, not set null: a pin with no image would
-- break the check below and stop the 30 day trash purge).
alter table task_document_comments add column if not exists pin_file_id text references task_document_files(id) on delete cascade;
alter table task_document_comments add column if not exists pin_x real;
alter table task_document_comments add column if not exists pin_y real;
alter table task_document_comments add column if not exists pin_number int;
alter table task_document_comments add column if not exists attachment_file_id text references task_document_files(id) on delete set null;
alter table task_document_comments drop constraint if exists task_document_comments_pin_check;
alter table task_document_comments add constraint task_document_comments_pin_check check (
  (pin_file_id is null and pin_x is null and pin_y is null and pin_number is null)
  or (pin_file_id is not null and pin_x between 0 and 1 and pin_y between 0 and 1 and pin_number > 0)
);
-- Two pins dropped at the same moment cannot share a number: the second insert
-- fails here and the server tries the next number.
create unique index if not exists task_document_comments_pin_number
  on task_document_comments (document_id, pin_file_id, pin_number) where pin_number is not null;

-- Read back: all three should show the new columns, and the last row should be 0.
select column_name, table_name from information_schema.columns
  where table_name in ('task_documents', 'task_document_files', 'task_document_comments')
  and column_name in ('kind', 'purpose', 'pin_file_id', 'pin_x', 'pin_y', 'pin_number', 'attachment_file_id')
  order by table_name, column_name;
select count(*) as old_index_left from pg_indexes where indexname = 'task_documents_one_live_per_task';

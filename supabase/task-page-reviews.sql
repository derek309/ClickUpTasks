-- ClickUpTasks: web page review on a task, a third kind of client document.
--
-- Derek, 2026-09-12: "we have html that we want to send to a client to review.
-- is there a way we can upload an html file or copy code and make a page they
-- can review, comment or even edit?" Derek chose: it lives on the task beside
-- Client document and Image review, the page comes from an uploaded .html file or
-- pasted code, the client leaves numbered pins that stay on their element, and
-- the client can change the wording right on the page.
--
-- Built exactly like image review (supabase/task-image-reviews.sql): body and
-- each version's body hold the id of a file, here the page's HTML stored as
-- plain text so the raw object never renders. What is new:
--   kind 'page' and purpose 'page'
--   pin_node, pin_node_x, pin_node_y  the element a pin sits on (its number in
--                                     the page as the server numbers it) and the
--                                     spot inside that element's box (0 to 1)
--   pin_width                         the page width the pin was made at
--                                     (1280 desktop, 390 mobile)
-- pin_x and pin_y stay as the fallback share of the whole page.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships web page review.

alter table task_documents drop constraint if exists task_documents_kind_check;
alter table task_documents add constraint task_documents_kind_check check (kind in ('doc', 'image', 'page'));

alter table task_document_files drop constraint if exists task_document_files_purpose_check;
alter table task_document_files add constraint task_document_files_purpose_check check (purpose in ('file', 'image', 'page'));

alter table task_document_comments add column if not exists pin_node int;
alter table task_document_comments add column if not exists pin_node_x real;
alter table task_document_comments add column if not exists pin_node_y real;
alter table task_document_comments add column if not exists pin_width int;
alter table task_document_comments drop constraint if exists task_document_comments_pin_anchor_check;
alter table task_document_comments add constraint task_document_comments_pin_anchor_check check (
  ((pin_node is null and pin_node_x is null and pin_node_y is null)
    or (pin_file_id is not null and pin_node >= 0 and pin_node_x between 0 and 1 and pin_node_y between 0 and 1))
  and (pin_width is null or (pin_file_id is not null and pin_width between 200 and 4000))
);

-- Read back: three constraints, and the pin columns including the four new ones.
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conname in ('task_documents_kind_check', 'task_document_files_purpose_check', 'task_document_comments_pin_anchor_check');
select column_name from information_schema.columns
  where table_name = 'task_document_comments' and column_name like 'pin_%' order by 1;

-- ClickUpTasks: a Completed stage for the client review document.
--
-- Derek, 2026-09-11: "we need to have stages for the document so we know if it's
-- draft, client review, changes, approved, completed." The first four already
-- exist (draft, with_client, client_submitted, approved); this allows the fifth.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships the stage picker.

alter table task_documents drop constraint if exists task_documents_status_check;
alter table task_documents add constraint task_documents_status_check
  check (status in ('draft', 'with_client', 'client_submitted', 'approved', 'completed'));

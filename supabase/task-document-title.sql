-- ClickUpTasks: a name for the client review document.
--
-- Derek, 2026-09-11: "We will also need a document name." The document now shows
-- in a task as one line with its name and opens full screen. An empty title
-- reads as the task's title everywhere it is shown.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships the document line item.

alter table task_documents add column if not exists title text not null default '';

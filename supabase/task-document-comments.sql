-- ClickUpTasks: comments on a client review document.
--
-- Derek, 2026-09-11: "a chat box for comments", one thread the team and the
-- client both see; the client reads and replies on their review page, and a
-- client comment notifies the task owner.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships document comments. Needs supabase/task-documents.sql.

create table if not exists task_document_comments (
  id text primary key,
  document_id text not null references task_documents(id) on delete cascade,
  body text not null,
  -- Member id of the teammate, or null when the client wrote it.
  author_id text,
  author_label text,
  created_at timestamptz not null default now()
);
create index if not exists task_document_comments_document_idx
  on task_document_comments (document_id, created_at);

alter table task_document_comments enable row level security;

-- Read only for the team, on documents whose task the member can already see.
-- Every write goes through the server.
drop policy if exists task_document_comments_select on task_document_comments;
create policy task_document_comments_select on task_document_comments for select to authenticated
  using (exists (
    select 1 from task_documents d join tasks t on t.id = d.task_id
    where d.id = task_document_comments.document_id
  ));

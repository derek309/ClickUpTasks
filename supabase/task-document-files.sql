-- ClickUpTasks: files and the team's save history on a client review document.
--
-- Derek, 2026-09-11: "can we upload files and photos to it as well?" (a list under
-- the document, and the client can add files too) and "keep track of the history
-- of changes by who and versions" (team saves as well as sends).
--
--   task_document_files        one row per file, who added it, who removed it
--   task_document_checkpoints  the team's saved drafts between sends
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships the document's Files list. Needs supabase/task-documents.sql.

create table if not exists task_document_files (
  id text primary key,
  document_id text not null references task_documents(id) on delete cascade,
  -- Object in the private task-files bucket, always under doc/<document_id>/.
  path text not null unique,
  name text not null,
  size_bytes bigint not null default 0,
  kind text not null default 'doc',
  -- Member id of the teammate, or null when the client added it.
  added_by text,
  added_by_label text,
  created_at timestamptz not null default now(),
  -- When the client can see it. A client's file is shared as it is added; a
  -- teammate's is shared by the next send, like the text.
  shared_at timestamptz,
  removed_at timestamptz,
  removed_by text,
  removed_by_label text
);
create index if not exists task_document_files_document_idx
  on task_document_files (document_id, created_at);

create table if not exists task_document_checkpoints (
  id text primary key,
  document_id text not null references task_documents(id) on delete cascade,
  body text not null,
  author_id text,
  author_label text,
  created_at timestamptz not null default now()
);
create index if not exists task_document_checkpoints_document_idx
  on task_document_checkpoints (document_id, created_at desc);

alter table task_document_files enable row level security;
alter table task_document_checkpoints enable row level security;

-- Read only for the team, on documents whose task the member can already see.
-- Every write goes through the server.
drop policy if exists task_document_files_select on task_document_files;
create policy task_document_files_select on task_document_files for select to authenticated
  using (exists (
    select 1 from task_documents d join tasks t on t.id = d.task_id
    where d.id = task_document_files.document_id
  ));

drop policy if exists task_document_checkpoints_select on task_document_checkpoints;
create policy task_document_checkpoints_select on task_document_checkpoints for select to authenticated
  using (exists (
    select 1 from task_documents d join tasks t on t.id = d.task_id
    where d.id = task_document_checkpoints.document_id
  ));

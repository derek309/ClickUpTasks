-- ClickUpTasks: project instructions on a task, for an outside person.
--
-- Derek, 2026-09-30: "adding a deliverable for project instructions that we can
-- create a document and then share it with a Fiverr or a third party to do the
-- design", then "it needs to be separate from document though". He picked A
-- from the mockup (~/Local Sites/CUL Tasks/project-instructions-mockup.html): one
-- read only link that expires, and a drop box so the person can send their files
-- back, which land on the task for the team to check first.
--
-- Its own tables on purpose, not another kind in task_documents. Everything
-- there is a CLIENT review: parseKind reads an unknown kind as the client
-- document, and the review link, reminders, boards and MCP all list those rows.
-- A row here can never be mistaken for one, so a designer can never be shown
-- Approve or post as the client.
--
--   task_briefs        the instructions (one live set per task) and their settings
--   task_brief_links   the outside link, readable by the server only
--   task_brief_files   files the team sends with it, and files sent back
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships Project instructions. Read back with the last query.

create table if not exists task_briefs (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  title text not null default '',
  -- Sanitized HTML, the same allowlist as the client document (docHtml.ts).
  body text not null default '',
  -- When the person should send it back by. Their date, not the task's.
  due_on date,
  -- Whether the outside page names the client's business. Never their contact.
  show_business boolean not null default true,
  -- Whether the outside page lets them send files back.
  uploads_open boolean not null default true,
  -- Last time the outside page was on screen for a few seconds.
  viewed_at timestamptz,
  -- Files sent back ring the owner at most every 15 minutes.
  last_outside_notified_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
create unique index if not exists task_briefs_one_per_task on task_briefs (task_id);

-- Kept apart from the instructions so the hash and ciphertext never reach a
-- teammate's browser or realtime. bound_task_id is written once: a reused task id
-- can never make an old link open.
create table if not exists task_brief_links (
  brief_id text primary key references task_briefs(id) on delete cascade,
  token_hash text unique,
  token_enc text,
  bound_task_id text not null,
  created_by text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  expires_at timestamptz
);

create table if not exists task_brief_files (
  id text primary key,
  brief_id text not null references task_briefs(id) on delete cascade,
  -- Object in the private task-files bucket, always under brief/<brief_id>/.
  path text not null unique,
  name text not null,
  size_bytes bigint not null default 0,
  kind text not null default 'doc',
  -- true: sent back through the outside link. false: the team's, sent with it.
  from_outside boolean not null default false,
  -- Member id of the teammate, null for the outside person.
  added_by text,
  -- The teammate's name, or the name the outside person typed.
  added_by_label text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  -- When the team put it in the task's image review.
  moved_at timestamptz
);
create index if not exists task_brief_files_brief_idx on task_brief_files (brief_id, created_at);

alter table task_briefs enable row level security;
alter table task_brief_links enable row level security;
alter table task_brief_files enable row level security;

-- Read only for the team, on tasks the member can already see (the tasks policy
-- carries the private task and delegation rules). Every write goes through the
-- server. task_brief_links has no policies: only the service role reads it.
drop policy if exists task_briefs_select on task_briefs;
create policy task_briefs_select on task_briefs for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_briefs.task_id));

drop policy if exists task_brief_files_select on task_brief_files;
create policy task_brief_files_select on task_brief_files for select to authenticated
  using (exists (
    select 1 from task_briefs b join tasks t on t.id = b.task_id
    where b.id = task_brief_files.brief_id
  ));

-- Read back: three tables, RLS on for each (true), two policies.
select c.relname as table_name, c.relrowsecurity as rls_on,
  (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c where c.relname in ('task_briefs', 'task_brief_links', 'task_brief_files') order by 1;

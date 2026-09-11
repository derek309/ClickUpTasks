-- ClickUpTasks — a client review document on a task.
--
-- Derek, 2026-09-11: "a simple content edit like a document in a task so we can
-- write up content, send it to a client to review, and they can edit or approve
-- it quickly ... I don't want them to have to login."
--
-- Three tables, none of them columns on tasks. tasks loads every column for tens
-- of thousands of rows at boot, streams whole rows over realtime, and the browser
-- saves a task with a full-row upsert, which would overwrite a client's submitted
-- text. The document lives beside the task instead, loaded one task at a time.
--
--   task_documents          the team's working copy and the review state
--   task_document_versions  one row per send, client submit, and client approve
--   task_document_links     the private link, readable by the server only
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships /api/doc and the drawer's document block.

create table if not exists task_documents (
  id text primary key,
  -- One document per task (Derek's decision), enforced here rather than trusted
  -- to the app.
  task_id text not null unique references tasks(id) on delete cascade,
  -- Sanitized HTML. The team's working copy between sends.
  body text not null default '',
  -- The team has edited since the last send. A client submit then keeps the
  -- team's text as the working copy instead of replacing it.
  draft_dirty boolean not null default false,
  -- Latest published version. 0 means never sent.
  version int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'with_client', 'client_submitted', 'approved')),
  approved_at timestamptz,
  approved_version int,
  -- Submit emails the owner at most every 15 minutes per document.
  last_client_notified_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists task_document_versions (
  id text primary key,
  document_id text not null references task_documents(id) on delete cascade,
  version int not null,
  kind text not null check (kind in ('sent', 'client_submitted', 'client_approved')),
  body text not null,
  -- Member id of the teammate, or null when the client wrote it.
  author_id text,
  author_label text,
  created_at timestamptz not null default now(),
  -- Also the index the versions list reads through.
  unique (document_id, version)
);

-- The link lives apart from the document so its hash and ciphertext never reach
-- a teammate's browser and are never broadcast over realtime. bound_task_id and
-- bound_client_id are written once: a task moved to another client, or a task id
-- reused, can never make an old link resolve.
create table if not exists task_document_links (
  document_id text primary key references task_documents(id) on delete cascade,
  token_hash text unique,
  token_enc text,
  bound_task_id text not null,
  bound_client_id text not null,
  created_by text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  expires_at timestamptz
);

alter table task_documents enable row level security;
alter table task_document_versions enable row level security;
alter table task_document_links enable row level security;

-- Read only for the team, and only for documents on tasks the member can already
-- see. Deriving it from tasks (not using (true)) carries the private task and
-- delegation rules over without restating them. Every write goes through the
-- server, which sanitizes and checks versions first, so there are no insert,
-- update or delete policies.
drop policy if exists task_documents_select on task_documents;
create policy task_documents_select on task_documents for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_documents.task_id));

drop policy if exists task_document_versions_select on task_document_versions;
create policy task_document_versions_select on task_document_versions for select to authenticated
  using (exists (
    select 1 from task_documents d join tasks t on t.id = d.task_id
    where d.id = task_document_versions.document_id
  ));

-- task_document_links: RLS on with no policies. Only the service role reads it.

-- Publish one new version atomically. Locks the document row so two submits
-- cannot both win, and refuses a publish built on a version that has moved on.
-- Returns the new version number, or:
--   -1  the base version is stale (someone published first)
--   -2  the document is approved and locked
--   -3  no such document
create or replace function public.publish_task_document_version(
  p_document_id text, p_base_version int, p_kind text, p_body text,
  p_author_id text, p_author_label text, p_version_id text)
returns int language plpgsql security definer set search_path = public as $$
declare
  d task_documents%rowtype;
  v_new int;
begin
  select * into d from task_documents where id = p_document_id for update;
  if not found then return -3; end if;
  if d.approved_at is not null then return -2; end if;
  if d.version <> p_base_version then return -1; end if;

  v_new := d.version + 1;
  insert into task_document_versions (id, document_id, version, kind, body, author_id, author_label)
    values (p_version_id, p_document_id, v_new, p_kind, p_body, p_author_id, p_author_label);

  update task_documents set
    version = v_new,
    status = case p_kind
      when 'sent' then 'with_client'
      when 'client_submitted' then 'client_submitted'
      else 'approved' end,
    body = case when p_kind = 'sent' or not d.draft_dirty then p_body else d.body end,
    draft_dirty = case when p_kind = 'sent' then false else d.draft_dirty end,
    approved_at = case when p_kind = 'client_approved' then now() else null end,
    approved_version = case when p_kind = 'client_approved' then v_new else null end,
    updated_by = p_author_id,
    updated_at = now()
  where id = p_document_id;

  return v_new;
end;
$$;

-- Supabase's default privileges grant execute on new functions to anon and
-- authenticated by name, so revoking from public alone leaves both able to call it.
revoke all on function public.publish_task_document_version(text, int, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_task_document_version(text, int, text, text, text, text, text) to service_role;

-- ClickUpTasks: the email a teammate is writing to a client outside any task
-- (the client Journal's Email and Reply, and Remind client), kept until it is
-- sent or discarded. One per client. An email on a task keeps using
-- tasks.draft_email. Read and written from the browser (db.ts
-- fetchClientEmailDraft / saveClientEmailDraft / deleteClientEmailDraft), by
-- anyone who can see the client (the same rule as clients_select).
-- Run once in the Supabase SQL editor, before the deploy that uses it.

create table if not exists client_email_drafts (
  client_id text primary key references clients(id) on delete cascade,
  draft jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table client_email_drafts enable row level security;
revoke all on client_email_drafts from anon;

drop policy if exists client_email_drafts_all on client_email_drafts;
create policy client_email_drafts_all on client_email_drafts for all to authenticated
  using (
    is_admin()
    or exists (select 1 from tasks t where t.client_id = client_email_drafts.client_id and t.assignee_id = my_member_id())
    or is_following_client(client_email_drafts.client_id)
  )
  with check (
    is_admin()
    or exists (select 1 from tasks t where t.client_id = client_email_drafts.client_id and t.assignee_id = my_member_id())
    or is_following_client(client_email_drafts.client_id)
  );

-- ClickUpTasks — Team Chat + DM extensions: quote-reply, attachments, pin.
-- Adds the same three columns to both team_messages and dm_messages
-- (see team-chat.sql / dm-chat.sql) plus one new UPDATE policy on each —
-- neither table has an update policy today (both were insert/delete-only).
-- Run once, after team-chat.sql and dm-chat.sql.

alter table team_messages add column if not exists reply_to_id text references team_messages(id) on delete set null;
alter table team_messages add column if not exists attachments jsonb not null default '[]';
alter table team_messages add column if not exists pinned boolean not null default false;
alter table team_messages add column if not exists pinned_by text;
alter table team_messages add column if not exists pinned_at timestamptz;

alter table dm_messages add column if not exists reply_to_id text references dm_messages(id) on delete set null;
alter table dm_messages add column if not exists attachments jsonb not null default '[]';
alter table dm_messages add column if not exists pinned boolean not null default false;
alter table dm_messages add column if not exists pinned_by text;
alter table dm_messages add column if not exists pinned_at timestamptz;

-- Update: pin/unpin only, in practice — the app never lets you edit a sent
-- message's body, but the RLS layer can't distinguish "which columns changed",
-- so this authorizes any authenticated team_messages participant (everyone,
-- same as team_messages_select) to update a row. Pin is a shared curation
-- action ("this is important"), not message ownership like delete is.
drop policy if exists team_messages_update on team_messages;
create policy team_messages_update on team_messages for update to authenticated using (true) with check (true);

-- Same reasoning, scoped to the two DM participants (or admin) — matches
-- dm_messages_select's existing predicate exactly.
drop policy if exists dm_messages_update on dm_messages;
create policy dm_messages_update on dm_messages for update to authenticated using (
  is_admin() or my_member_id() = author_id or my_member_id() = recipient_id
) with check (
  is_admin() or my_member_id() = author_id or my_member_id() = recipient_id
);

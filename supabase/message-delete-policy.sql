-- ClickUpTasks — admin-only delete for client-facing messages (email/sms/
-- chat). Run once. Messages had insert/select/update policies but no delete
-- policy at all, so this was previously impossible via the anon key.
--
-- Admin-only (not "assignee too", unlike team_messages_delete) — a wrongly
-- sent CLIENT-FACING message is higher stakes than an internal chat message,
-- and correcting what a client already saw should go through someone with
-- the full picture. Editing a message's body/subject is admin-only too, but
-- goes through a server route (src/app/api/messages/edit/route.ts) instead
-- of RLS + column grants — RLS can't scope "assignees may only touch the
-- `read` column, admins may touch `body`" on the same authenticated role,
-- since column grants and row policies don't compose that way.
drop policy if exists messages_delete on messages;
create policy messages_delete on messages for delete to authenticated using (is_admin());

-- Added later: one row per Gmail message, so attaching a thread to a task can
-- upsert the messages already in it without duplicating anything the reply
-- poller has already ingested. Partial because almost every row has no Gmail
-- id at all (chat, SMS, anything from GoHighLevel).
create unique index if not exists messages_gmail_message_id_key
  on messages(gmail_message_id) where gmail_message_id is not null;

-- Added later: which GoHighLevel conversation a message belongs to. The GHL
-- equivalent of gmail_thread_id — what lets an inbound reply find the task it
-- belongs to instead of falling to a generic "Reply to <client>" task. The
-- lookup is always "newest message on this conversation that knows its task",
-- so conversation plus recency is exactly the index for it.
alter table messages add column if not exists ghl_conversation_id text;
create index if not exists messages_ghl_conversation_idx
  on messages(ghl_conversation_id, created_at desc)
  where ghl_conversation_id is not null;

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

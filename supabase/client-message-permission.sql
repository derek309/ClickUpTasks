-- ClickUpTasks — per-client-per-VA permission to send email/SMS as that
-- client, layered on top of the existing global profiles.can_send_messages
-- (message-permission.sql). Mirrors client-assignment.sql's shape (a jsonb
-- array of roster ids on `clients`) but is NOT a visibility grant — RLS is
-- untouched. clients_write (rls.sql) is already admin-only ("using
-- (is_admin())"), so no new RLS policy is needed: this column is just
-- another admin-writable field on a row only admins can already write.
--
-- Effective send permission (enforced in /api/ghl/message/route.ts):
--   caller.role === 'admin'
--   || (caller.canSendMessages && (clientRow.can_message ?? []).includes(caller.memberId))
-- Run once.

alter table clients add column if not exists can_message jsonb not null default '[]';

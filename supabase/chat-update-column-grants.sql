-- ClickUpTasks — tighten the chat/unmatched UPDATE surface to only the columns
-- the app actually writes. Run once, after chat-reply-attachments-pins.sql and
-- inbound-unmatched-rls.sql.
--
-- Why: those UPDATE policies are `using (true) with check (true)` (or a
-- participant check) because RLS can't say WHICH columns changed — so today any
-- authenticated teammate could rewrite a message's `body` or even `author_id`
-- (impersonation), and the pin policy was only ever meant to allow pin/unpin.
-- Postgres column-level privileges CAN scope columns, so we layer them under the
-- existing RLS: RLS still governs which ROWS are visible/updatable, and these
-- grants restrict updates to the exact columns each feature touches:
--   team_messages / dm_messages -> pin fields only (pinned, pinned_by, pinned_at)
--   inbound_unmatched           -> handled only
-- The app's own writers already touch only these columns (db.ts
-- updateTeamMessageDb / updateDmMessageDb / markUnmatchedHandledDb), so this is
-- a no-op for legitimate use and closes the tampering path for everyone else.
--
-- Idempotent: revoke/grant are safe to re-run.

revoke update on team_messages from authenticated;
grant update (pinned, pinned_by, pinned_at) on team_messages to authenticated;

revoke update on dm_messages from authenticated;
grant update (pinned, pinned_by, pinned_at) on dm_messages to authenticated;

revoke update on inbound_unmatched from authenticated;
grant update (handled) on inbound_unmatched to authenticated;

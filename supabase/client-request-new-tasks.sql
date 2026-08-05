-- ClickUpTasks — per-client permission to raise brand-new tasks from the
-- public client page (/waiting/[token], see client-share-token.sql). Holding
-- a share link already lets a client reply on the work we put in front of
-- them; this column is what additionally opens the "Add Something" composer,
-- which creates a real task (see src/app/api/waiting/[token]/request/route.ts).
-- Defaults false, so an existing client keeps the reply-only page until an
-- admin turns it on, and a newly synced client never gets an open request box
-- by accident.
--
-- Same shape and reasoning as client-message-permission.sql: a plain
-- admin-writable field on `clients`, no RLS change needed, since clients_write
-- (rls.sql) is already admin-only ("using (is_admin())"). The public request
-- route reads it with the service role and rejects when it isn't true, so the
-- hidden button is only the courtesy — this column is the actual gate.
--
-- clientToRow writes this column on every client upsert, so this must exist
-- before the app is deployed. Run once.

alter table clients add column if not exists can_request_new_tasks boolean not null default false;

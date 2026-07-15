-- ClickUpTasks — per-user permission to send email/SMS. Run once.
-- Admins can always send; VAs default to off until an admin grants it.
alter table profiles add column if not exists can_send_messages boolean not null default false;

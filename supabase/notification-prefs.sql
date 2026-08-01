-- ClickUpTasks — per-user email notification preferences.
-- Run once in the Supabase SQL editor.
--
-- Opt-out migration: default true on all three so every existing user keeps
-- today's all-on behavior until they explicitly turn one off. The in-app
-- bell/notifications table is never gated by these — only the best-effort
-- email companion (see /api/notifications/email and mention-email routes).
alter table profiles add column if not exists email_notify_activity boolean not null default true;
alter table profiles add column if not exists email_notify_message boolean not null default true;
alter table profiles add column if not exists email_notify_dm boolean not null default true;

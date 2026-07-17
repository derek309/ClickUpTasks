-- ClickUpTasks — split the Inbox into "messages" (direct @mentions/comments)
-- vs "task notices" (automatic assignment/status/due-date side effects).
-- Run once. Older rows keep kind = null, treated as 'activity' by rowToNotif.
alter table notifications add column if not exists kind text;

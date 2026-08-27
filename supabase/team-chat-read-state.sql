-- ClickUpTasks — server-side "last read" marker for Team Chat.
-- Run once in the Supabase SQL editor.
--
-- The unread badge used to live in localStorage under cut_teamChatLastRead,
-- which meant reading the channel on a laptop left the badge still showing on
-- a phone, and clearing your browser data made every message unread again.
-- Cheap to store per user, and the badge is now a count rather than a dot, so
-- being wrong about it is more visible than it used to be.
alter table profiles add column if not exists team_chat_last_read_at timestamptz;

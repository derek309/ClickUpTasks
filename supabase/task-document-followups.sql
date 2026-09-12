-- ClickUpTasks: follow ups on the client review document (Derek, 2026-09-11).
-- Run once in the Supabase SQL editor, before the deploy that uses it.
--   client_viewed_at          last time the client's review page opened in a browser
--                             ("Viewed 2h ago"), from a beacon the page sends, never
--                             from the link's GET (mail scanners open links too)
--   client_comment_emailed_at last time the client was emailed about a team comment,
--                             so a run of comments sends one email
--   reminder_drafted_at       when the daily job last staged a "just checking in"
--                             draft email because the client had not approved

alter table task_documents add column if not exists client_viewed_at timestamptz;
alter table task_documents add column if not exists client_comment_emailed_at timestamptz;
alter table task_documents add column if not exists reminder_drafted_at timestamptz;

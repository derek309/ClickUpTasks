-- ClickUpTasks: reminder emails to a client who has a review waiting.
--
-- Derek, 2026-09-21: "if a client has something to review (an image, a
-- newsletter, a blog, HTML, or a video in client review), set a 24 hour
-- reminder for them to review it and approve it ... stop after 3 ... allow us
-- to be able to log in and redo it ... make sure that it's 3 business days."
--
-- Until now the reminder was a DRAFT staged on the task after three days, once
-- per send, for a person to read and send. It now SENDS, through the scheduled
-- message queue that already retries and signs sends as their author. Rules,
-- in src/lib/reviewReminders.ts:
--   every N business days (default 1), counted in California time
--   at most 3 in a round, then the task's owner is told instead
--   a round starts at each send and at each Restart
--   a round stops when the client answers: a message on the task or a comment
--
-- Columns, all on the review itself:
--   reminder_every_days  business days between reminders; 0 turns them off
--   reminder_round_at    when someone last pressed Restart
--   reminders_sent       reminders sent in the current round
--   last_reminder_at     when the last one went
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that sends reminders. Every existing review starts at the default:
-- every business day. The first business morning after the deploy, the reviews
-- that are with a client and unanswered get their first reminder.

alter table task_documents add column if not exists reminder_every_days smallint not null default 1;
alter table task_documents add column if not exists reminder_round_at timestamptz;
alter table task_documents add column if not exists reminders_sent smallint not null default 0;
alter table task_documents add column if not exists last_reminder_at timestamptz;

alter table task_documents drop constraint if exists task_documents_reminder_every_check;
alter table task_documents add constraint task_documents_reminder_every_check
  check (reminder_every_days between 0 and 10 and reminders_sent >= 0);

-- Read back: four columns, and which reviews the first run will remind.
select column_name, data_type, column_default from information_schema.columns
  where table_name = 'task_documents'
    and column_name in ('reminder_every_days', 'reminder_round_at', 'reminders_sent', 'last_reminder_at')
  order by column_name;

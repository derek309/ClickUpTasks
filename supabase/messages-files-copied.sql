-- messages.files_copied_at: when an email's files were put on its task(s)
-- (audit 2026-10-10). The 5 minute job (/api/cron/email-files) read the same
-- 60 emails every run, about 35,000 reads a day, and put back a file someone
-- had removed from a task. With this it reads each email once.
--
-- Safe to run before or after the deploy (the job falls back to the old
-- query without it) and more than once. Supabase SQL editor, project
-- fiuikmynexwdewnazuab.
alter table public.messages add column if not exists files_copied_at timestamptz;

-- Everything already there counts as done, so nothing old is copied again.
update public.messages set files_copied_at = now()
 where files_copied_at is null and task_id is not null and attachments <> '[]'::jsonb
   and created_at < now() - interval '6 hours';

create index if not exists messages_files_to_copy_idx on public.messages (created_at desc)
  where files_copied_at is null and task_id is not null;

-- Read back: the column exists (one row).
select column_name from information_schema.columns where table_name = 'messages' and column_name = 'files_copied_at';

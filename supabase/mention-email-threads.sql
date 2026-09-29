-- Reply by email to an @mention, and have it land on the task.
--
-- Run once in the Supabase SQL editor.
--
-- Until now the mention email was a dead end: it is sent from the mentioner's
-- own mailbox, so hitting reply put the answer in their inbox and nowhere
-- else. The email said so, in as many words: "Please do not reply to this
-- email." Asking someone to go and find the task instead is the sort of thing
-- people do once and then stop doing.
--
-- This is the same trick the client email ingest already uses, and nothing
-- more: Gmail gives a reply the SAME threadId as the message it replies to, so
-- one row per mention email is enough to answer "which task does this thread
-- belong to" when the reply shows up in the poller two minutes later. No
-- tokens in addresses, no inbound mail provider, no new infrastructure.
--
-- Small and self cleaning: rows are only useful while a reply might still
-- arrive, and purge-trash sweeps them after 90 days.
create table if not exists public.mention_email_threads (
  -- Gmail's own thread id, which is what an inbound reply is matched on.
  gmail_thread_id text primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  -- Who was mentioned, so a reply from anyone else on the thread is still
  -- attributed correctly, and so this row says what it was for when read by a
  -- human six weeks later.
  recipient_member_id text,
  created_at timestamptz not null default now()
);

create index if not exists mention_email_threads_task_idx
  on public.mention_email_threads (task_id);
create index if not exists mention_email_threads_created_idx
  on public.mention_email_threads (created_at);

-- Written and read only by the service role: the mention email route records
-- the thread, the Gmail poller reads it. No browser client ever touches this,
-- so row level security is on with no policy at all, which denies everyone
-- except the service role.
alter table public.mention_email_threads enable row level security;

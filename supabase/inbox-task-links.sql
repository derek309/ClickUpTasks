-- More than one task on an Inbox conversation (Derek, 2026-10-07: a client
-- replies on the same email with more to do). messages.task_id stays the
-- conversation's main task, where new replies land; this holds the others.
-- Read and written only through /api/inbox/link (service role), so RLS is on
-- with no policies.
create table if not exists public.inbox_task_links (
  thread_key text not null,
  task_id text not null references public.tasks(id) on delete cascade,
  linked_by text,
  created_at timestamptz not null default now(),
  primary key (thread_key, task_id)
);
create index if not exists inbox_task_links_task_idx on public.inbox_task_links (task_id);
alter table public.inbox_task_links enable row level security;

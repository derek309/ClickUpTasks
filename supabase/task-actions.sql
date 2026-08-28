-- ClickUpTasks — the outcome log.
--
-- The task drawer's activity feed used to record what the APP did: priority
-- changed, due date changed, assignee changed. Nobody reads that. This
-- records what a PERSON did, and every entry can carry the commitment it
-- created, which is the part that was always missing.
--
-- One row per action taken on a task from the drawer's action dock:
--   note     an internal note, the team sees it, the client never does
--   team     a message sent to a teammate about this task
--   chat     a message to the client through the task's portal chat
--   email    an email to the client
--   sms      a text to the client
--   call     a phone call, dialled from the dock
--   meeting  a booked appointment, or a booking request sent
--
-- next_step/next_step_due are the whole point: an action that leaves nothing
-- scheduled is how 93 of 179 open tasks ended up with no date on them. They
-- stay nullable because a note genuinely doesn't need one, and forcing a
-- follow-up date on "FYI for Michaella" would just train people to type junk.
create table if not exists task_actions (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  kind text not null check (kind in ('note','team','chat','email','sms','call','meeting')),
  author_id text,
  body text not null default '',
  at timestamptz not null default now(),
  next_step text,
  next_step_due date,
  next_step_done_at timestamptz
);

-- The feed reads one task newest-first and nothing else ever queries this,
-- so one composite index covers every access path there is.
create index if not exists task_actions_task_at_idx on task_actions(task_id, at desc);

alter table task_actions enable row level security;

-- Same shape as dm_messages: any signed-in member can read and add, only an
-- admin or the author can remove. Task-level visibility is already enforced
-- by which tasks a member can see; re-deriving it here would duplicate that
-- rule in a second place and let the two drift.
drop policy if exists task_actions_select on task_actions;
create policy task_actions_select on task_actions for select to authenticated using (true);

drop policy if exists task_actions_insert on task_actions;
create policy task_actions_insert on task_actions for insert to authenticated
  with check (author_id = my_member_id());

-- Update is deliberately narrow in practice: the only in-place edit is
-- ticking a next step done. Anyone on the team can do that, because the
-- person who closes a loop often isn't the one who opened it.
drop policy if exists task_actions_update on task_actions;
create policy task_actions_update on task_actions for update to authenticated
  using (true) with check (true);

drop policy if exists task_actions_delete on task_actions;
create policy task_actions_delete on task_actions for delete to authenticated
  using (is_admin() or author_id = my_member_id());

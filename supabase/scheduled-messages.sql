-- ClickUpTasks — scheduled outgoing SMS/email. A composed message held for a
-- future send time, fired by the /api/cron/send-scheduled cron. On success
-- it becomes a real `messages` row (see messages.sql), same as a "send now"
-- would produce — this table only tracks the queue up to that point.
--
-- Not layered onto Task.draftEmail: that field is a single overwritable
-- "reviewed and about to be sent" draft. This needs unbounded pending rows
-- per client/task with a fire time and a status machine.

create table if not exists scheduled_messages (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  task_id text references tasks(id) on delete set null, -- null when composed from the client Journal, not a task
  channel text not null default 'email',      -- email | sms
  subject text,
  body text not null default '',
  cc jsonb not null default '[]',
  bcc jsonb not null default '[]',
  from_email text,                            -- optional per-teammate sender override (admin-only, same as google/send)
  attachments jsonb not null default '[]',
  scheduled_at timestamptz not null,
  status text not null default 'pending',     -- pending | sent | failed | canceled
  error text,
  created_by text not null,                   -- roster id — schedule author, and the sent-as identity
  sent_message_id text references messages(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists scheduled_messages_due_idx on scheduled_messages(scheduled_at) where status = 'pending';
create index if not exists scheduled_messages_client_id_idx on scheduled_messages(client_id);

-- RLS: same shape as messages_select/messages_insert (team-wide read/write
-- scoped to clients you have an assigned task on).
alter table scheduled_messages enable row level security;

drop policy if exists scheduled_messages_select on scheduled_messages;
create policy scheduled_messages_select on scheduled_messages for select to authenticated using (
  is_admin() or exists (select 1 from tasks t where t.client_id = scheduled_messages.client_id and t.assignee_id = my_member_id())
);

drop policy if exists scheduled_messages_insert on scheduled_messages;
create policy scheduled_messages_insert on scheduled_messages for insert to authenticated with check (
  is_admin() or exists (select 1 from tasks t where t.client_id = scheduled_messages.client_id and t.assignee_id = my_member_id())
);

-- Update = cancel only (status -> 'canceled'), enforced in the route, not
-- here — same trust level as insert.
drop policy if exists scheduled_messages_update on scheduled_messages;
create policy scheduled_messages_update on scheduled_messages for update to authenticated
  using (is_admin() or exists (select 1 from tasks t where t.client_id = scheduled_messages.client_id and t.assignee_id = my_member_id()))
  with check (is_admin() or exists (select 1 from tasks t where t.client_id = scheduled_messages.client_id and t.assignee_id = my_member_id()));

-- The cron/service-role path writes via supabaseAdmin, which bypasses RLS
-- entirely — no separate policy needed for that path.

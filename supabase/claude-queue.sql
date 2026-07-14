-- ClickUpTasks — "Queue for Claude Code" list. A per-person hand-picked set of
-- tasks to hand to Claude Code (read by the MCP server's list_queue tool).
-- Separate table (not a column on tasks) so it can never break task writes.
-- Run once, after rls.sql.

create table if not exists claude_queue (
  task_id   text primary key references tasks(id) on delete cascade,
  member_id text not null,
  at        timestamptz not null default now()
);
alter table claude_queue enable row level security;

drop policy if exists claude_queue_select on claude_queue;
create policy claude_queue_select on claude_queue for select to authenticated using (member_id = my_member_id() or is_admin());
drop policy if exists claude_queue_insert on claude_queue;
create policy claude_queue_insert on claude_queue for insert to authenticated with check (member_id = my_member_id() or is_admin());
drop policy if exists claude_queue_delete on claude_queue;
create policy claude_queue_delete on claude_queue for delete to authenticated using (member_id = my_member_id() or is_admin());

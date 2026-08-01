-- ClickUpTasks — marks a task as an auto-generated playbook check-in (see
-- src/lib/playbookCheckinsServer.ts and the toggle route's progress trigger).
-- Deliberately a SEPARATE column from playbook_step_key, not an overload of
-- it: playbook_step_key drives TaskDrawer's read-only/no-delete treatment for
-- real Owner Growth Plan steps, and a check-in task must stay a normal,
-- fully-editable task.
alter table tasks add column if not exists checkin_kind text; -- 'playbook_stalled' | 'playbook_progress' | null
create index if not exists tasks_checkin_kind_idx on tasks(client_id, checkin_kind) where checkin_kind is not null;

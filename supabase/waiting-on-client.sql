-- ClickUpTasks — "waiting on the client" task state. A task assigned to the
-- client (we're waiting on them) rather than a team member. Run once.
-- taskToRow writes this column on every task upsert, so this must exist
-- before the app is deployed.
alter table tasks add column if not exists waiting_on_client boolean not null default false;

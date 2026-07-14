-- ClickUpTasks — attachments on sent/received messages. Run once.
alter table messages add column if not exists attachments jsonb not null default '[]';

-- ClickUpTasks — contact relationship type (client / prospect / past client /
-- vendor). Run once. Not every GHL contact you converse with is an active
-- client — this lets you classify one without giving it full sidebar/task
-- presence unless it's actually type 'client'.
alter table clients add column if not exists type text not null default 'client';

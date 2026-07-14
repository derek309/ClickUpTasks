-- ClickUpTasks — capture phone number from GHL contact sync. Run once.
alter table contacts add column if not exists phone text;

-- ClickUpTasks: the Inbox lets every email in (Derek, 2026-10-02). What Gmail
-- files under Updates, Promotions, Social or Forums, and anything automated,
-- goes to the Inbox's Updates folder instead of the Inbox. Run once.
alter table messages add column if not exists bulk boolean not null default false;

select 'bulk column' as check, exists (select 1 from information_schema.columns where table_name = 'messages' and column_name = 'bulk') as ok;

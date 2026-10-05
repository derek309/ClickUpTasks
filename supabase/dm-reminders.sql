-- The "your message is waiting" email (Derek, 2026-10-05): a direct message
-- nobody answered in 2 hours gets one reminder email, and this records it so
-- it is never sent twice.
alter table dm_messages add column if not exists reminded_at timestamptz;

-- Read back: true when the column is there.
select exists (
  select 1 from information_schema.columns
  where table_name = 'dm_messages' and column_name = 'reminded_at'
) as reminded_at_added;

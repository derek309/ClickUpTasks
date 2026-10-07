-- A contact's other email addresses (2026-10-07). GoHighLevel's additional
-- emails, plus any main address they used to have, so mail from those still
-- matches them (src/lib/contactEmails.ts). Safe to run twice.
alter table public.contacts add column if not exists additional_emails text[] not null default '{}';

-- Read back: one row, data_type ARRAY, column_default '{}'::text[].
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'contacts' and column_name = 'additional_emails';

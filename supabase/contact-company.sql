-- ClickUpTasks — store each contact's business/company name (GHL companyName)
-- so search results can show "Name · Business". Populated on the next GHL
-- contact sync (Settings → Sync); existing rows stay blank until re-synced.
-- Run once, after schema.sql.

alter table contacts add column if not exists company_name text;

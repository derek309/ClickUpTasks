-- ClickUpTasks — reclassify auto-synced territory businesses as prospects.
-- Run once in the Supabase SQL editor. No DDL: `clients.type` already exists
-- (see client-type.sql) and already has 'prospect' as a valid value.
--
-- Why: the territory view auto-creates a `clients` row for every directory
-- business it matches to a GHL contact (syncTerritoryClients in Cockpit.tsx).
-- Those were being created as type 'client', so opening a city put its entire
-- business list — 231 for Lincoln alone — into the client sidebar and the
-- Clients directory, burying the real roster. Going forward they're created
-- as 'prospect'; this backfills the ones already stored.
--
-- Safety: only rows that are still untouched are moved. A business with any
-- task or any journal note is work someone has actually started, so it keeps
-- whatever type it has and stays exactly where it is today. Reversible — the
-- inverse update is the same WHERE with type='prospect'.

-- 1. DRY RUN — run this first and eyeball the count before step 2.
select count(*) as will_change
from clients
where type = 'client'
  and status = 'lead'
  and id like 'cl\_%'
  and id not in (select distinct client_id from tasks where client_id is not null)
  and id not in (select distinct client_id from client_notes where client_id is not null);

-- 2. THE UPDATE — same WHERE as the dry run above.
update clients set type = 'prospect'
where type = 'client'
  and status = 'lead'
  and id like 'cl\_%'
  and id not in (select distinct client_id from tasks where client_id is not null)
  and id not in (select distinct client_id from client_notes where client_id is not null);

-- 3. VERIFY — the roster count that now drives the sidebar.
select type, count(*) from clients where id like 'cl\_%' group by type order by type;

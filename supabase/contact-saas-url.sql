-- The client's SaaS URL, mirrored from the GoHighLevel contact custom field
-- "SaaS" (fieldKey contact.saas). Cached here so a client list can show it
-- without a GHL round trip per row; GoHighLevel stays the source of truth and
-- every edit writes back there first.
alter table contacts add column if not exists saas_url text;

-- ClickUpTasks — explicit client → GoHighLevel contact link.
-- Most clients are "cl_" + a synced GHL contact id, so their GHL contact is
-- derived from the id. But clients created another way (e.g. a ClickUp-origin
-- import, id "cl_cu_...") have no such contact, so Open-in-GHL and task import
-- can't light up for them. This column lets an admin explicitly point such a
-- client at a synced contact without changing the client's id (which its
-- tasks reference) or creating a duplicate client.
-- Run once, after client-assignment.sql.

alter table clients add column if not exists linked_contact_id text;

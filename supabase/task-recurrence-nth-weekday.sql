-- ClickUpTasks — "3rd Monday of the month" style recurrence.
-- Already applied to the live project; kept here so the schema history is
-- complete and a fresh database can be built from these files.
--
-- nth is 1..4, or -1 for the last one. weekday is 0=Sunday..6=Saturday,
-- matching Date#getUTCDay so no translation is needed anywhere.
-- Only meaningful when recurrence = 'custom' and recurrence_unit =
-- 'nth-weekday'. There is deliberately no 5th: most months haven't got one,
-- so offering it would silently skip months.
alter table tasks add column if not exists recurrence_nth smallint;
alter table tasks add column if not exists recurrence_weekday smallint;

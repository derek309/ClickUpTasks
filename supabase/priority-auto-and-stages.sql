-- Whether this task's priority still follows its due date.
--
-- Priority is derived from the due date by default (no date -> none, due in
-- 3 days or less or overdue -> urgent, otherwise normal). The moment someone
-- sets a priority by hand this flips false and their choice sticks, so the
-- app never argues with a deliberate decision.
--
-- Defaults FALSE for every row that already exists: those priorities were set
-- by a person over months of work, and switching them all to automatic on
-- deploy would silently rewrite them. New tasks are created with true.
alter table tasks add column if not exists priority_auto boolean not null default false;

-- The two new stages ("get_started", "approved") need no migration: status is
-- a plain text column with no check constraint.

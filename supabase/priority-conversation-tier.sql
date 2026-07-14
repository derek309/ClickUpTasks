-- ClickUpTasks — 4-tier priority system (Conversation/Urgent/Normal/No
-- priority), replacing the old 5-tier scheme (none/low/medium/high/urgent).
-- `tasks.priority` is a plain text column with no CHECK constraint (see
-- schema.sql), so this is a data remap only — no column/type change needed.
-- Remap: low+medium -> normal, high+urgent stays urgent. Existing 'none'
-- rows need no change. Run once, any time before deploying the app code
-- that introduces the new Priority values.
update tasks set priority = 'normal' where priority in ('low', 'medium');
update tasks set priority = 'urgent' where priority = 'high';
-- 'urgent' rows already match the new scheme's value, no-op.

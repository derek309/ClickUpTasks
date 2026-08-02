-- ClickUpTasks — tracks when a client's Sales checklist last saw real
-- progress, same idea as playbook-progress-tracking.sql for the Playbook.
-- Feeds the Businesses page's Priority sort: a claimed business stuck on the
-- same Sales step for STEP_STALL_DAYS+ (src/lib/data.ts) counts as due,
-- same as an unclaimed business overdue for a Planner outreach touch.
-- Bumped from the in-app patchTask flow (Cockpit.tsx) whenever a Sales
-- step's status changes.
alter table clients add column if not exists sales_last_progress_at timestamptz;

-- ClickUpTasks — tracks when a client's Owner Growth Plan (Playbook) last saw
-- real progress, so the daily stall-check cron (src/lib/playbookCheckinsServer.ts)
-- can tell "quiet because it's done" apart from "quiet because it's stuck."
-- Bumped from both completion paths: the in-app patchTask flow (Cockpit.tsx)
-- and the owner-facing toggle webhook (external/playbook/[ghlContactId]/toggle).
alter table clients add column if not exists playbook_last_progress_at timestamptz;

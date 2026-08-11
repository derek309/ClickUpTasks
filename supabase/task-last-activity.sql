-- ClickUpTasks — real timestamp for "last touched" on a Conversation task.
-- due (yyyy-mm-dd) already doubled as a last-touched heuristic for Follow
-- Up's sort, but date-only precision meant every task bumped the same day
-- looked identical — sorting "latest first" was a no-op among same-day rows
-- (Derek, 2026-08-11). last_activity_at is written only by
-- upsertConversationTask (ghlConversationTask.ts), same scoping as due
-- itself, so a routine edit elsewhere (renaming a task, editing a checklist
-- item) can't fake a fresh-engagement signal.
-- Run once.

alter table tasks add column if not exists last_activity_at timestamptz;

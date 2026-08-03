-- Per-territory daily cap for the auto-invite cron (runPlannerAutoInvite,
-- see plannerAutoInviteServer.ts). null/0 = auto-invite off for that city.
alter table territories add column if not exists daily_invite_cap integer;

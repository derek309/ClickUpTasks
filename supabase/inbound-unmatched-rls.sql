-- ClickUpTasks — fix: inbound_unmatched was created (inbound-unmatched.sql)
-- without ever enabling Row-Level Security, so it was fully public (read/
-- write/delete) to anyone with the project's anon key — flagged by Supabase's
-- security advisor ("Table publicly accessible", rls_disabled_in_public).
-- Run once, in the Supabase SQL editor.
--
-- Access pattern (confirmed from the app code): the Gmail poll route
-- (src/app/api/google/poll-replies/route.ts) writes rows via supabaseAdmin
-- (service role, bypasses RLS regardless of policy). The browser app
-- (src/lib/db.ts) only ever selects and updates `handled` — no insert/delete
-- from the client — so this mirrors team_messages' team-wide "using (true)"
-- trust model for select/update, and deliberately grants no insert/delete
-- policy to authenticated users (nothing needs it, so don't open it).
alter table inbound_unmatched enable row level security;

drop policy if exists inbound_unmatched_select on inbound_unmatched;
create policy inbound_unmatched_select on inbound_unmatched for select to authenticated using (true);

drop policy if exists inbound_unmatched_update on inbound_unmatched;
create policy inbound_unmatched_update on inbound_unmatched for update to authenticated using (true) with check (true);

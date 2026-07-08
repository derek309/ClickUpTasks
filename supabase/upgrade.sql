-- ClickUpTasks — production-readiness upgrade
-- Run ONCE in the Supabase SQL editor (after rls.sql / storage.sql).
-- Two things:
--   1. ghl_tokens table — moves GoHighLevel tokens off the local file so the
--      app works on Vercel (serverless has no persistent filesystem). RLS is
--      enabled with NO policies: only the service-role key can touch it.
--   2. Team roster visibility — every signed-in user may read basic profile
--      fields (name/color/role) so assignees and avatars resolve for VAs too.

-- 1 ─ GHL token storage (service-role only)
create table if not exists ghl_tokens (
  location_id text primary key,
  token text not null,
  updated_at timestamptz default now()
);
alter table ghl_tokens enable row level security;
-- no policies on purpose: anon/authenticated get nothing; service role bypasses RLS.

-- 2 ─ roster readable by the team
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated using (true);

-- ClickUpTasks — profile avatar headshots.
-- Prereq: in the Supabase dashboard, Storage → New bucket → name it exactly
--   avatars  and turn "Public bucket" ON. Headshots aren't sensitive, and a
--   public URL means every Avatar render across the app is a plain <img src>
--   with no signed-URL round trip (unlike the private task-files bucket).
-- Uploads go through a service-role API route (/api/team/avatar), not direct
-- client Storage calls, so no storage.objects RLS policies are needed here —
-- the service role bypasses RLS, and a public bucket serves reads with none.
-- Run once, after schema.sql.

alter table profiles add column if not exists avatar_url text;

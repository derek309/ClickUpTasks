-- client_websites: a client's WordPress site, for sending task pictures into
-- its Media Library (Derek, 2026-10-12: "when images are attached to a task,
-- get them uploaded to the media storage or website"). The address, a
-- WordPress username and an Application Password made for that user
-- (WordPress: Users, Profile, Application Passwords).
--
-- No browser access at all, like client_ghl_keys: RLS on, no policies; only
-- the server's service role reads or writes it, and the password is never
-- sent back to the browser. One site per client. Safe to run more than once.
-- Supabase SQL editor, project fiuikmynexwdewnazuab.
create table if not exists public.client_websites (
  client_id text primary key references public.clients(id) on delete cascade,
  site_url text not null,
  wp_user text not null,
  app_password text not null,
  created_by text,
  updated_at timestamptz not null default now()
);
alter table public.client_websites enable row level security;
revoke all on public.client_websites from anon, authenticated;

-- Read back: should return one row, rowsecurity = true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'client_websites';

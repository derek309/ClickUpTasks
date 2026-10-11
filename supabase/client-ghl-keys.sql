-- client_ghl_keys: a client's own GoHighLevel sub account key, for their
-- website (Brain Box "Connect GoHighLevel", /api/extension/ghl-connection).
-- Kept apart from ghl_tokens on purpose (2026-10-11): everything in
-- ghl_tokens is treated as one of ours (the 15 minute message pull,
-- calendars and booking, lookups that try every key), so a client's key
-- there would pull their customers' conversations into the team Inbox.
-- Nothing reads this table but the two routes that hand a key to the
-- client's own website and let an admin set it.
--
-- No browser access at all: RLS on, no policies; only the server's
-- service role reads or writes it. One key per client. Safe to run more
-- than once. Supabase SQL editor, project fiuikmynexwdewnazuab.
create table if not exists public.client_ghl_keys (
  client_id text primary key references public.clients(id) on delete cascade,
  location_id text not null,
  token text not null,
  created_by text,
  updated_at timestamptz not null default now()
);
alter table public.client_ghl_keys enable row level security;
revoke all on public.client_ghl_keys from anon, authenticated;

-- Read back: should return one row, rowsecurity = true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'client_ghl_keys';

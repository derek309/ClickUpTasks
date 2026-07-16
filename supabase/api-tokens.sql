-- ClickUpTasks — Personal API tokens, so external clients (starting with the
-- Gmail Chrome extension) can create tasks on a specific user's behalf
-- without embedding the Supabase service-role key or a short-lived session
-- JWT. Run once, after auth.sql (needs profiles + is_admin()).
--
-- Only a hash of the token is stored, never the raw value — same reasoning
-- as a password hash, though a high-entropy random token doesn't need
-- bcrypt's slow-hash properties the way a human-chosen password does; a
-- plain sha256 digest is the standard practice for API tokens (GitHub PATs
-- work the same way).

create table if not exists api_tokens (
  id text primary key,
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null default 'Chrome extension',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists api_tokens_owner_id_idx on api_tokens(owner_id);

alter table api_tokens enable row level security;

-- Defense-in-depth only — every route touching this table uses the
-- service-role client and enforces ownership in application code
-- (requireApiToken, requireUser + an owner_id check), same convention as
-- every other table in this schema.
drop policy if exists api_tokens_select on api_tokens;
create policy api_tokens_select on api_tokens for select to authenticated using (owner_id = auth.uid() or is_admin());

drop policy if exists api_tokens_insert on api_tokens;
create policy api_tokens_insert on api_tokens for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists api_tokens_delete on api_tokens;
create policy api_tokens_delete on api_tokens for delete to authenticated using (owner_id = auth.uid() or is_admin());

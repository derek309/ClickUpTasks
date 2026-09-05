-- ClickUpTasks — remembered sender to client, for the Gmail Clipper.
-- Run after auth.sql (needs profiles) and rls.sql (needs is_admin()).
--
-- This lived in chrome.storage.local under "senderClientMap", which made it a
-- browser preference: it died on reinstall, never reached a second machine,
-- and a correction one person made was invisible to everyone else. "Mail from
-- brian@ is BibBoards work" is a fact about a person, not about a browser, so
-- it belongs next to the contacts it is correcting.
--
-- TWO ids, not one. The Clipper's picker lists real clients (cl_...) AND the
-- workspace's own projects (p_...), and picking a project files the task under
-- the cl_workspace pseudo-client — which the picker never lists. It re-selects
-- a row by that row's own id and silently does nothing when it cannot find it,
-- so storing only the resolved client made every internal-project pick
-- unrecallable. That was the bug in the browser version; storing both is the
-- fix rather than a relocation of it.
--   client_id  what the task is filed under, and what visibility is checked on
--   entry_id   the exact picker row to re-select; null for an ordinary client
--
-- Owned per user, read across the team. Two people legitimately file the same
-- sender differently (a VA puts billing@ under the client, an admin puts it
-- under Administration), so one shared row per address would make each
-- correction stomp the other's with no way to settle it. Instead: your own row
-- always wins for you, and a teammate's is a decent guess when you have none.
-- The read path filters a teammate's row through the caller's own visibility,
-- so this can never reveal that a client exists to someone who cannot see it.
create table if not exists sender_client_memory (
  owner_id uuid not null references profiles(id) on delete cascade,
  -- Stored already trimmed and lower-cased by the route, matching how
  -- match-client normalises before its contact lookup.
  sender_email text not null,
  client_id text not null references clients(id) on delete cascade,
  entry_id text,
  updated_at timestamptz not null default now(),
  -- Doubles as the overwrite mechanism: correcting a mapping is the same
  -- upsert as making one, so there is no separate "forget" path to maintain.
  primary key (owner_id, sender_email)
);

-- The lookup is by address, not by owner: "who has taught anything about this
-- sender", then filter to what the caller may see.
create index if not exists sender_client_memory_email_idx on sender_client_memory(sender_email);
create index if not exists sender_client_memory_client_idx on sender_client_memory(client_id);

alter table sender_client_memory enable row level security;

-- Defense-in-depth only — every route touching this table uses the
-- service-role client and enforces ownership plus visibility in application
-- code (requireApiToken + visibleClientIds), same convention as api_tokens.
--
-- select is deliberately open to any signed-in user: the whole point is that a
-- teammate's mapping can help you, and the route is what narrows the result to
-- clients you are allowed to see.
drop policy if exists sender_client_memory_select on sender_client_memory;
create policy sender_client_memory_select on sender_client_memory for select to authenticated using (true);

drop policy if exists sender_client_memory_write on sender_client_memory;
create policy sender_client_memory_write on sender_client_memory for all to authenticated
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

-- ClickUpTasks — Granola meeting notes synced into a client's Journal. Run
-- once. See src/lib/granolaSyncServer.ts (the actual sync logic, driven by
-- the webhook route + a manual backfill route).
--
-- granola_synced_notes is the idempotency ledger: every Granola note we've
-- ever looked at, matched or not, keyed by Granola's own note id — a webhook
-- retry or a backfill re-run is a no-op once a note is in here.
create table if not exists granola_synced_notes (
  granola_note_id text primary key,
  client_id text references clients(id) on delete set null,
  client_note_id text references client_notes(id) on delete set null,
  synced_at timestamptz default now()
);

-- granola_unmatched: same "park it for the team to triage" pattern as
-- inbound_unmatched.sql (unsorted inbound email) — a meeting whose attendees
-- don't match any known contact lands here instead of being silently
-- dropped. Rows are kept (not deleted) and flagged handled once acted on, so
-- a re-run of the sync can't re-surface an already-dismissed one.
create table if not exists granola_unmatched (
  id text primary key,
  granola_note_id text not null unique,
  title text,
  attendees jsonb not null default '[]', -- [{name, email}]
  summary text,
  web_url text,
  occurred_at text,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists granola_unmatched_handled_idx on granola_unmatched(handled);

-- RLS: this is meeting content (attendee emails, AI summaries) — admin-only,
-- matching how Cockpit.tsx already gates it in the UI (canAdmin ? ... : []).
-- Inserts only ever come from the webhook/sync routes via supabaseAdmin
-- (service role bypasses RLS), so no authenticated insert policy is needed.
alter table granola_unmatched enable row level security;
drop policy if exists granola_unmatched_select on granola_unmatched;
create policy granola_unmatched_select on granola_unmatched for select to authenticated using (is_admin());
drop policy if exists granola_unmatched_update on granola_unmatched;
create policy granola_unmatched_update on granola_unmatched for update to authenticated using (is_admin()) with check (is_admin());

-- granola_synced_notes has no direct read need client-side; the one
-- client-side write (backfilling client_id/client_note_id when an admin
-- manually assigns an unmatched meeting) is gated the same way.
alter table granola_synced_notes enable row level security;
drop policy if exists granola_synced_notes_update on granola_synced_notes;
create policy granola_synced_notes_update on granola_synced_notes for update to authenticated using (is_admin()) with check (is_admin());

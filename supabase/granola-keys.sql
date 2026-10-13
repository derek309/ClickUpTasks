-- Per-person Granola keys (Derek, 2026-10-12): each teammate pastes their own
-- personal Granola API key, so their meetings come in from whatever folder
-- they keep them in. Only the server (service role) reads this table: no RLS
-- policies on purpose. The key and the webhook secret are encrypted with
-- TOKEN_ENC_KEY (lib/tokenCrypto).
create table if not exists granola_keys (
  user_id uuid primary key references profiles(id) on delete cascade,
  hook_id text not null unique,          -- in the webhook URL, names the row without naming the person
  key_enc text not null,
  webhook_id text,
  webhook_secret_enc text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table granola_keys enable row level security;

-- Whose key filed a note, so its transcript is fetched with that same key.
alter table granola_synced_notes add column if not exists granola_user_id uuid;

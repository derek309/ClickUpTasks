-- ClickUpTasks — unsorted inbound email. When a pulled Gmail message is from a
-- real person who isn't a known contact, it's parked here so the team can read
-- it and either add them as a client or dismiss it. Rows are deleted once
-- acted on. Run once.
create table if not exists inbound_unmatched (
  id text primary key,           -- the Gmail message id (dedups re-polls)
  from_email text not null,
  from_name text,
  subject text,
  body text,
  at text,                       -- ISO timestamp of the email
  handled boolean not null default false,  -- set (not deleted) when acted on, so re-polls don't re-surface it
  created_at timestamptz not null default now()
);

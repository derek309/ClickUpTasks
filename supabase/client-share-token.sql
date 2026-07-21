-- ClickUpTasks — client share links: a public, no-login page
-- (/waiting/[token]) showing a specific client the open tasks flagged
-- "waiting on client" for them ("here's what we need from you"). The token
-- is stored retrievably, not hashed — this is a share link (like a Google
-- Doc's "anyone with the link"), not a login credential, and "Copy client
-- link" needs to return the same working link every time it's clicked, not
-- a new one that invalidates the last. Lazily generated client-side
-- (crypto.randomUUID(), 122 bits of randomness) the first time it's copied.
-- Run once, after rls.sql.

alter table clients add column if not exists share_token text unique;
create index if not exists clients_share_token_idx on clients(share_token) where share_token is not null;

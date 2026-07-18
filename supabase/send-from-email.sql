-- Per-teammate email sender identity.
--
-- ghl_user_id: the teammate's GoHighLevel user id. Passed as `userId` on
-- outbound email sends so GHL attributes the send to that user and uses their
-- own GHL email as the "from" — the same native behavior as a manual send from
-- inside GHL. This is the primary mechanism for per-teammate senders.
--
-- send_from_email: optional explicit from-address hint (used alongside on the
-- payload). Secondary to ghl_user_id.
--
-- Both nullable/plain text, admin-managed via TeamPanel. GHL user ids are
-- agency-global, so one value per teammate works across every sub-account.
alter table profiles add column if not exists send_from_email text;
alter table profiles add column if not exists ghl_user_id text;

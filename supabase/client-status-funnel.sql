-- Expand clients.status from the old 3-value set (active/paused/archived) to
-- a full lifecycle funnel: lead, prospect, onboarding, active_client,
-- cancelled, past_client. Run once, after client-status.sql.
--
-- clients.status is plain text with no CHECK constraint, so this doesn't
-- touch the schema — it only remaps existing rows. That remap is required,
-- though: the app's status labels/colors are keyed by the new value set, and
-- an old value like 'active' has no entry there anymore (it would render as
-- a blank/broken status dot instead of crashing, but every client would look
-- unset until this runs).
--
-- Mapping: 'active' and 'paused' both fold into 'active_client' (there's no
-- new status that specifically means "temporarily paused"; those clients are
-- still an active engagement). 'archived' becomes 'past_client'.
update clients set status = 'active_client' where status in ('active', 'paused');
update clients set status = 'past_client' where status = 'archived';

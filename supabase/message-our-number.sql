-- ClickUpTasks: which of our GoHighLevel numbers a text used (Derek,
-- 2026-10-15, after a client asked "Are you texting me from another number?").
-- our_number is the number on our side of a text: the one ours went out from,
-- or the one theirs came in to. The text box defaults to the number the
-- conversation last used (lib/textFrom), and the thread says which number each
-- of our texts went from. Null when not known (every text before this).
--
-- The app works before this runs: a row is stored without the number, and the
-- default is the account's default number. Run once.
alter table messages add column if not exists our_number text;

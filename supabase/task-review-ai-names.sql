-- AI names for review documents (Derek, 2026-09-13: "have ai rename the titles for
-- doc, images and html so it's not generic"). src/lib/reviewAutoName.ts names a
-- review once, when it first gets content, and only while its title is still blank.
-- ai_named_at marks that it has had its one try, so a later save, or a name someone
-- clears again, never brings the AI back. Existing reviews keep the names they have.
alter table task_documents add column if not exists ai_named_at timestamptz;

-- Read back: expect one row, ai_named_at, timestamp with time zone.
select column_name, data_type
from information_schema.columns
where table_name = 'task_documents' and column_name = 'ai_named_at';

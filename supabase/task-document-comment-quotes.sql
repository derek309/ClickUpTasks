-- ClickUpTasks: a comment on a client document can point at the words it is about
-- (Derek, 2026-09-12: comments on a specific sentence). quote is the text the
-- person selected; the document highlights it, and the page jumps between the
-- words and the comment. Null for a comment on the whole document. The document's
-- own HTML is untouched, so versions, the diff and the sanitizer never see it.
-- Run once in the Supabase SQL editor, before the deploy that uses it.

alter table task_document_comments add column if not exists quote text;

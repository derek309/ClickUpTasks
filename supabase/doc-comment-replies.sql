-- Replies under a review comment (commit 1a29ea6, 2026-10-08) read and write
-- task_document_comments.parent_id, which was never added: every edit,
-- resolve and reply failed on it (Derek, 2026-10-12: "when I mark resolved
-- nothing happens"). One level of replies; a deleted comment takes its replies.
alter table task_document_comments add column if not exists parent_id text references task_document_comments(id) on delete cascade;
create index if not exists task_document_comments_parent_idx on task_document_comments(parent_id);

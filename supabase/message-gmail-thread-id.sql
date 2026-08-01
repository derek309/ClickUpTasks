-- Gmail thread id for emails sent/received through Google Workspace — lets an
-- inbound reply be matched back to whichever specific task it was originally
-- sent from (ticket-style threading), instead of always landing on the
-- generic per-contact "Reply to X" Conversation task. See
-- src/lib/inboundIngest.ts's resolveTaskForThread. Nullable; GHL sends and
-- pre-existing rows leave it null, same style as gmail-message-id.sql.
alter table messages add column if not exists gmail_thread_id text;
create index if not exists messages_gmail_thread_id_idx on messages(contact_id, gmail_thread_id) where gmail_thread_id is not null;

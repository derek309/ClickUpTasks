-- Gmail message id for emails sent through Google Workspace (the per-teammate
-- "from" path — see src/lib/googleMail.ts). Nullable; GHL sends and inbound
-- rows leave it null. Additive, same style as the message-attachments columns.
alter table messages add column if not exists gmail_message_id text;

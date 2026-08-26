-- Per-user email signature, appended server-side to every outbound client
-- EMAIL (never SMS, never internal chat) — see src/lib/emailSignature.ts and
-- its three call sites: /api/google/send, /api/ghl/message, and the
-- scheduled-send path in src/lib/sendMessageServer.ts.
--
-- Stores HTML, authored in the same RichTextEditor the email composer uses.
-- Values written before it became rich text were plain text; both helpers in
-- emailSignature.ts normalize on read (looksLikeHtml), so no backfill is
-- needed. Read/written by the owner only, through /api/signature.
alter table profiles add column if not exists email_signature text;

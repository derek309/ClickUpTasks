-- Per-user email signature, appended server-side to every outbound client
-- EMAIL (never SMS, never internal chat) — see src/lib/emailSignature.ts and
-- its three call sites: /api/google/send, /api/ghl/message, and the
-- scheduled-send path in src/lib/sendMessageServer.ts.
--
-- Plain text, not HTML: it is escaped and newline-to-<br>'d at send time, so
-- there is no stored markup to sanitize and the same value is safe in every
-- path. Read/written by the owner only, through /api/signature.
alter table profiles add column if not exists email_signature text;

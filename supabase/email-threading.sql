-- ClickUpTasks: replies thread in the client's inbox (Derek, 2026-09-11).
-- Run once in the Supabase SQL editor, before the deploy that uses it.
--   messages.rfc822_message_id           the email's Message-ID header, the one id
--                                        that is the same in every mailbox. A reply
--                                        sets In-Reply-To and References from it.
--   scheduled_messages.reply_to_message_id  a scheduled reply keeps what it answers
--                                        (messages.id) until the cron sends it.

alter table messages add column if not exists rfc822_message_id text;
alter table scheduled_messages add column if not exists reply_to_message_id text;

-- ClickUpTasks — enforce "at most one open Conversation task per contact" at
-- the DB level, closing the check-then-act race in upsertConversationTask
-- (src/app/api/ghl/webhook/route.ts): two near-simultaneous webhook
-- deliveries for the same contact could otherwise both pass the app-level
-- "any open task?" check and both insert. The app already treats a
-- duplicate-key error on this index as "the other request already created
-- it," same as the existing ghl_message_id dedup. Run once, after
-- priority-conversation-tier.sql.
create unique index if not exists tasks_one_open_conversation_per_contact
  on tasks (contact_id)
  where priority = 'conversation' and status != 'done';

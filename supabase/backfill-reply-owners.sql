-- ClickUpTasks: give every open, unowned reply task an owner.
--
-- Derek, 2026-09-22: reply tasks were missing from All Tasks. Both code paths
-- that create them used to leave them unowned, and All Tasks shows each person
-- their own work, so they were on nobody's list. The code now owns new ones
-- from the start; this gives the ones already made the same owner the code
-- would have: the client's first follower, else the longest standing admin
-- (resolveNotifyRecipient in src/lib/waitingNotify.ts, clients.assigned_to is
-- jsonb, so ->>0 is its first entry).
--
-- "Reply task" means priority 'conversation', which is what both creation paths
-- set. That catches the 22 titled "Reply to ..." and 4 others the same code made
-- with their own titles, such as "Claimed their listing, say hello ...".
--
-- Dry run on 2026-09-22 (26 tasks): 24 to Derek (21 with no follower on the
-- client, 3 where he is the follower), 2 to Justin (Jenny Yannessa and Lizeth
-- Robles, whom he follows). Jenny's reply is Justin's, so it shows under his
-- Mine, and under All, not under Derek's Mine.
--
-- updated_by null is what makes a task already open in someone's drawer pick
-- the change up live. Run once in the Supabase SQL editor.

update tasks t
set assignee_id = coalesce(
      (select cl.assigned_to->>0 from clients cl where cl.id = t.client_id),
      (select member_id from profiles where role = 'admin' and member_id is not null order by created_at asc limit 1)
    ),
    updated_by = null
where t.deleted_at is null
  and t.status <> 'done'
  and t.assignee_id is null
  and t.priority = 'conversation'
returning t.id, t.title, t.assignee_id;

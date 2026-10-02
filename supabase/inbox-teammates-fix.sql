-- ClickUpTasks: teammates are never the contact (Derek, 2026-10-02). Run once.
-- GoHighLevel keeps the team as contacts, so the Gmail poll filed a
-- teammate's email as mail from a client called Justin (or Derek).

-- 1. A teammate's email to someone outside the team: their reply, to that person.
update messages m set
  direction = 'outbound',
  created_by = (select p.member_id from profiles p where lower(p.email) = lower(m.peer_address) limit 1),
  contact_id = null, client_id = null, peer_name = null, read = true,
  peer_address = (select c from jsonb_array_elements_text(coalesce(m.cc, '[]'::jsonb)) c where c not ilike '%@clickuplocal.com' limit 1)
where m.mailbox_member_id is not null and m.direction = 'inbound' and m.channel = 'email'
  and lower(m.peer_address) in (select lower(email) from profiles where email ilike '%@clickuplocal.com')
  and exists (select 1 from jsonb_array_elements_text(coalesce(m.cc, '[]'::jsonb)) c where c not ilike '%@clickuplocal.com');

-- 2. Email only between teammates: kept in the Inbox, off the clients made for them.
update messages m set contact_id = null, client_id = null
where m.mailbox_member_id is not null and m.direction = 'inbound' and m.channel = 'email'
  and lower(m.peer_address) in (select lower(email) from profiles where email ilike '%@clickuplocal.com')
  and m.contact_id is not null;

-- 3. Wendy's client is the company: Whitman Land Group.
update clients set name = 'Whitman Land Group' where id = 'cl_ct_ghl_0Tf5Yj9YULohCV9yZnGy';

-- Read back: each should say true.
select 'no teammate email on a client' as check, not exists (
  select 1 from messages m where m.mailbox_member_id is not null and m.direction = 'inbound' and m.channel = 'email'
    and lower(m.peer_address) in (select lower(email) from profiles where email ilike '%@clickuplocal.com') and m.contact_id is not null) as ok
union all select 'Justin''s reply to Russell is his', exists (
  select 1 from messages where direction = 'outbound' and peer_address = 'russell@whitmanlandgroup.com' and mailbox_member_id = 'u_derek')
union all select 'Whitman Land Group named', exists (select 1 from clients where id = 'cl_ct_ghl_0Tf5Yj9YULohCV9yZnGy' and name = 'Whitman Land Group');

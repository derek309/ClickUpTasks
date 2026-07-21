-- ClickUpTasks — Merge two duplicate clients into one, atomically.
-- Run once, after all other client migrations (needs is_admin() from rls.sql).
--
-- Why this exists: the same real business can be a contact in more than one
-- GHL sub-account (the agency account AND the directory account), and if each
-- gets promoted to a tracked client you end up with two client records for one
-- entity. This lets an admin fold one into the other without losing anything.

-- A survivor client can "own" the routing of more than one contact (its own,
-- via the cl_<contactId> id convention, plus every contact absorbed by a
-- merge). linked_contact_id (singular) already existed for a manual GHL link;
-- this array generalizes it so an N-way merge routes every absorbed contact's
-- future inbound to the survivor. Also doubles as the "this client lives in
-- both accounts" marker for the UI.
alter table clients add column if not exists linked_contact_ids jsonb not null default '[]'::jsonb;

-- Atomic client merge. Admin-only (checked explicitly since this is
-- security definer). Repoints every table that hangs off the source client,
-- absorbs its contact-routing identity, then deletes the source — all in one
-- transaction so a mid-way failure can't half-move the data (which the FK
-- cascades would otherwise finish destroying on the delete).
create or replace function public.merge_clients(source_id text, target_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  src_contact text;
begin
  if not is_admin() then raise exception 'merge_clients: admin only'; end if;
  if source_id = target_id then raise exception 'merge_clients: source and target are the same'; end if;
  if not exists (select 1 from clients where id = source_id) then raise exception 'merge_clients: source not found'; end if;
  if not exists (select 1 from clients where id = target_id) then raise exception 'merge_clients: target not found'; end if;

  -- Repoint everything that references the source client. projects first so
  -- stages (which cascade off projects, not clients) travel with them.
  update projects      set client_id = target_id where client_id = source_id;
  update tasks         set client_id = target_id where client_id = source_id;
  update messages      set client_id = target_id where client_id = source_id;
  update client_links  set client_id = target_id where client_id = source_id;
  update client_notes  set client_id = target_id where client_id = source_id;
  update folders       set client_id = target_id where client_id = source_id;
  update vault_folders set client_id = target_id where client_id = source_id;
  update notifications set client_id = target_id where client_id = source_id;
  -- contacts.client_id is intentionally NOT repointed: it points at the
  -- contact's GHL sub-account (c_agency / c_directory), not the tracked
  -- client, so moving it would detach the contact from its source account.
  -- Routing to the survivor is preserved via linked_contact_ids below.

  -- The source's own routing identity: the contact id embedded in its
  -- cl_<contactId> id, plus anything it had already absorbed. Fold all of it
  -- into the survivor so future inbound to those contacts resolves here.
  src_contact := case when source_id like 'cl\_%' then substring(source_id from 4) else null end;
  update clients t set linked_contact_ids = (
    select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
    from (
      select jsonb_array_elements_text(t.linked_contact_ids) as v
      union select jsonb_array_elements_text(s.linked_contact_ids) from clients s where s.id = source_id
      union select s.linked_contact_id from clients s where s.id = source_id and s.linked_contact_id is not null
      union select src_contact where src_contact is not null
    ) x where v is not null and v <> ''
  )
  where t.id = target_id;

  delete from clients where id = source_id;
end;
$$;
revoke execute on function public.merge_clients(text, text) from public;
grant execute on function public.merge_clients(text, text) to authenticated;

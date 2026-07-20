-- ClickUpTasks — a territory (city) can have one OR MORE ambassadors.
-- Replaces the single member_id with an assigned_to array. Run once.
alter table territories add column if not exists assigned_to jsonb not null default '[]';

-- Carry the existing single assignment into the array.
update territories
  set assigned_to = to_jsonb(array[member_id])
  where member_id is not null and (assigned_to is null or assigned_to = '[]'::jsonb);

-- RLS: a teammate sees a territory if they're one of its ambassadors.
drop policy if exists territories_select on territories;
create policy territories_select on territories for select to authenticated using (
  is_admin() or assigned_to ? my_member_id()
);

-- ClickUpTasks — Fix: profiles.member_id was only ever set for the founder
-- (derek@clickuplocal.com) at signup — every other invited teammate got
-- member_id = null permanently, and nothing else in the app ever filled it
-- in. That silently breaks every RLS policy keyed on
-- assignee_id/recipient_id = my_member_id() for that person's own session
-- (rls.sql, private-tasks.sql, task-delegation.sql, client-assignment.sql,
-- messages.sql, vault-folders.sql, client-links-notes.sql, notifications) —
-- a task assigned to a non-founder teammate is invisible to their own
-- login, admin-only visible, since `my_member_id()` returns null and
-- `assignee_id = null` never matches in SQL. Run once, after auth.sql.
--
-- Backfills the missing ids with each profile's own Supabase auth id (the
-- same value Cockpit.tsx's live-roster fetch already falls back to for
-- *display* purposes — tasks.assignee_id for these teammates already
-- stores this uuid, so this backfill is what finally makes my_member_id()
-- actually match it), and fixes the signup trigger so this doesn't recur
-- for future invites.

update profiles set member_id = id::text where member_id is null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role, member_id, color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', initcap(split_part(new.email, '@', 1))),
    case when lower(new.email) = 'derek@clickuplocal.com' then 'admin' else 'va' end,
    case when lower(new.email) = 'derek@clickuplocal.com' then 'u_derek' else new.id::text end,
    '#a855f7'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

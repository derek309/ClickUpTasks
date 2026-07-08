-- ClickUpTasks — Phase 1b: auth profiles + roles
-- Run this once in the Supabase SQL editor (after schema.sql).

-- One row per logged-in user. role drives what they can see.
-- member_id links an auth account to a roster member (e.g. 'u_derek') so
-- existing assigned tasks tie to the right person.
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  role text default 'va',
  member_id text,
  color text default '#a855f7',
  created_at timestamptz default now()
);

-- Auto-create a profile whenever someone signs up. Derek's email is the admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role, member_id, color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', initcap(split_part(new.email, '@', 1))),
    case when lower(new.email) = 'derek@clickuplocal.com' then 'admin' else 'va' end,
    case when lower(new.email) = 'derek@clickuplocal.com' then 'u_derek' else null end,
    '#a855f7'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles are readable by any signed-in user (the team roster); self-editable.
alter table profiles enable row level security;
drop policy if exists "profiles readable by authenticated" on profiles;
create policy "profiles readable by authenticated" on profiles for select to authenticated using (true);
drop policy if exists "profiles self update" on profiles;
create policy "profiles self update" on profiles for update to authenticated using (auth.uid() = id);

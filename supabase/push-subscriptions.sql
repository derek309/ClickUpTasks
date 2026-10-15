-- ClickUpTasks: phone notifications (Derek, 2026-10-15). One row per phone or
-- browser a person turned notifications on for (Settings, Notifications).
-- Run once, after auth.sql (needs profiles). Nothing pushes until the VAPID
-- keys are set in Vercel as well (see src/lib/push.ts).
--
-- The app writes and reads this through the service role after checking the
-- session (/api/push/subscribe, lib/push.ts), as api_tokens does; the
-- policies below are the second wall: a person sees, adds and removes only
-- their own phones. No update policy: refreshing a phone is the server's
-- upsert. (Nothing here touches profiles' policies.)

create table if not exists push_subscriptions (
  id text primary key default ('ps_' || replace(gen_random_uuid()::text, '-', '')),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on push_subscriptions;
create policy push_subscriptions_select on push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_insert on push_subscriptions;
create policy push_subscriptions_insert on push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on push_subscriptions;
create policy push_subscriptions_delete on push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

select 'push_subscriptions' as check, exists (select 1 from information_schema.tables where table_name = 'push_subscriptions') as ok;

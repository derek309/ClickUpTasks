-- ClickUpTasks — rate limiting for the public /api/waiting/[token]/* routes.
-- Those routes have no auth beyond the token itself (a 122-bit random value
-- gates access, but nothing stops a scripted loop from hammering
-- request/upload once it has one). A small Postgres upsert-counter, keyed
-- on token+ip+10-minute-bucket, is enough to cap that without adding Redis.
-- Run once.

create table if not exists waiting_rate_limit (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);

-- No policies defined below — RLS enabled with zero grants means only the
-- service-role client (which bypasses RLS entirely) can touch this table,
-- same lockdown as any other service-role-only internal table.
alter table waiting_rate_limit enable row level security;

-- Atomic increment-and-return, so concurrent requests from the same
-- token+ip in the same window can't race past the limit. Also sweeps rows
-- older than an hour on each call — windows are 10 minutes, so anything
-- older is stale — rather than running a separate cron job for a handful
-- of rows.
create or replace function public.increment_rate_limit(p_key text)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  delete from waiting_rate_limit where window_start < now() - interval '1 hour';
  insert into waiting_rate_limit (key, count, window_start) values (p_key, 1, now())
  on conflict (key) do update set count = waiting_rate_limit.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

revoke all on function public.increment_rate_limit(text) from public;
grant execute on function public.increment_rate_limit(text) to service_role;

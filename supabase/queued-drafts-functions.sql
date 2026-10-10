-- One draft at a time in inbox_prefs.prefs.queuedDrafts (audit 2026-10-10).
-- The browser and the MCP (a Claude chat) both wrote the whole list back, so
-- a tab that hadn't seen Claude's new draft could erase it on its next save,
-- or put back a draft Claude had just replaced. These add or remove one draft
-- inside a locked row.
--
-- Security invoker: the browser can only touch its own row (inbox_prefs RLS);
-- the server's service role can touch any. The code falls back to the old
-- way while these are missing, so run this before or after the deploy.
-- Safe to run more than once. Supabase SQL editor, project fiuikmynexwdewnazuab.

-- Removes one draft; returns it (or null when it wasn't there).
create or replace function public.queued_draft_remove(member text, draft_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare cur jsonb; gone jsonb;
begin
  select coalesce(prefs->'queuedDrafts', '[]'::jsonb) into cur from inbox_prefs where member_id = member for update;
  if cur is null then return null; end if;
  select d into gone from jsonb_array_elements(cur) d where d->>'id' = draft_id limit 1;
  if gone is null then return null; end if;
  update inbox_prefs
     set prefs = jsonb_set(coalesce(prefs, '{}'::jsonb), '{queuedDrafts}',
           (select coalesce(jsonb_agg(d), '[]'::jsonb) from jsonb_array_elements(cur) d where d->>'id' <> draft_id)),
         updated_at = now()
   where member_id = member;
  return gone;
end;
$$;

-- Adds one draft. Replaces the draft with the same id, the one named by
-- replace_id, and Claude's earlier reply to the same conversation. Returns
-- the drafts it replaced (so their Gmail copies can go too).
create or replace function public.queued_draft_put(member text, draft jsonb, replace_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare cur jsonb; gone jsonb;
begin
  insert into inbox_prefs (member_id, prefs, updated_at) values (member, '{}'::jsonb, now()) on conflict (member_id) do nothing;
  select coalesce(prefs->'queuedDrafts', '[]'::jsonb) into cur from inbox_prefs where member_id = member for update;
  select coalesce(jsonb_agg(d), '[]'::jsonb) into gone from jsonb_array_elements(cur) d
   where d->>'id' = draft->>'id'
      or (replace_id is not null and d->>'id' = replace_id)
      or (draft->>'threadKey' is not null and d->>'threadKey' = draft->>'threadKey' and coalesce(d->>'by', 'Claude') = 'Claude');
  update inbox_prefs
     set prefs = jsonb_set(coalesce(prefs, '{}'::jsonb), '{queuedDrafts}',
           (select coalesce(jsonb_agg(d), '[]'::jsonb) from jsonb_array_elements(cur) d
             where not exists (select 1 from jsonb_array_elements(gone) g where g->>'id' = d->>'id')) || jsonb_build_array(draft)),
         updated_at = now()
   where member_id = member;
  return gone;
end;
$$;

-- Read back: two rows, queued_draft_put and queued_draft_remove.
select proname from pg_proc where proname in ('queued_draft_put', 'queued_draft_remove') order by 1;

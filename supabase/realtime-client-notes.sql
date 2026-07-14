-- ClickUpTasks — add client_notes (the Knowledge chat) to the realtime
-- publication, so a message posted in one tab appears live in another
-- instead of waiting for the 20s visibility-refetch fallback.
-- Run once in the Supabase SQL editor, after realtime.sql.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='client_notes') then
    alter publication supabase_realtime add table public.client_notes;
  end if;
end $$;

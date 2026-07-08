-- Client status (active / paused / archived), shown as the sidebar dot.
-- Run once in the Supabase SQL editor.
alter table clients add column if not exists status text not null default 'active';

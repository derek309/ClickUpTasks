-- Client portal switches on by default (Derek, 2026-10-05): "Client can add
-- requests" and "Client sees all tasks". New clients, wherever they are made,
-- start with both on.
alter table clients alter column can_request_new_tasks set default true;
alter table clients alter column portal_shows_all_tasks set default true;

-- Every current client too.
update clients set can_request_new_tasks = true, portal_shows_all_tasks = true
where deleted_at is null and (can_request_new_tasks is not true or portal_shows_all_tasks is not true);

-- Read back: both defaults true, and 0 clients left with either off.
select
  (select column_default from information_schema.columns where table_name = 'clients' and column_name = 'can_request_new_tasks') as requests_default,
  (select column_default from information_schema.columns where table_name = 'clients' and column_name = 'portal_shows_all_tasks') as all_tasks_default,
  (select count(*) from clients where deleted_at is null and (can_request_new_tasks is not true or portal_shows_all_tasks is not true)) as still_off;

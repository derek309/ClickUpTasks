-- Hidden from the client (Derek, 2026-10-12: "hide tasks from client", "make
-- the list show or private to client portal", "and also do it by tasks").
-- A task, or a whole list, the client never sees in their portal or reminder
-- emails; the team sees it as usual. Run before deploying the app code that
-- filters on it.
alter table tasks add column if not exists hidden_from_client boolean not null default false;
alter table projects add column if not exists hidden_from_client boolean not null default false;

-- A task made in, or moved into, a hidden list is hidden too, however it was
-- made (the app, Claude, a client request, the Inbox).
create or replace function tasks_inherit_hidden_from_client() returns trigger language plpgsql as $$
begin
  if new.project_id is not null and exists (select 1 from projects p where p.id = new.project_id and p.hidden_from_client) then
    new.hidden_from_client := true;
  end if;
  return new;
end $$;
drop trigger if exists tasks_inherit_hidden_from_client on tasks;
create trigger tasks_inherit_hidden_from_client before insert or update of project_id on tasks
  for each row execute function tasks_inherit_hidden_from_client();

-- Hiding or showing a list does the same to every task in it.
create or replace function projects_hide_tasks_from_client() returns trigger language plpgsql as $$
begin
  if new.hidden_from_client is distinct from old.hidden_from_client then
    update tasks set hidden_from_client = new.hidden_from_client where project_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists projects_hide_tasks_from_client on projects;
create trigger projects_hide_tasks_from_client after update of hidden_from_client on projects
  for each row execute function projects_hide_tasks_from_client();

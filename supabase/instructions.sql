-- Instructions for lists and tasks (Derek, 2026-09-15): the rules for how the
-- work is done. A list's instructions apply to every task in it; a task can add
-- its own. Team and Claude only: never selected by the client portal or the
-- review pages, and handed to Claude by the MCP get_task tool.
--
-- Run 2026-09-15 in the ClickUpTasks project (fiuikmynexwdewnazuab) and read
-- back: both columns present. Existing row security on tasks and projects
-- already keeps them to the team; private tasks stay private.

alter table tasks add column if not exists instructions text not null default '';
alter table projects add column if not exists instructions text not null default '';

select table_name, column_name from information_schema.columns where column_name = 'instructions' order by table_name;

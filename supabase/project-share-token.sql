-- ClickUpTasks — project (list) share links: a public, no-login page
-- (/waiting/[token]) scoped to ONE project, with no way to reach any other
-- project or task for that client. The existing client-share-token.sql link
-- (?project=<id> on it) is only a starting view, not a boundary — the public
-- page still fetches and can navigate to every project/task for that client,
-- which is wrong for "send this one list to an outside reviewer." A project
-- token is matched first by /api/waiting/[token]/*, and when it resolves,
-- every query in that request is additionally scoped to that project_id, so
-- there is nothing else in the response for the client to navigate to — the
-- isolation is server-side data scoping, not hidden UI.
-- Token stored retrievably, not hashed — same reasoning as client-share-token.sql
-- (a share link, not a login credential). Run once, after client-share-token.sql.

alter table projects add column if not exists share_token text unique;
create index if not exists projects_share_token_idx on projects(share_token) where share_token is not null;

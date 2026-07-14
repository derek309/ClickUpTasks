# ClickUpTasks MCP server

Lets Claude Code read and complete your real ClickUpTasks tasks (the same
Supabase DB the web app uses), so you can work them from your terminal.

## Tools

- `list_queue` — tasks you hand-picked in the app with the "Queue for Claude" star; start here for "work my queue"
- `list_my_tasks` — your open/assigned (and delegated-to-you) tasks; filter by client, status, priority
- `get_task(id)` — full detail: description, checklist, links, client/list context
- `set_task_status(id, status)` — todo | in_progress | review | done
- `add_comment(id, text)` — log progress back onto the task
- `check_item(id, item)` — tick a checklist item by title
- `list_clients` — all clients + ids
- `list_projects(client?)` — projects (lists) + their client, for scoping list_notes/add_note
- `list_notes(client_id, project_id?)` — read the Knowledge chat feed (meeting notes, decisions, FYIs — not task comments)
- `add_note(client_id, project_id?, type?, body)` — post into that chat feed, logged as you

## Install

```bash
cd mcp && npm install
```

Then register it with Claude Code (values from the app's `.env.local`):

```bash
claude mcp add clickuptasks -s user \
  -e CLICKUPTASKS_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  -e CLICKUPTASKS_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  -e CLICKUPTASKS_MEMBER_ID=u_derek \
  -- node "$PWD/server.mjs"
```

`CLICKUPTASKS_KEY` is the Supabase **service-role** key — full DB access, stored
only in your local Claude Code config. Use scoped per-user auth instead if VAs
ever run this.

## Use

In any Claude Code session:

> "Pull my urgent tasks from ClickUpTasks."
> "Start the Monthly Newsletter task, then mark it done when I'm finished."
> "What's on the AC Services Elite list?"

## Notes

- Status changes write to the app DB and show up live via realtime. GHL two-way
  push on status change happens from the web app, not this server (a later add).

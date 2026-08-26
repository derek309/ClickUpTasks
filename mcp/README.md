# ClickUpTasks MCP server

Lets Claude read and complete your real ClickUpTasks tasks (the same
Supabase DB the web app uses) — from Claude Code (terminal) or from Claude
Chat (claude.ai / desktop app), via two different transports sharing the
same tool definitions (`core.mjs`):

- `server.mjs` — stdio, for Claude Code. Runs as a local process Claude Code
  spawns directly.
- `../src/app/api/mcp/route.ts` — Streamable HTTP, deployed with the web app.
  This is what Claude Chat connects to — it can't spawn a local process, so
  it needs a real URL. Protected by `MCP_CONNECTOR_SECRET`, a bearer token
  distinct from the Supabase service-role key (which never leaves the server).

## Tools

`list_my_tasks`, `list_client_tasks`, `get_task`, `create_task`, `update_task`,
`delete_task`, `set_task_status`, `add_comment`, `draft_email`, `check_item`,
`add_checklist_items`, `list_members`, `list_clients`, `list_projects`,
`list_notes`, `add_note`, `list_links`, `get_client_overview` — see each
tool's own description in `core.mjs` for its exact arguments.

## Install — Claude Code

```bash
cd mcp && npm install
```

Then register it (values from the app's `.env.local`):

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

## Install — Claude Chat (claude.ai connector)

The HTTP endpoint reuses the web app's own `NEXT_PUBLIC_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` env vars (already set on Vercel) plus one more:

- `MCP_CONNECTOR_SECRET` — a random token; claude.ai sends it as
  `Authorization: Bearer <token>`. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  set it on Vercel, redeploy.
- `CLICKUPTASKS_MEMBER_ID` (optional) — identity actions are logged as;
  defaults to `u_claude` if unset.

In claude.ai: Settings → Connectors → Add custom connector → URL
`https://<your-domain>/api/mcp`, paste the same token as the bearer/API key.

## Use

In any Claude Code session, or in Claude Chat once connected:

> "Pull my urgent tasks from ClickUpTasks."
> "Start the Monthly Newsletter task, then mark it done when I'm finished."
> "What's on the AC Services Elite list?"

## Notes

- Status changes write to the app DB and show up live via realtime. GHL two-way
  push on status change happens from the web app, not this server (a later add).
- Both transports share one shared identity per deployment (`CLICKUPTASKS_MEMBER_ID`)
  — not per-person auth. Fine for a small team; revisit if that ever matters.

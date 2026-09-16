# ClickUpTasks MCP server

Lets Claude read and work your real ClickUpTasks tasks (the same Supabase DB
the web app uses), from Claude Code or from Claude Chat (claude.ai / desktop
app). The tool definitions live in `core.mjs`, shared by two transports:

- `../src/app/api/mcp/route.ts` (and `[token]/route.ts`), Streamable HTTP,
  deployed with the web app. **Use this one, from Claude Code and claude.ai.**
  Only it has the review tools, because they run the app's own review code
  (`src/lib/mcpReviewServices.ts`). Protected by `MCP_CONNECTOR_SECRET`, a
  bearer token distinct from the Supabase service-role key (which never leaves
  the server).
- `server.mjs`, stdio. The older local server: task tools only, and it needs
  the service-role key on your computer. Kept for now; prefer the hosted one.

## Tools

Tasks: `list_my_tasks`, `list_client_tasks`, `get_task`, `create_task`,
`update_task`, `delete_task`, `set_task_status`, `add_comment`, `draft_email`,
`check_item`, `add_checklist_items`, `list_members`, `list_clients`,
`list_projects`, `list_notes`, `add_note`, `list_links`, `get_client_link`,
`get_client_overview`.

Reviews (hosted only), for a task's client document (kind `doc`), image review
(`image`) and HTML review (`page`): `list_reviews`, `get_review`,
`create_review`, `update_review`, `write_document`, `start_image_upload`,
`add_review_version`, `use_version`, `remove_version`, `send_for_review`,
`get_review_link`, `revoke_review_link`, `add_review_comment`,
`update_review_comment`, `delete_review_comment`, `delete_review`,
`restore_review`. `get_client_document` and `write_client_document` still work
as the older names for the document. See each tool's own description in
`core.mjs` for its exact arguments. An image review version can hold up to 10
images shown stacked, like a postcard's front and back (Derek, 2026-09-14):
`add_review_version` takes `images` (with `keep_others` to replace just one),
`update_review` takes `image_labels`, and a comment's `pin` takes `image`.
An HTML review version can hold up to 10 pages the same way, like two emails
for one campaign (Derek, 2026-09-16): `add_review_version` takes `pages`, each
with its own `html` and `label`, and `image_labels` and `pin.image` work for pages too.

What Claude may and may not do (Derek, 2026-09-13):

- Claude may send a review, which turns on the client's private link and moves
  the task to Waiting.
- Email is only ever a draft: `send_for_review` and `draft_email` save the
  task's draft email, and a person reads it and clicks Send. A draft already
  waiting is left alone unless `draft_email` is called with `replace`.
- Claude's comments on a review show on the client's review page but never
  email the client.

## Install — Claude Code (hosted)

```bash
claude mcp add --transport http clickuptasks https://clickuptasks.vercel.app/api/mcp --header "Authorization: Bearer <MCP_CONNECTOR_SECRET>"
```

Remove an older local registration first (`claude mcp remove clickuptasks`),
since both use the name `clickuptasks`.

## Install — Claude Chat (claude.ai connector)

The HTTP endpoint reuses the web app's own `NEXT_PUBLIC_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` env vars (already set on Vercel) plus:

- `MCP_CONNECTOR_SECRET`: a random token. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  set it on Vercel, redeploy.
- `CLICKUPTASKS_MEMBER_ID` (optional): the member id actions are logged as;
  defaults to `u_claude`.
- `APP_URL` (optional): the app's address for review links; defaults to
  `https://clickuptasks.vercel.app`.

claude.ai strips query strings from a connector URL, so put the secret in the
path: Settings → Connectors → Add custom connector → URL
`https://clickuptasks.vercel.app/api/mcp/<MCP_CONNECTOR_SECRET>`.

## Use

In any Claude Code session, or in Claude Chat once connected:

> "Pull my urgent tasks from ClickUpTasks."
> "Put this image up for review on the Fall flyer task and send it to the client."
> "Answer the client's comments on the Lincoln Weekly HTML review."

## Notes

- Changes write to the app DB and show up live in the app.
- Every connection acts as one shared identity (`CLICKUPTASKS_MEMBER_ID`), not
  per person. Fine for a small team; revisit if that ever matters.

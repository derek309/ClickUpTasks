#!/usr/bin/env node
// ClickUpTasks MCP server — lets Claude Code read and complete your real
// tasks (the same Supabase DB the web app uses). stdio transport; tool
// definitions live in core.mjs, shared with the HTTP transport used by
// claude.ai connectors (src/app/api/mcp/route.ts).
//
// Env required:
//   CLICKUPTASKS_URL       = your Supabase project URL (NEXT_PUBLIC_SUPABASE_URL)
//   CLICKUPTASKS_KEY       = Supabase service-role key (SUPABASE_SERVICE_ROLE_KEY)
//   CLICKUPTASKS_MEMBER_ID = your roster member id for "my tasks" (default u_derek)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./core.mjs";

if (!process.env.CLICKUPTASKS_URL || !process.env.CLICKUPTASKS_KEY) {
  console.error("Set CLICKUPTASKS_URL and CLICKUPTASKS_KEY");
  process.exit(1);
}
const server = createServer();
await server.connect(new StdioServerTransport());

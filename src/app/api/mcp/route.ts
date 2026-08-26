// ClickUpTasks MCP server over Streamable HTTP — the claude.ai-connector and
// cloud-routine counterpart to mcp/server.mjs (stdio, for Claude Code). Same
// tool definitions (mcp/core.mjs), reused as-is rather than duplicated.
//
// This entry point authenticates via an Authorization header or ?token=.
// claude.ai strips query strings from connector URLs, so connectors use the
// path-secret form instead — see [token]/route.ts and handler.ts.
import { NextRequest } from "next/server";
import { handleMcp } from "./handler";

export const maxDuration = 60;

export async function GET(req: NextRequest) { return handleMcp(req); }
export async function POST(req: NextRequest) { return handleMcp(req); }
export async function DELETE(req: NextRequest) { return handleMcp(req); }

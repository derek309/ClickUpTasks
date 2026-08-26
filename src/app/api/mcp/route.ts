// ClickUpTasks MCP server over Streamable HTTP — the claude.ai-connector
// counterpart to mcp/server.mjs (stdio, for Claude Code). Same tool
// definitions (mcp/core.mjs), reused as-is rather than duplicated.
//
// Stateless: a fresh McpServer + transport per request. Simpler than session
// tracking, and correct for a Vercel serverless function — there's no
// guarantee two requests in the same "session" land on the same instance.
//
// Auth: checked against MCP_CONNECTOR_SECRET. This is NOT the Supabase
// service-role key; that stays server-side (env), never sent to claude.ai.
// Acts as a single shared identity (CLICKUPTASKS_MEMBER_ID, defaulting to
// "u_claude") — not per-person auth, same as the stdio server.
//
// claude.ai's "Add custom connector" dialog only offers a URL field plus
// optional OAuth Client ID/Secret — no plain bearer-token/API-key field, so
// there's nowhere to paste an Authorization header. Accepting the token as
// a ?token= query param on the URL itself is the standard workaround (still
// checks a real Authorization header first, for the stdio-style callers
// that can send one). The tradeoff: a URL query string can end up in access
// logs — acceptable here (single internal team, high-entropy, revocable),
// not something to reuse for anything more sensitive.
import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "../../../../mcp/core.mjs";

export const maxDuration = 60;

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
}

async function handle(req: NextRequest): Promise<Response> {
  const secret = process.env.MCP_CONNECTOR_SECRET;
  if (!secret) return new Response(JSON.stringify({ error: "MCP_CONNECTOR_SECRET not configured." }), { status: 501, headers: { "Content-Type": "application/json" } });
  const authHeader = req.headers.get("authorization") ?? "";
  const queryToken = req.nextUrl.searchParams.get("token") ?? "";
  if (authHeader !== `Bearer ${secret}` && queryToken !== secret) return unauthorized();

  const server = createServer({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    memberId: process.env.CLICKUPTASKS_MEMBER_ID || "u_claude",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
export async function DELETE(req: NextRequest) { return handle(req); }

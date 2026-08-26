// Shared request handler for both MCP entry points:
//   /api/mcp            (Authorization header, or ?token=)  — route.ts
//   /api/mcp/<secret>   (secret in the path)                — [token]/route.ts
//
// Why two: claude.ai's "Add custom connector" dialog only takes a URL (plus
// optional OAuth client id/secret), and it STRIPS the query string when it
// stores the connector — a ?token= URL comes back as the bare /api/mcp, so
// every call then arrives unauthenticated and 401s. Putting the secret in
// the path survives that, which is what makes claude.ai connectors and
// cloud routines work at all. The header/query form stays for callers that
// can set headers.
//
// Tradeoff, same for both: a secret in a URL can land in access logs.
// Acceptable here (one internal team, 256 bits of entropy, revocable by
// rotating MCP_CONNECTOR_SECRET) — not a pattern to reuse for anything
// more sensitive.
//
// Stateless: a fresh McpServer + transport per request. Simpler than session
// tracking, and correct for a Vercel serverless function — there's no
// guarantee two requests in the same "session" land on the same instance.
//
// The Supabase service-role key is NEVER any part of this: it stays in the
// server env and is only ever used server-side by createServer.
import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "../../../../mcp/core.mjs";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** @param pathToken secret taken from the URL path, when this is the /api/mcp/<secret> route. */
export async function handleMcp(req: NextRequest, pathToken?: string): Promise<Response> {
  const secret = process.env.MCP_CONNECTOR_SECRET;
  if (!secret) return json({ error: "MCP_CONNECTOR_SECRET not configured." }, 501);

  const authHeader = req.headers.get("authorization") ?? "";
  const queryToken = req.nextUrl.searchParams.get("token") ?? "";
  const ok = authHeader === `Bearer ${secret}` || queryToken === secret || pathToken === secret;
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const server = createServer({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    memberId: process.env.CLICKUPTASKS_MEMBER_ID || "u_claude",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req);
}

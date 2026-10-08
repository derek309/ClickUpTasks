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
import { createReviewServices } from "@/lib/mcpReviewServices";
import { createCalendarServices } from "@/lib/mcpCalendarServices";
import { sameSecret } from "@/lib/sameSecret";
import { memberForClaudeToken } from "@/lib/claudeCodeAccess";
import { visibleClientIds } from "@/lib/extensionApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AuthedUser } from "@/lib/serverAuth";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** @param pathToken secret taken from the URL path, when this is the /api/mcp/<secret> route. */
export async function handleMcp(req: NextRequest, pathToken?: string): Promise<Response> {
  const secret = process.env.MCP_CONNECTOR_SECRET;
  if (!secret) return json({ error: "MCP_CONNECTOR_SECRET not configured." }, 501);

  const authHeader = req.headers.get("authorization") ?? "";
  const queryToken = req.nextUrl.searchParams.get("token") ?? "";
  const ok = sameSecret(authHeader, `Bearer ${secret}`) || sameSecret(queryToken, secret) || sameSecret(pathToken ?? "", secret);
  // A teammate's own Claude Code token (Settings, Team switch): acts as them.
  // In the header (Claude Code's command) or in the link (a Claude connector).
  const personal = ok ? null : (await memberForClaudeToken(authHeader.replace(/^Bearer\s+/i, "").trim())) ?? (pathToken ? await memberForClaudeToken(pathToken) : null);
  if (!ok && !personal) return json({ error: "Unauthorized" }, 401);

  // GET is where a client asks to be pushed messages over a long-lived SSE
  // stream. A stateless server has no session to push anything to, so the
  // transport just held the connection open until the 60s function limit —
  // 14,645 "Task timed out" errors in one week, each one a full 60s
  // invocation, all of it for a stream that was never going to carry
  // anything. The spec's answer for a server that doesn't offer the stream
  // is 405, which tells the client to stop asking. POST still carries every
  // request and its reply.
  if (req.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } });

  const memberId = personal || process.env.CLICKUPTASKS_MEMBER_ID || "u_claude";
  // A teammate's own token sees what they see in the app: their role, and the
  // clients visibleClientIds allows them (audit 2026-10-07).
  let role = "admin";
  let visibleClients: "all" | Set<string> = "all";
  if (personal) {
    const { data: prof } = await supabaseAdmin.from("profiles").select("role").eq("member_id", personal).maybeSingle();
    role = (prof?.role as string | undefined) ?? "va";
    visibleClients = await visibleClientIds({ role, memberId: personal } as unknown as AuthedUser);
  }
  const server = createServer({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    memberId, role, visibleClients,
    // The review tools run the app's own review code, so only this server has them.
    // Calendar tools (lib/mcpCalendarServices) ride on the same gate.
    services: { ...createReviewServices({ memberId }), ...createCalendarServices({ memberId }) },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req);
}

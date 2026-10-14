// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

// What the MCP endpoint answers, per method, for a valid link and a bad one.
// The Claude app's connector reads a failed first contact as "this server
// wants a sign in" and then fails with "Couldn't register with ClickUpTasks's
// sign-in service" (Justin, 2026-10-14), so a valid link must never get a 401,
// and the 2026-07-28 opening (server/discover with MCP-Protocol-Version:
// 2026-07-28) must succeed. The real tool server runs; the database and the
// token lookup are faked.

vi.mock("@/lib/mcpStepServices", () => ({ createStepServices: () => ({}) }));
vi.mock("@/lib/mcpReviewServices", () => ({ createReviewServices: () => ({}) }));
vi.mock("@/lib/mcpMailServices", () => ({ createMailServices: () => ({}) }));
vi.mock("@/lib/mcpCalendarServices", () => ({ createCalendarServices: () => ({}) }));
vi.mock("@/lib/claudeCodeAccess", () => ({ memberForClaudeToken: vi.fn(async (raw: string) => (raw === "cut_justin" ? "u_justin" : null)) }));
vi.mock("@/lib/extensionApi", () => ({ visibleClientIds: vi.fn(async () => new Set(["cl_1"])) }));
vi.mock("@/lib/supabaseAdmin", () => {
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: "va" } }) };
  return { supabaseAdmin: { from: () => q } };
});

const SECRET = "s".repeat(64);
process.env.MCP_CONNECTOR_SECRET = SECRET;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const { handleMcp } = await import("./handler");
const tokenRoute = await import("./[token]/route");

const BASE = "https://tasks.clickuplocal.com/api/mcp";
const ACCEPT = "application/json, text/event-stream";
const initialize = (protocolVersion = "2025-06-18") => ({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "test", version: "1" } } });
const discover = { jsonrpc: "2.0", id: "d-1", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } };
const toolsList = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

function call(token: string, method: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = method === "POST" ? { "Content-Type": "application/json", Accept: ACCEPT, ...opts.headers } : { ...opts.headers };
  const req = new NextRequest(`${BASE}/${token}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return handleMcp(req, token);
}

/** The JSON-RPC message in a reply, whether it came as JSON or as one SSE event. */
async function message(res: Response): Promise<any> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return line ? JSON.parse(line.slice(6)) : null;
  }
  return JSON.parse(text);
}

beforeEach(() => {
  // No tool here should reach the database; fail loudly if one tries.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in this test"); }));
});

describe.each([
  ["a teammate's own link", "cut_justin"],
  ["the shared connector secret", SECRET],
])("a valid link (%s)", (_name, token) => {
  it("POST initialize answers 200 with the server's instructions", async () => {
    const res = await call(token, "POST", { body: initialize() });
    expect(res.status).toBe(200);
    const msg = await message(res);
    expect(msg.result.serverInfo.name).toBe("clickuptasks");
    expect(msg.result.instructions).toBeTruthy();
  });

  it.each(["2025-03-26", "2025-06-18", "2025-11-25"])("initialize at %s answers 200", async (v) => {
    const res = await call(token, "POST", { body: initialize(v), headers: { "MCP-Protocol-Version": v } });
    expect(res.status).toBe(200);
    expect((await message(res)).result.protocolVersion).toBe(v);
  });

  it("server/discover stamped 2026-07-28 answers 200 with the versions we speak", async () => {
    const res = await call(token, "POST", { body: discover, headers: { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover" } });
    expect(res.status).toBe(200);
    const msg = await message(res);
    expect(msg.id).toBe("d-1");
    expect(msg.result.resultType).toBe("complete");
    expect(msg.result.supportedVersions).toContain("2025-11-25");
    expect(msg.result.supportedVersions).not.toContain("2026-07-28");
    expect(msg.result.capabilities.tools).toBeTruthy();
    expect(msg.result.instructions).toBeTruthy();
    expect(msg.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("clickuptasks");
  });

  it("server/discover with no version header answers 200 too", async () => {
    const res = await call(token, "POST", { body: discover });
    expect(res.status).toBe(200);
    expect((await message(res)).result.supportedVersions.length).toBeGreaterThan(0);
  });

  it("tools/list stamped 2026-07-28 is served, not refused with a 400", async () => {
    const res = await call(token, "POST", { body: toolsList, headers: { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" } });
    expect(res.status).toBe(200);
    const msg = await message(res);
    expect(msg.result.tools.map((t: any) => t.name)).toContain("list_my_tasks");
  });

  it("tools/list stamped 2025-06-18 answers 200", async () => {
    const res = await call(token, "POST", { body: toolsList, headers: { "MCP-Protocol-Version": "2025-06-18" } });
    expect(res.status).toBe(200);
    expect((await message(res)).result.tools.length).toBeGreaterThan(0);
  });

  it("notifications/initialized answers 202", async () => {
    const res = await call(token, "POST", { body: { jsonrpc: "2.0", method: "notifications/initialized" }, headers: { "MCP-Protocol-Version": "2025-06-18" } });
    expect(res.status).toBe(202);
  });

  it("GET answers 405 with Allow (no stream to offer), never 401", async () => {
    const res = await call(token, "GET", { headers: { Accept: "text/event-stream" } });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST, DELETE");
  });

  it("HEAD answers 405 like GET, never 401", async () => {
    const res = await call(token, "HEAD");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST, DELETE");
  });

  it("DELETE (end of session) answers 200", async () => {
    const res = await call(token, "DELETE");
    expect(res.status).toBe(200);
  });

  it("a POST that doesn't accept a stream gets 406 from the SDK, not 401", async () => {
    const res = await call(token, "POST", { body: initialize(), headers: { Accept: "application/json" } });
    expect(res.status).toBe(406);
  });
});

describe("a bad link is still turned away", () => {
  it.each(["GET", "HEAD", "DELETE"])("%s answers 401", async (method) => {
    expect((await call("cut_wrong", method)).status).toBe(401);
  });

  it("POST initialize answers 401", async () => {
    const res = await call("cut_wrong", "POST", { body: initialize() });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("server/discover answers 401 (it shows the instructions, so it is gated too)", async () => {
    const res = await call("not-a-token", "POST", { body: discover, headers: { "MCP-Protocol-Version": "2026-07-28" } });
    expect(res.status).toBe(401);
  });
});

describe("the /api/mcp/<token> route", () => {
  const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
  it("has a HEAD handler, so HEAD is answered by the handler and not by Next", async () => {
    const res = await tokenRoute.HEAD(new NextRequest(`${BASE}/cut_justin`, { method: "HEAD" }), ctx("cut_justin"));
    expect(res.status).toBe(405);
  });
  it("passes the path token through on POST", async () => {
    const req = new NextRequest(`${BASE}/cut_justin`, { method: "POST", headers: { "Content-Type": "application/json", Accept: ACCEPT, "MCP-Protocol-Version": "2026-07-28" }, body: JSON.stringify(discover) });
    expect((await tokenRoute.POST(req, ctx("cut_justin"))).status).toBe(200);
  });
});

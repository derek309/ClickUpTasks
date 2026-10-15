// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// This phone's notifications: save or refresh the subscription for the signed
// in person, remove it, and refuse anything that is not a real push service's.

const calls: { op: string; payload?: unknown; opts?: unknown; filters: [string, unknown][] }[] = [];
function table() {
  const call: { op: string; payload?: unknown; opts?: unknown; filters: [string, unknown][] } = { op: "", filters: [] };
  const b = {
    upsert: (payload: unknown, opts: unknown) => { call.op = "upsert"; call.payload = payload; call.opts = opts; calls.push(call); return b; },
    delete: () => { call.op = "delete"; calls.push(call); return b; },
    eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
    then: (resolve: (r: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return b;
}
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: () => table() }, adminConfigured: true }));

const caller = { id: "uuid-derek", memberId: "u_derek", email: "derek@example.com", role: "admin", canSendMessages: true };
let authed: typeof caller | null = caller;
vi.mock("@/lib/serverAuth", () => ({ requireUser: async () => authed }));
let configured = true;
vi.mock("@/lib/push", () => ({ pushConfigured: () => configured }));

const { POST, DELETE } = await import("./route");

const P256 = "B" + "A".repeat(86);
const AUTH = "a".repeat(22);
const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/push/subscribe", { method, headers: { authorization: "Bearer x", "content-type": "application/json", "user-agent": "iPhone Safari" }, body: JSON.stringify(body) });

beforeEach(() => { calls.length = 0; authed = caller; configured = true; });

describe("POST /api/push/subscribe", () => {
  it("saves this phone for the signed in person, keyed on its endpoint", async () => {
    const res = await POST(req("POST", { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: P256, auth: AUTH } }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("upsert");
    expect(calls[0].opts).toEqual({ onConflict: "endpoint" });
    expect(calls[0].payload).toMatchObject({ user_id: "uuid-derek", endpoint: "https://web.push.apple.com/abc", p256dh: P256, auth: AUTH, user_agent: "iPhone Safari" });
  });

  it("refuses an endpoint that is not a push service", async () => {
    const res = await POST(req("POST", { endpoint: "https://evil.example/hook", keys: { p256dh: P256, auth: AUTH } }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses missing keys", async () => {
    const res = await POST(req("POST", { endpoint: "https://web.push.apple.com/abc" }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses without a session", async () => {
    authed = null;
    expect((await POST(req("POST", { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: P256, auth: AUTH } }))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("says not set up while the keys are missing", async () => {
    configured = false;
    expect((await POST(req("POST", { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: P256, auth: AUTH } }))).status).toBe(501);
    expect(calls).toHaveLength(0);
  });
});

describe("DELETE /api/push/subscribe", () => {
  it("removes only the caller's own row for that endpoint", async () => {
    const res = await DELETE(req("DELETE", { endpoint: "https://web.push.apple.com/abc" }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ op: "delete", filters: [["endpoint", "https://web.push.apple.com/abc"], ["user_id", "uuid-derek"]] }]);
  });

  it("needs an endpoint and a session", async () => {
    expect((await DELETE(req("DELETE", {}))).status).toBe(400);
    authed = null;
    expect((await DELETE(req("DELETE", { endpoint: "https://web.push.apple.com/abc" }))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

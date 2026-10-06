// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The Brain Box plugin's "Your projects" link: the client's /waiting/ portal,
// for a token that can see that client, made the first time if missing.

vi.mock("@/lib/supabaseAdmin", async () => ({
  supabaseAdmin: (await import("@/test/fakeSupabase")).fakeSupabaseAdmin,
  adminConfigured: true,
}));
const caller = { id: "u_derek", memberId: "m_derek", email: "d@example.com", role: "admin", canSendMessages: true };
let authed: typeof caller | null = caller;
let visible = true;
vi.mock("@/lib/serverAuth", () => ({ requireApiToken: async () => authed }));
vi.mock("@/lib/extensionApi", () => ({ isClientVisible: async () => visible }));

const { resetTables, writes } = await import("@/test/fakeSupabase");
const { GET } = await import("./route");
const { APP_URL } = await import("@/lib/appUrl");

const ask = (clientId?: string) =>
  GET(new NextRequest(`http://localhost/api/extension/client-link${clientId !== undefined ? `?client_id=${clientId}` : ""}`, { headers: { authorization: "Bearer cut_x" } }));

beforeEach(() => {
  authed = caller;
  visible = true;
  resetTables({
    clients: [
      { id: "cl_pam", share_token: "abc123", deleted_at: null },
      { id: "cl_new", share_token: null, deleted_at: null },
      { id: "cl_gone", share_token: "zzz", deleted_at: "2026-09-10T12:00:00Z" },
    ],
  });
});

describe("GET /api/extension/client-link", () => {
  it("returns the client's portal link", async () => {
    const res = await ask("cl_pam");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `${APP_URL}/waiting/abc123` });
    expect(writes).toHaveLength(0);
  });

  it("makes the share link the first time, in the app's format", async () => {
    const res = await ask("cl_new");
    const { url } = await res.json();
    expect(url).toMatch(new RegExp(`^${APP_URL}/waiting/[0-9a-f]{32}$`));
    expect(writes).toEqual([{ table: "clients", op: "update", payload: { share_token: url.split("/waiting/")[1] } }]);
  });

  it("refuses without a token", async () => {
    authed = null;
    expect((await ask("cl_pam")).status).toBe(401);
  });

  it("refuses a client the token cannot see", async () => {
    visible = false;
    expect((await ask("cl_pam")).status).toBe(403);
  });

  it("refuses Personal, and never mints for it", async () => {
    expect((await ask("personal")).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("refuses a trashed client and a missing client id", async () => {
    expect((await ask("cl_gone")).status).toBe(404);
    expect((await ask()).status).toBe(400);
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The push for a notification a teammate's app just saved: read from the row,
// only for the person who made it, only while fresh, only for kinds worth one.

vi.mock("@/lib/supabaseAdmin", async () => ({
  supabaseAdmin: (await import("@/test/fakeSupabase")).fakeSupabaseAdmin,
  adminConfigured: true,
}));
const caller = { id: "uuid-justin", memberId: "u_justin", email: "j@example.com", role: "va", canSendMessages: true };
let authed: typeof caller | null = caller;
vi.mock("@/lib/serverAuth", () => ({ requireUser: async () => authed }));
const sent: { to: string[]; payload: unknown }[] = [];
vi.mock("@/lib/push", () => ({
  pushConfigured: () => true,
  sendPush: async (to: string[], payload: unknown) => { sent.push({ to, payload }); return 1; },
}));

const { resetTables } = await import("@/test/fakeSupabase");
const { POST } = await import("./route");

const ask = (id: string) => POST(new NextRequest("http://localhost/api/push/notify", { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify({ id }) }));
const now = new Date().toISOString();
const old = new Date(Date.now() - 60 * 60_000).toISOString();

beforeEach(() => {
  authed = caller;
  sent.length = 0;
  resetTables({
    notifications: [
      { id: "n_handoff", recipient_id: "u_derek", text: "Justin gave you a step on “Blog post”", task_id: "t_1", actor_id: "u_justin", client_id: "cl_pam", kind: "activity", created_at: now },
      { id: "n_move", recipient_id: "u_derek", text: "Justin moved “Blog post” to Review", task_id: "t_1", actor_id: "u_justin", client_id: "cl_pam", kind: "activity", created_at: now },
      { id: "n_old", recipient_id: "u_derek", text: "Justin mentioned you in “Blog post”", task_id: "t_1", actor_id: "u_justin", client_id: "cl_pam", kind: "message", created_at: old },
      { id: "n_other", recipient_id: "u_derek", text: "Michaella mentioned you in “Blog post”", task_id: "t_1", actor_id: "u_michaella", client_id: "cl_pam", kind: "message", created_at: now },
    ],
    clients: [{ id: "cl_pam", name: "Pam Macias" }],
  });
});

describe("POST /api/push/notify", () => {
  it("pushes a step handed over to the person it is for", async () => {
    const res = await ask("n_handoff");
    expect(await res.json()).toEqual({ ok: true, sent: 1 });
    expect(sent).toEqual([{ to: ["u_derek"], payload: { title: "Pam Macias", body: "Justin gave you a step on “Blog post”", url: "/?client=cl_pam&task=t_1", tag: "task:t_1" } }]);
  });

  it("does not push a status move", async () => {
    await ask("n_move");
    expect(sent).toHaveLength(0);
  });

  it("does not push someone else's notification or an old one", async () => {
    await ask("n_other");
    await ask("n_old");
    await ask("n_missing");
    expect(sent).toHaveLength(0);
  });

  it("refuses without a session", async () => {
    authed = null;
    expect((await ask("n_handoff")).status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});

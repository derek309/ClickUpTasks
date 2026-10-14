// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";
import { addBusinessDaysIso, pacificToday } from "../../mcp/queue.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// set_task_status on a queue list follows the app's rule (mcp/queue.mjs): the
// Now task done brings the next one up with a date. Supabase is faked; no
// database is touched.

const ME = "u_claude";
const now = { id: "t_now", title: "Video 1", status: "in_progress", priority: "normal", due: "2026-10-14", client_id: "c_1", project_id: "p_q", subtasks: [], comments: [], attachments: [], deleted_at: null, is_private: false, assignee_id: "u_derek", follow_up_at: null, created_at: "2026-10-01T00:00:00Z", queue_pos: 1000, deadline: false, queue_saved_due: null };
const next = { ...now, id: "t_next", title: "Video 2", status: "todo", due: null, queue_pos: 2000, queue_saved_due: "2026-10-14", created_at: "2026-10-02T00:00:00Z" };

let writes: { method: string; url: string; body: any }[] = [];
function fakeSupabase(opts: { queue: unknown; columns?: boolean }) {
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : null;
    if (method !== "GET") writes.push({ method, url: u, body });
    const path = decodeURIComponent(u.split("/rest/v1/")[1] ?? "");
    const ok = (rows: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) }) as any;
    if (opts.columns === false && (path.includes("queue") )) return { ok: false, status: 400, text: async () => "column does not exist" } as any;
    if (path.startsWith("projects?select=queue")) return ok([{ queue: opts.queue }]);
    if (path.startsWith("tasks?select=id,title,status") && path.includes("project_id=eq.p_q")) return ok([{ ...now, status: "done" }, next].filter((t) => t.status !== "done"));
    if (path.startsWith("tasks?") && method === "PATCH" && path.includes("id=eq.t_now")) return ok([{ ...now, ...body }]);
    if (path.startsWith("tasks?") && method === "PATCH") return ok([{ ...next, ...body }]);
    if (path.startsWith("tasks?")) return ok([now]);
    return ok([]);
  }));
}
async function connect() {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: ME });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  ((await client.callTool({ name, arguments: args })) as any).content[0].text as string;

afterEach(() => vi.unstubAllGlobals());

describe("set_task_status on a queue list", () => {
  it("done brings the next one up, due today plus the spacing", async () => {
    fakeSupabase({ queue: { now: 1, spacing: 3 } });
    const text = await call(await connect(), "set_task_status", { id: "t_now", status: "done" });
    const due = addBusinessDaysIso(pacificToday(), 3);
    expect(writes).toContainEqual(expect.objectContaining({ method: "PATCH", url: expect.stringContaining("id=eq.t_next"), body: { due, queue_saved_due: null, updated_by: null } }));
    expect(text).toContain(`Next in the queue: t_next (due ${due})`);
  });
  it("a list without a queue: nothing else is written", async () => {
    fakeSupabase({ queue: null });
    await call(await connect(), "set_task_status", { id: "t_now", status: "done" });
    expect(writes.filter((w) => w.url.includes("t_next"))).toEqual([]);
  });
  it("a database without the queue columns: the status is still set", async () => {
    fakeSupabase({ queue: null, columns: false });
    const text = await call(await connect(), "set_task_status", { id: "t_now", status: "done" });
    expect(text).toMatch(/^Set t_now → done\./);
    expect(writes.filter((w) => w.url.includes("t_next"))).toEqual([]);
  });
});

// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// create_task and update_task description (Derek, 2026-10-14): a task has no
// description; what it needs is step 1's directions. Supabase is faked; these
// check what is written.

const ME = "u_derek";
const task = (over: Record<string, unknown> = {}) => ({
  id: "t_1", title: "Fix the hero", status: "todo", priority: "normal", due: null, client_id: "cl_1", project_id: "p_1",
  subtasks: [], comments: [], attachments: [], deleted_at: null, is_private: false, assignee_id: ME, ghl_task_id: null, follow_up_at: null, ...over,
});
let writes: { method: string; url: string; body: any }[] = [];
function fake(answers: { table: string; rows: unknown }[]) {
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method && init.method !== "GET") writes.push({ method: init.method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const path = String(url).split("/rest/v1/")[1] ?? "";
    const hit = answers.find((a) => path.startsWith(a.table));
    return { ok: true, status: 200, text: async () => JSON.stringify(hit ? hit.rows : []) } as any;
  }));
}
async function connect() {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: ME });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => ((await c.callTool({ name, arguments: args })) as any).content[0].text as string;
afterEach(() => vi.unstubAllGlobals());

describe("create_task description", () => {
  it("is step 1's directions, step 1 named for the task, and the task's description stays empty", async () => {
    fake([{ table: "clients", rows: [{ id: "cl_1", name: "Acme" }] }, { table: "projects", rows: [{ id: "p_1", name: "Tasks" }] }, { table: "profiles", rows: [] }]);
    const text = await call(await connect(), "create_task", { client_id: "cl_1", title: "Fix the hero", description: "Swap the photo\n\n- bigger\n- brighter" });
    const made = writes.find((w) => w.method === "POST" && w.url.includes("/rest/v1/tasks"))?.body;
    expect(made.description).toBe("");
    expect(made.subtasks).toHaveLength(1);
    expect(made.subtasks[0]).toMatchObject({ title: "Fix the hero", done: false, notes: "<p>Swap the photo</p><ul><li><p>bigger</p></li><li><p>brighter</p></li></ul>" });
    expect(made.subtasks[0].startedAt).toBeTruthy();
    expect(text).toContain("step 1's directions");
  });
  it("no description, no step", async () => {
    fake([{ table: "clients", rows: [{ id: "cl_1", name: "Acme" }] }, { table: "projects", rows: [{ id: "p_1", name: "Tasks" }] }, { table: "profiles", rows: [] }]);
    await call(await connect(), "create_task", { client_id: "cl_1", title: "Fix the hero" });
    const made = writes.find((w) => w.method === "POST" && w.url.includes("/rest/v1/tasks"))?.body;
    expect(made.subtasks).toBeUndefined();
    expect(made.description).toBe("");
  });
});

describe("update_task description", () => {
  it("goes on the end of step 1's directions, never the task's description", async () => {
    fake([{ table: "tasks", rows: [task({ subtasks: [{ id: "s_c", title: "Their ask", done: false, fromClient: true }, { id: "s_1", title: "Draft", done: false, notes: "<p>Mine</p>" }] })] }]);
    const text = await call(await connect(), "update_task", { id: "t_1", description: "<p>More</p>" });
    const rpc = writes.find((w) => w.url.includes("rpc/patch_subtask"));
    expect(rpc?.body).toMatchObject({ task_id: "t_1", subtask_id: "s_1", patch: { notes: "<p>Mine</p><p>More</p>" } });
    expect(writes.some((w) => w.method === "PATCH" && "description" in (w.body ?? {}))).toBe(false);
    expect(text).toContain("step 1's directions");
  });
  it("with no steps, makes step 1 named for the task", async () => {
    fake([{ table: "tasks", rows: [task()] }]);
    await call(await connect(), "update_task", { id: "t_1", description: "Swap the photo", priority: "urgent" });
    const rpc = writes.find((w) => w.url.includes("rpc/append_subtasks"));
    expect(rpc?.body.items).toHaveLength(1);
    expect(rpc?.body.items[0]).toMatchObject({ title: "Fix the hero", done: false, notes: "<p>Swap the photo</p>" });
    expect(writes.find((w) => w.method === "PATCH")?.body).toEqual({ priority: "urgent" });
  });
});

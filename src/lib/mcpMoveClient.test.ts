// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";
import { contactForMovedTask, listForMovedTask, clientMoveLine } from "../../mcp/taskMove.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// update_task client_id (Derek, 2026-10-07): moving a task to another client
// follows the Client box's rules (mcp/taskMove.mjs). Supabase is faked by URL
// fragment; these check what is written.

const ME = "u_derek";
const MATT = "cl_ct_ghl_matt", WLG = "cl_ct_ghl_wlg";
let writes: { method: string; url: string; body: any }[] = [];
function fake(routes: [string, unknown][]) {
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = decodeURIComponent(String(url));
    if (init?.method && init.method !== "GET") writes.push({ method: init.method, url: u, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes.find(([frag]) => u.includes(frag));
    const rows = init?.method === "PATCH" ? [{ id: "t_1", ghl_task_id: null }] : hit ? hit[1] : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(rows) } as any;
  }));
}
async function connect() {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: ME });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = async (c: Client, args: Record<string, unknown>) => ((await c.callTool({ name: "update_task", arguments: args })) as any).content[0].text as string;
const task = { id: "t_1", status: "todo", follow_up_at: null, client_id: MATT, project_id: "p_matt", ghl_task_id: "ghl_9", deleted_at: null, is_private: false };
const base: [string, unknown][] = [
  ["tasks?select", [task]],
  [`clients?select=id,name&id=eq.${WLG}`, [{ id: WLG, name: "Whitman Land Group" }]],
  [`clients?select=name&id=eq.${MATT}`, [{ name: "Matthew Whitman" }]],
  ["members", []], ["profiles", []],
];
const taskPatch = () => writes.find((w) => w.method === "PATCH" && w.url.includes("tasks?id=eq.t_1") && w.body.client_id)?.body;
afterEach(() => vi.unstubAllGlobals());

describe("the move rules", () => {
  it("a GoHighLevel contact client is its own contact; the workspace and a sub account have none", () => {
    expect(contactForMovedTask(WLG)).toBe("ct_ghl_wlg");
    expect(contactForMovedTask("cl_workspace")).toBeNull();
    expect(contactForMovedTask("c_agency")).toBeNull();
  });
  it("lands on the named list, else Tasks, else the first", () => {
    const lists = [{ id: "p_web", name: "Website", clientId: WLG }, { id: "p_t", name: "Tasks", clientId: WLG }, { id: "p_x", name: "Tasks", clientId: MATT }];
    expect(listForMovedTask(lists, WLG, "p_web")).toBe("p_web");
    expect(listForMovedTask(lists, WLG, "p_x")).toBe("p_t");
    expect(listForMovedTask(lists, WLG, null)).toBe("p_t");
    expect(listForMovedTask([{ id: "p_web", name: "Website", clientId: WLG }], WLG, null)).toBe("p_web");
    expect(listForMovedTask([], WLG, null)).toBeNull();
    expect(clientMoveLine("Matthew Whitman", "Whitman Land Group", "Tasks")).toBe("moved from Matthew Whitman to Whitman Land Group (Tasks)");
  });
});

describe("update_task client_id", () => {
  it("moves the task onto the new client's Tasks list, with its contact, unlinked from GoHighLevel, and logs it", async () => {
    fake([...base, [`projects?select=id,name,client_id&client_id=eq.${WLG}`, [{ id: "p_web", name: "Website", client_id: WLG }, { id: "p_tasks", name: "Tasks", client_id: WLG }]]]);
    const text = await call(await connect(), { id: "t_1", client_id: WLG });
    expect(taskPatch()).toMatchObject({ client_id: WLG, project_id: "p_tasks", contact_id: "ct_ghl_wlg", ghl_task_id: null });
    const ev = writes.find((w) => w.url.includes("rpc/append_comment"))?.body.comment;
    expect(ev).toMatchObject({ kind: "event", authorId: ME, body: "moved from Matthew Whitman to Whitman Land Group (Tasks)" });
    expect(text).toContain("unlinked from its GoHighLevel task");
  });
  it("takes a list of the new client with project_id, and refuses one of another client", async () => {
    fake([...base, [`projects?select=id,name,client_id&client_id=eq.${WLG}`, [{ id: "p_web", name: "Website", client_id: WLG }, { id: "p_tasks", name: "Tasks", client_id: WLG }]]]);
    await call(await connect(), { id: "t_1", client_id: WLG, project_id: "p_web" });
    expect(taskPatch()).toMatchObject({ project_id: "p_web" });
    fake([...base, [`projects?select=id,name,client_id&client_id=eq.${WLG}`, [{ id: "p_tasks", name: "Tasks", client_id: WLG }]]]);
    expect(await call(await connect(), { id: "t_1", client_id: WLG, project_id: "p_matt" })).toContain("isn't one of Whitman Land Group's lists");
    expect(taskPatch()).toBeUndefined();
  });
  it("makes a Tasks list when the client has none", async () => {
    fake([...base, [`projects?select=id,name,client_id&client_id=eq.${WLG}`, []]]);
    await call(await connect(), { id: "t_1", client_id: WLG });
    const made = writes.find((w) => w.method === "POST" && w.url.endsWith("/rest/v1/projects"))?.body;
    expect(made).toMatchObject({ client_id: WLG, name: "Tasks" });
    expect(taskPatch()).toMatchObject({ project_id: made.id });
  });
  it("refuses a sub account and an unknown client, changing nothing", async () => {
    fake(base);
    expect(await call(await connect(), { id: "t_1", client_id: "c_agency" })).toContain("sub account");
    expect(await call(await connect(), { id: "t_1", client_id: "cl_ct_ghl_nobody" })).toContain("No client");
    expect(writes).toHaveLength(0);
  });
});

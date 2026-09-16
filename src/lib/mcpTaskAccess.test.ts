// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The MCP tools run on the service role key, which bypasses row level security,
// so mcp/core.mjs applies the app's own two rules by hand (src/lib/taskAccess.ts):
// a trashed task is not there, and a private task belongs to its assignee alone.
// Every private task lives under the shared "personal" pseudo-client, so without
// the second rule one client listing returns the whole team's private work.
// Supabase is faked here: these assert the queries that go out and the rows that
// come back, no database is touched.

const ME = "u_claude";
const task = (over: Record<string, unknown> = {}) => ({
  id: "t_1", title: "A task", status: "todo", priority: "normal", due: null, client_id: "c_1", project_id: "p_1",
  subtasks: [], comments: [], attachments: [], deleted_at: null, is_private: false, assignee_id: ME, ...over,
});

let urls: string[] = [];
/** Answers each REST call with the first rows whose table matches, in order. */
function fakeSupabase(answers: { table: string; rows: unknown }[]) {
  urls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url));
    const path = String(url).split("/rest/v1/")[1] ?? "";
    const hit = answers.find((a) => path.startsWith(a.table));
    return { ok: true, status: 200, text: async () => JSON.stringify(hit ? hit.rows : []) } as any;
  }));
}
const names = [{ table: "clients", rows: [{ id: "c_1", name: "Acme" }] }, { table: "projects", rows: [{ id: "p_1", name: "Tasks" }] }];

async function connect() {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: ME });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  ((await client.callTool({ name, arguments: args })) as any).content[0].text as string;
const taskUrls = () => urls.filter((u) => u.includes("/rest/v1/tasks"));

afterEach(() => vi.unstubAllGlobals());

describe("what the MCP tools may see", () => {
  it("asks only for live rows on every task, client and project query", async () => {
    fakeSupabase([...names, { table: "tasks", rows: [task()] }]);
    const client = await connect();
    await call(client, "list_my_tasks", {});
    await call(client, "list_client_tasks", { client_id: "c_1" });
    await call(client, "get_task", { id: "t_1" });
    await call(client, "list_clients", {});
    await call(client, "list_projects", {});
    for (const u of urls.filter((x) => !x.includes("/profiles"))) expect(u).toContain("deleted_at=is.null");
  });

  it("hides a teammate's private task from a listing and from get_task", async () => {
    const mine = task({ id: "t_mine" });
    const theirs = task({ id: "t_theirs", is_private: true, assignee_id: "u_someone" });
    fakeSupabase([...names, { table: "tasks", rows: [mine, theirs] }]);
    const client = await connect();

    const listed = await call(client, "list_client_tasks", { client_id: "c_1" });
    expect(listed).toContain("t_mine");
    expect(listed).not.toContain("t_theirs");

    fakeSupabase([...names, { table: "tasks", rows: [theirs] }]);
    expect(await call(client, "get_task", { id: "t_theirs" })).toBe("No task t_theirs.");
  });

  it("still shows me my own private task", async () => {
    fakeSupabase([...names, { table: "tasks", rows: [task({ id: "t_p", is_private: true, assignee_id: ME })] }]);
    expect(await call(await connect(), "get_task", { id: "t_p" })).toContain("t_p");
  });

  it("refuses to write to a task it may not see, and never sends the write", async () => {
    const theirs = task({ id: "t_theirs", is_private: true, assignee_id: "u_someone" });
    for (const [tool, args] of [
      ["update_task", { id: "t_theirs", title: "Renamed" }],
      ["set_task_status", { id: "t_theirs", status: "done" }],
      ["add_comment", { id: "t_theirs", text: "hi" }],
      ["draft_email", { id: "t_theirs", subject: "s", body: "b" }],
      ["check_item", { id: "t_theirs", item: "x" }],
      ["add_checklist_items", { id: "t_theirs", items: ["x"] }],
      ["delete_task", { id: "t_theirs" }],
    ] as [string, Record<string, unknown>][]) {
      fakeSupabase([...names, { table: "tasks", rows: [theirs] }]);
      expect(await call(await connect(), tool, args)).toBe("No task t_theirs.");
      expect(taskUrls().every((u) => u.includes("select="))).toBe(true);
    }
  });

  it("scopes a write to a live row, so a task trashed mid-call is not written to", async () => {
    fakeSupabase([...names, { table: "tasks", rows: [task()] }]);
    const client = await connect();
    await call(client, "set_task_status", { id: "t_1", status: "done" });
    const write = taskUrls().find((u) => !u.includes("select="));
    expect(write).toContain("deleted_at=is.null");
  });

  it("offers every status the app has", async () => {
    const tools = (await (await connect()).listTools()).tools;
    const statuses = (tools.find((t) => t.name === "set_task_status")!.inputSchema as any).properties.status.enum;
    expect(statuses).toEqual(["todo", "get_started", "in_progress", "review", "changes_requested", "waiting", "approved", "delegated", "done"]);
  });
});

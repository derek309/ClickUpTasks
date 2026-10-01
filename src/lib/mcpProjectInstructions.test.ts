// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// set_project_instructions writes the task_briefs row the app's Project
// instructions box edits, and get_task always prints it. Supabase is faked:
// these assert the writes that go out, no database is touched.

const ME = "u_claude";
const task = (over: Record<string, unknown> = {}) => ({
  id: "t_1", title: "Backlit display", status: "todo", priority: "normal", due: null, client_id: "c_1", project_id: "p_1",
  subtasks: [], comments: [], attachments: [], deleted_at: null, is_private: false, assignee_id: ME, ...over,
});
let writes: { method: string; url: string; body: any }[] = [];
function fakeSupabase(answers: { table: string; rows: unknown }[]) {
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method && init.method !== "GET") writes.push({ method: init.method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const path = String(url).split("/rest/v1/")[1] ?? "";
    const hit = answers.find((a) => path.startsWith(a.table));
    return { ok: true, status: 200, text: async () => JSON.stringify(hit ? hit.rows : []) } as any;
  }));
}
const names = [{ table: "clients", rows: [{ id: "c_1", name: "BibBoards" }] }, { table: "projects", rows: [{ id: "p_1", name: "Tasks" }] }];
async function call(name: string, args: Record<string, unknown>) {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: ME });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return ((await client.callTool({ name, arguments: args })) as any).content[0].text as string;
}
afterEach(() => vi.unstubAllGlobals());

describe("set_project_instructions", () => {
  it("makes the instructions when the task has none, as the app's HTML", async () => {
    fakeSupabase([...names, { table: "tasks", rows: [task()] }, { table: "task_briefs", rows: [] }]);
    const text = await call("set_project_instructions", { task_id: "t_1", body: "## Size\n\n- Front: 91.73\"\n- **CMYK**, [files](https://drive.google.com/x)" });
    expect(text).toBe("Updated project instructions on Backlit display");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "POST", url: expect.stringContaining("/task_briefs") });
    expect(writes[0].body).toMatchObject({ task_id: "t_1", created_by: ME, updated_by: ME });
    expect(writes[0].body.id).toMatch(/^tbr_/);
    expect(writes[0].body.body).toBe('<h2>Size</h2><ul><li><p>Front: 91.73&quot;</p></li><li><p><strong>CMYK</strong>, <a href="https://drive.google.com/x">files</a></p></li></ul>');
  });

  it("replaces the text of existing instructions, and an empty body clears it", async () => {
    fakeSupabase([...names, { table: "tasks", rows: [task()] }, { table: "task_briefs", rows: [{ id: "tbr_1" }] }]);
    await call("set_project_instructions", { task_id: "t_1", body: "Snap. Lock. Run." });
    expect(writes).toEqual([{ method: "PATCH", url: expect.stringContaining("task_briefs?id=eq.tbr_1"), body: { body: "<p>Snap. Lock. Run.</p>", updated_by: ME, updated_at: expect.any(String) } }]);

    fakeSupabase([...names, { table: "tasks", rows: [task()] }, { table: "task_briefs", rows: [{ id: "tbr_1" }] }]);
    await call("set_project_instructions", { task_id: "t_1", body: "" });
    expect(writes).toHaveLength(1);
    expect(writes[0].body.body).toBe("");
  });

  it("never touches a private or Personal task", async () => {
    fakeSupabase([...names, { table: "tasks", rows: [task({ is_private: true })] }, { table: "task_briefs", rows: [] }]);
    expect(await call("set_project_instructions", { task_id: "t_1", body: "x" })).toContain("can't have project instructions");
    fakeSupabase([...names, { table: "tasks", rows: [task({ client_id: "personal" })] }, { table: "task_briefs", rows: [] }]);
    expect(await call("set_project_instructions", { task_id: "t_1", body: "x" })).toContain("can't have project instructions");
    expect(writes).toHaveLength(0);
  });
});

describe("get_task", () => {
  it("prints the project instructions as markdown, or (none)", async () => {
    fakeSupabase([...names, { table: "tasks", rows: [task()] }, { table: "task_briefs", rows: [{ body: "<h2>Size</h2><ul><li><p><strong>CMYK</strong></p></li></ul>" }] }]);
    expect(await call("get_task", { id: "t_1" })).toContain("Project instructions:\n## Size\n\n- **CMYK**");
    fakeSupabase([...names, { table: "tasks", rows: [task()] }, { table: "task_briefs", rows: [] }]);
    expect(await call("get_task", { id: "t_1" })).toContain("Project instructions:\n(none)");
  });
});

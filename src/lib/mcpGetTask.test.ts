// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// get_task hands Claude the team's Instructions before anything else about a task:
// the list's first, then the task's own. The database is a fake fetch that
// answers each REST path the tool asks for.

const task = {
  id: "t_1", title: "Spring flyer", status: "todo", priority: "normal", due: null, client_id: "cl_1", project_id: "p_1",
  description: "<p>Make the flyer.</p>", instructions: "<p>Use the new logo.</p>", subtasks: [], attachments: [], comments: [],
};
let list: { name: string; instructions: string } = { name: "Website", instructions: "<p>Brand colors are navy and gold.</p>" };
let taskRow: any = task;

function answer(url: string): unknown {
  const path = url.split("/rest/v1/")[1] ?? "";
  if (path.startsWith("projects?select=name,instructions")) return [list];
  if (path.startsWith("projects?select=id,name")) return [{ id: "p_1", name: "Website" }];
  if (path.startsWith("clients?select=id,name")) return [{ id: "cl_1", name: "Acme" }];
  if (path.startsWith("tasks?select=*")) return [taskRow];
  return [];
}

async function connect() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(answer(String(url))), { status: 200 })));
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: "u_claude" });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const getTask = async (client: Client) => ((await client.callTool({ name: "get_task", arguments: { id: "t_1" } })) as any).content[0].text as string;

afterEach(() => {
  vi.unstubAllGlobals();
  list = { name: "Website", instructions: "<p>Brand colors are navy and gold.</p>" };
  taskRow = task;
});

describe("get_task instructions", () => {
  it("lists the list's instructions, then the task's, before the description", async () => {
    const text = await getTask(await connect());
    const at = (s: string) => text.indexOf(s);
    expect(at("Instructions (follow these):")).toBeGreaterThan(-1);
    expect(at("From the Website list:")).toBeGreaterThan(at("Instructions (follow these):"));
    expect(text).toContain("Brand colors are navy and gold.");
    expect(at("For this task:")).toBeGreaterThan(at("From the Website list:"));
    expect(text).toContain("Use the new logo.");
    expect(at("Description:")).toBeGreaterThan(at("Use the new logo."));
  });

  it("leaves the section out when neither has instructions", async () => {
    list = { name: "Website", instructions: "" };
    taskRow = { ...task, instructions: "" };
    const text = await getTask(await connect());
    expect(text).not.toContain("Instructions");
    expect(text).toContain("Description:");
  });

  it("tells Claude when it connects to follow a task's instructions", async () => {
    const client = await connect();
    expect(client.getInstructions()).toMatch(/get_task/);
  });
});

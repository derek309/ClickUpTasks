// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The five tools a Claude chat asked for on 2026-10-06: remove and reorder
// checklist items, checklist ids from get_task, move a task between lists, and
// Inbox drafts. Supabase is faked; these check what is written.

const ME = "u_derek";
const subs = [
  { id: "s_a", title: "Create the pipeline", done: false },
  { id: "s_b", title: "Create the pipeline stages", done: false },
  { id: "s_c", title: "Test a signup", done: true },
];
const task = (over: Record<string, unknown> = {}) => ({
  id: "t_1", title: "A task", status: "todo", priority: "normal", due: null, client_id: "c_1", project_id: "p_1",
  subtasks: subs, comments: [], attachments: [], deleted_at: null, is_private: false, assignee_id: ME, ...over,
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

describe("checklist tools", () => {
  it("get_task shows each item's id", async () => {
    fake([{ table: "clients", rows: [] }, { table: "projects", rows: [] }, { table: "task_briefs", rows: [] }, { table: "tasks", rows: [task()] }]);
    expect(await call(await connect(), "get_task", { id: "t_1" })).toContain('"id":"s_b"');
  });
  it("removes by id, and by text that matches one item", async () => {
    fake([{ table: "tasks", rows: [task()] }]);
    const text = await call(await connect(), "remove_checklist_items", { id: "t_1", items: ["s_a", "signup"] });
    expect(text).toContain("Removed 2");
    expect(writes.filter((w) => w.url.includes("rpc/remove_subtask")).map((w) => w.body.subtask_id)).toEqual(["s_a", "s_c"]);
  });
  it("removes nothing when text matches two items", async () => {
    fake([{ table: "tasks", rows: [task()] }]);
    const text = await call(await connect(), "remove_checklist_items", { id: "t_1", items: ["create the pipeline"] });
    expect(text).toContain("Too many matches");
    expect(writes).toHaveLength(0);
  });
  it("reorders, keeping the ones left out after", async () => {
    fake([{ table: "tasks", rows: [task()] }]);
    await call(await connect(), "reorder_checklist", { id: "t_1", order: ["s_c"] });
    const patch = writes.find((w) => w.method === "PATCH");
    expect(patch?.body.subtasks.map((s: any) => s.id)).toEqual(["s_c", "s_a", "s_b"]);
  });
});

describe("update_task project_id", () => {
  it("moves within the same client", async () => {
    fake([{ table: "projects", rows: [{ id: "p_2", name: "Ads", client_id: "c_1" }] }, { table: "tasks", rows: [task()] }]);
    await call(await connect(), "update_task", { id: "t_1", project_id: "p_2" });
    expect(writes.find((w) => w.method === "PATCH")?.body).toMatchObject({ project_id: "p_2" });
  });
  it("refuses a list of another client", async () => {
    fake([{ table: "projects", rows: [{ id: "p_9", name: "Other", client_id: "c_9" }] }, { table: "tasks", rows: [task()] }]);
    const text = await call(await connect(), "update_task", { id: "t_1", project_id: "p_9" });
    expect(text).toContain("another client");
    expect(writes).toHaveLength(0);
  });
});

describe("draft_message", () => {
  it("puts an email to a client's contact in Drafts and sends nothing", async () => {
    fake([
      { table: "clients", rows: [{ id: "cl_ct_ghl_G1", name: "Pamela Macias", linked_contact_id: null }] },
      { table: "contacts", rows: [{ id: "ct_1", name: "Pamela Macias", email: "pam@example.com", phone: "+15555550100" }] },
      { table: "inbox_prefs", rows: [{ prefs: { queuedDrafts: [] } }] },
    ]);
    const text = await call(await connect(), "draft_message", { channel: "email", client_id: "cl_ct_ghl_G1", subject: "Hi", body: "Hello Pam" });
    expect(text).toContain("Nothing was sent");
    const w = writes.find((x) => x.url.includes("rpc/queued_draft_put"));
    expect(w?.method).toBe("POST");
    expect(w?.body.draft).toMatchObject({ kind: "email", to: "pam@example.com", contactId: "ct_1", subject: "Hi", body: "Hello Pam", by: "Claude" });
    expect(writes.every((x) => !x.url.includes("send"))).toBe(true);
  });
  it("goes to Derek's Inbox when connected as Claude", async () => {
    fake([
      { table: "profiles", rows: [{ member_id: "u_derek", name: "Derek Fox" }] },
      { table: "contacts", rows: [{ id: "ct_1", name: "Pam", email: "pam@example.com", phone: null }] },
      { table: "inbox_prefs", rows: [] },
    ]);
    const server = createServer({ url: "https://db.invalid", key: "test", memberId: "u_claude" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const text = await call(client, "draft_message", { channel: "email", to: "pam@example.com", body: "Hi" });
    expect(text).toContain("Derek Fox's Inbox");
    expect(writes.find((x) => x.url.includes("rpc/queued_draft_put"))?.body.member).toBe("u_derek");
  });
  it("needs a contact for a text", async () => {
    fake([{ table: "contacts", rows: [] }, { table: "inbox_prefs", rows: [] }]);
    const text = await call(await connect(), "draft_message", { channel: "text", to: "916 555 0100", body: "Hi" });
    expect(text).toContain("needs someone who is a contact");
    expect(writes).toHaveLength(0);
  });
});

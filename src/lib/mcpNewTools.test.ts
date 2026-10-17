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
  it("get_task shows each step's id, the current one marked", async () => {
    fake([{ table: "clients", rows: [] }, { table: "projects", rows: [] }, { table: "task_briefs", rows: [] }, { table: "profiles", rows: [] }, { table: "task_documents", rows: [] }, { table: "tasks", rows: [task()] }]);
    const text = await call(await connect(), "get_task", { id: "t_1" });
    expect(text).toContain("[s_b]");
    expect(text).toMatch(/\[CURRENT\]/);
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

// Steps set up the way the app sets one up (Derek, 2026-10-14): who, when,
// what it holds and its directions, on each step add_checklist_items adds.
describe("add_checklist_items set up", () => {
  const people = { table: "profiles", rows: [{ member_id: "u_derek", name: "Derek Fox" }, { member_id: "u_justin", name: "Justin Lee" }] };
  const added = () => writes.find((w) => w.url.includes("rpc/append_subtasks"))!.body.items;

  // One step at a time (Derek, 2026-10-17): each is added on its own, to a
  // task whose steps are all done.
  const allDone = () => task({ subtasks: [{ id: "s_c", title: "Test a signup", done: true }] });
  const addOne = async (item: unknown) => {
    fake([people, { table: "task_documents", rows: [] }, { table: "tasks", rows: [allDone()] }]);
    const text = await call(await connect(), "add_checklist_items", { id: "t_1", items: [item] });
    return { text, step: added()[0] };
  };
  it("writes who, when, what it holds, to-dos and directions on the step", async () => {
    const flyer = await addOne({ title: "Design the flyer", assignee: "u_justin", due: "2026-10-20", directions: "Use the **brand** colors", holds: "image" });
    expect(flyer.step).toMatchObject({ title: "Design the flyer", assigneeId: "u_justin", due: "2026-10-20", notes: "<p>Use the <strong>brand</strong> colors</p>", holds: ["image"], madeHere: ["image"], followUpAt: expect.any(String), startedAt: expect.any(String) });
    expect(flyer.text).toContain("Design the flyer");
    expect(flyer.text).toContain("Justin Lee · due 2026-10-20 · holds the image review");
    const copy = (await addOne({ title: "Check the copy", assignee: "claude" })).step;
    expect(copy).toMatchObject({ assigneeId: "u_claude", due: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(copy.followUpAt).toBeUndefined();
    const approve = (await addOne({ title: "Approve", assignee: "me", due: "2026-10-22", holds: "checklist", todos: ["Read it", " ", "Sign off"] })).step;
    expect(approve).toMatchObject({ assigneeId: "u_derek", due: "2026-10-22", todos: [{ title: "Read it", done: false }, { title: "Sign off", done: false }] });
    expect(approve.holds).toBeUndefined();
    expect((await addOne({ title: "Text the client", holds: "text", due: "2026-10-23" })).step).toMatchObject({ draftMessage: { channel: "sms", body: "" }, assigneeId: "u_derek" });
    const plain = await addOne("Plain one");
    expect(plain.step).toMatchObject({ title: "Plain one", done: false, assigneeId: "u_derek" });
    expect(plain.step.due).toBeUndefined();
    expect(plain.text).toContain("Not set up: \"Plain one\" (when)");
  });

  it("one step at a time: with a step open, or more than one given, nothing is added and it says to use to-dos", async () => {
    fake([people, { table: "tasks", rows: [task()] }]);
    const open = await call(await connect(), "add_checklist_items", { id: "t_1", items: ["Invoice", "Chase it"] });
    expect(open).toContain("One step at a time");
    expect(open).toContain('"Create the pipeline" [s_a] is still open');
    expect(open).toContain('add_todos: ["Invoice","Chase it"]');
    expect(writes).toHaveLength(0);
    fake([people, { table: "tasks", rows: [allDone()] }]);
    const many = await call(await connect(), "add_checklist_items", { id: "t_1", items: ["Invoice", "Chase it", "Thank them"] });
    expect(many).toContain("add only the next step");
    expect(many).toContain('["Chase it","Thank them"]');
    expect(writes).toHaveLength(0);
  });

  it("a client step is an ask holding the email, and the email comes off the step that held it", async () => {
    const holding = { id: "s_e", title: "Email Pam", done: true, holds: ["email", "doc"], namedFrom: { title: "Draft", key: "email", as: "Email Pam" } };
    fake([people, { table: "clients", rows: [{ name: "Pam Macias" }] }, { table: "tasks", rows: [task({ client_id: "cl_1", subtasks: [holding], draft_email: null })] }]);
    const text = await call(await connect(), "add_checklist_items", { id: "t_1", items: [{ title: "Send the logo", assignee: "client", due: "2026-10-21" }] });
    expect(added()[0]).toMatchObject({ title: "Ask Pam: Send the logo", holds: ["email"], madeHere: ["email"], assigneeId: "u_derek", due: "2026-10-21" });
    const release = writes.find((w) => w.url.includes("rpc/patch_subtask"))!.body;
    expect(release).toEqual({ task_id: "t_1", subtask_id: "s_e", patch: { holds: ["doc"], namedFrom: null, title: "Draft" }, author: null });
    expect(text).toContain("draft_email");
  });

  it("answers an open what's next step: it goes, and the first new step starts", async () => {
    const subsNext = [{ id: "s_1", title: "Draft", done: true }, { id: "s_n", title: "Draft: what's next?", done: false, addedFor: "next:s_1" }];
    fake([people, { table: "tasks", rows: [task({ subtasks: subsNext })] }]);
    await call(await connect(), "add_checklist_items", { id: "t_1", items: [{ title: "Send it", assignee: "me", due: "2026-10-21" }] });
    expect(added()[0].startedAt).toBeTruthy();
    expect(writes.find((w) => w.url.includes("rpc/remove_subtask"))?.body).toMatchObject({ subtask_id: "s_n" });
  });

  it("refuses, writing nothing: a checklist with no to-dos, an unknown person, two steps at once, a client step on a private task", async () => {
    for (const [items, said, over] of [
      [[{ title: "List", holds: "checklist" }], "give its todos", {}],
      [[{ title: "X", assignee: "u_nobody" }], "Unknown member", {}],
      [[{ title: "A", holds: "page" }, { title: "B", holds: "page" }], "One step at a time", {}],
      [[{ title: "Ask", assignee: "client" }], "no client to ask", { is_private: true, assignee_id: ME }],
    ] as [unknown[], string, Record<string, unknown>][]) {
      fake([people, { table: "task_documents", rows: [] }, { table: "tasks", rows: [task({ subtasks: [{ id: "s_c", title: "Test a signup", done: true }], ...over })] }]);
      expect(await call(await connect(), "add_checklist_items", { id: "t_1", items })).toContain(said);
      expect(writes).toHaveLength(0);
    }
  });
});

describe("the server's instructions", () => {
  it("teach the turns, the queue and the working rules", async () => {
    const rules = (await connect()).getInstructions() ?? "";
    for (const bit of [
      "chain of TURNS", "one person's turn", "it is a to-do inside that step", "One thing per step", "Directions are context",
      "who (assignee", "when (due)", "what it holds", "work Now first", "Never give an Up next task a due date", "joins the line by its priority",
      "move_in_queue", "Needs you means only two things: the client wrote, or Claude finished its step",
      "Started:", "Done:", "check_item", "check_todo", "draft_email with step", "resolve_comments",
    ]) expect(rules).toContain(bit);
  });
});

describe("get_task steps", () => {
  it("show each open step's who, due and what it holds, even work not made yet", async () => {
    const steps = [
      { id: "s_1", title: "Design", done: false, assigneeId: "u_justin", due: "2026-10-20", holds: ["image"] },
      { id: "s_2", title: "Ask Pam: logo", done: false, holds: ["email"] },
      { id: "s_3", title: "Text Pam", done: false, draftMessage: { channel: "sms", body: "" } },
    ];
    fake([{ table: "clients", rows: [] }, { table: "projects", rows: [] }, { table: "task_briefs", rows: [] }, { table: "profiles", rows: [{ member_id: "u_derek", name: "Derek Fox" }, { member_id: "u_justin", name: "Justin Lee" }] }, { table: "task_documents", rows: [] }, { table: "tasks", rows: [task({ subtasks: steps, draft_email: null })] }]);
    const text = await call(await connect(), "get_task", { id: "t_1" });
    expect(text).toContain("1. [CURRENT] Design [s_1] · Justin Lee · due 2026-10-20");
    expect(text).toContain("Holds: image review (not made yet)");
    expect(text).toContain("2. [ ] Ask Pam: logo [s_2] · Derek Fox (the task's owner) · no due date");
    expect(text).toContain("Holds: an email (not written yet: draft_email with this step)");
    expect(text).toContain("Holds: a text to send (not written yet)");
  });
});

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

// A small in-memory database for the queue tools: one queue list (p_q, one at
// a time, three business days apart) and whatever tasks a test puts on it.
type Row = Record<string, any>;
let db: { tasks: Row[]; notifications: Row[]; comments: { task_id: string; body: string }[] };
function fakeDb(tasks: Row[], queue: unknown = { now: 1, spacing: 3 }) {
  db = { tasks: tasks.map((t) => ({ ...t })), notifications: [], comments: [] };
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : null;
    const path = decodeURIComponent(String(url).split("/rest/v1/")[1] ?? "");
    if (method !== "GET") writes.push({ method, url: path, body });
    const ok = (rows: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) }) as any;
    const idEq = path.match(/[?&]id=eq\.([^&]+)/)?.[1];
    if (path.startsWith("projects?select=queue")) return ok([{ queue }]);
    if (path.startsWith("projects?select=instructions")) return ok([{ instructions: "" }]);
    if (path.startsWith("projects")) return ok([{ id: "p_q", name: "Videos", client_id: "cl_1" }]);
    if (path.startsWith("clients")) return ok([{ id: "cl_1", name: "Acme" }]);
    if (path.startsWith("profiles")) return ok([{ member_id: "u_derek", name: "Derek Fox" }, { member_id: "u_justin", name: "Justin Lee" }]);
    if (path.startsWith("notifications") && method === "POST") { db.notifications.push(body); return ok([body]); }
    if (path.startsWith("rpc/append_comment")) { db.comments.push({ task_id: body.task_id, body: body.comment.body }); return ok(null); }
    if (path.startsWith("tasks") && method === "POST") { db.tasks.push({ comments: [], attachments: [], deleted_at: null, is_private: false, ...body }); return ok([body]); }
    if (path.startsWith("tasks") && method === "PATCH") {
      const t = db.tasks.find((x) => x.id === idEq);
      if (t) Object.assign(t, body);
      return ok(t ? [t] : []);
    }
    if (path.startsWith("tasks?")) {
      if (idEq) return ok(db.tasks.filter((x) => x.id === idEq));
      if (path.includes("project_id=eq.p_q")) return ok(db.tasks.filter((x) => x.project_id === "p_q" && x.status !== "done"));
      return ok(db.tasks);
    }
    return ok([]);
  }));
}
const q = (id: string, over: Row = {}): Row => ({
  id, title: id, status: "todo", priority: "normal", due: null, client_id: "cl_1", project_id: "p_q", subtasks: [], comments: [], attachments: [],
  deleted_at: null, is_private: false, assignee_id: "u_derek", follow_up_at: null, created_at: `2026-10-0${id.length % 9}T00:00:00Z`, queue_pos: null, deadline: false, queue_saved_due: null, waiting_on_client: false, ...over,
});
const today = pacificToday();
const nowDue = addBusinessDaysIso(today, 3);
const line3 = () => [q("t_a", { queue_pos: 1000, due: nowDue }), q("t_b", { queue_pos: 2000 }), q("t_c", { queue_pos: 3000 })];

describe("create_task on a queue list", () => {
  it("joins the bottom of the line with no due date, its date kept for later", async () => {
    fakeDb(line3());
    const text = await call(await connect(), "create_task", { client_id: "cl_1", project_id: "p_q", title: "Video 4", due: "2026-11-02" });
    const made = writes.find((w) => w.method === "POST" && w.url.startsWith("tasks"))!.body;
    expect(made.due).toBeNull();
    expect(made.queue_pos).toBe(4000);
    expect(made.queue_saved_due).toBe("2026-11-02");
    expect(text).toContain("Up next · 4th");
  });
  it("an urgent one joins at the top of Up next", async () => {
    fakeDb(line3());
    const text = await call(await connect(), "create_task", { client_id: "cl_1", project_id: "p_q", title: "Hot fix", priority: "urgent" });
    const made = writes.find((w) => w.method === "POST" && w.url.startsWith("tasks"))!.body;
    expect(made.queue_pos).toBeGreaterThan(1000);
    expect(made.queue_pos).toBeLessThan(2000);
    expect(text).toContain("Up next · 2nd");
  });
  it("a deadline keeps its date wherever it joins", async () => {
    fakeDb(line3());
    await call(await connect(), "create_task", { client_id: "cl_1", project_id: "p_q", title: "Launch", due: "2026-12-01", deadline: true });
    const made = writes.find((w) => w.method === "POST" && w.url.startsWith("tasks"))!.body;
    expect(made).toMatchObject({ due: "2026-12-01", deadline: true, queue_saved_due: null });
  });
  it("place now puts it first in line, due today", async () => {
    fakeDb(line3());
    const text = await call(await connect(), "create_task", { client_id: "cl_1", project_id: "p_q", title: "Now one", place: "now" });
    const made = writes.find((w) => w.method === "POST" && w.url.startsWith("tasks"))!.body;
    expect(made.queue_pos).toBeLessThan(1000);
    expect(made.due).toBe(today);
    expect(text).toContain("Now");
  });
  it("an empty line: it is Now and dated by the Now check", async () => {
    fakeDb([]);
    const text = await call(await connect(), "create_task", { client_id: "cl_1", project_id: "p_q", title: "Only one" });
    const made = writes.find((w) => w.method === "POST" && w.url.startsWith("tasks"))!.body;
    expect(made.due).toBe(nowDue);
    expect(text).toContain("On the queue Videos: Now");
  });
  it("a deadline needs its date", async () => {
    fakeDb([]);
    expect(await call(await connect(), "create_task", { client_id: "cl_1", project_id: "p_q", title: "x", deadline: true })).toContain("needs its date");
    expect(writes).toEqual([]);
  });
});

describe("move_in_queue", () => {
  it("to now: it takes the Now place and its date, the old Now one goes back in line with its date saved", async () => {
    fakeDb(line3());
    const text = await call(await connect(), "move_in_queue", { task_id: "t_c", to: "now", reason: "client is waiting on it" });
    expect(db.tasks.find((t) => t.id === "t_c")).toMatchObject({ due: nowDue });
    expect(db.tasks.find((t) => t.id === "t_c")!.queue_pos).toBeLessThan(1000);
    expect(db.tasks.find((t) => t.id === "t_a")).toMatchObject({ due: null, queue_saved_due: nowDue });
    expect(db.comments).toContainEqual({ task_id: "t_c", body: `moved to Now in the queue, due ${nowDue}` });
    expect(text).toMatch(/Now \[t_c\][\s\S]*Up next · 2nd \[t_a\][\s\S]*Up next · 3rd \[t_b\]/);
  });
  it("someone else's task needs a reason, and they get one notification with it", async () => {
    fakeDb(line3());
    const client = await connect();
    expect(await call(client, "move_in_queue", { task_id: "t_c", to: "next" })).toContain("Give a short reason");
    expect(writes).toEqual([]);
    const text = await call(client, "move_in_queue", { task_id: "t_c", to: "next", reason: "the shoot moved up" });
    expect(db.notifications).toEqual([expect.objectContaining({ recipient_id: "u_derek", text: "Claude moved t_c up: the shoot moved up", task_id: "t_c", actor_id: ME, project_id: "p_q", kind: "activity", read: false })]);
    expect(text).toContain("now Up next · 2nd");
    expect(text).toContain("Derek Fox was told why");
  });
  it("Claude's own task or an unassigned one moves without a reason or a notification", async () => {
    fakeDb([...line3(), q("t_d", { queue_pos: 4000, assignee_id: null })]);
    const text = await call(await connect(), "move_in_queue", { task_id: "t_d", before_task_id: "t_b" });
    expect(db.notifications).toEqual([]);
    expect(text).toMatch(/Up next · 2nd \[t_d\]/);
  });
  it("bottom, already there, and a list that is not a queue", async () => {
    fakeDb(line3());
    expect(await call(await connect(), "move_in_queue", { task_id: "t_c", to: "bottom", reason: "x" })).toContain("already there");
    fakeDb(line3(), null);
    expect(await call(await connect(), "move_in_queue", { task_id: "t_c", to: "bottom", reason: "x" })).toContain("not a queue");
    expect(writes).toEqual([]);
  });
});

describe("get_task on a queue list", () => {
  it("says where the task stands in the line", async () => {
    fakeDb(line3());
    const client = await connect();
    expect(await call(client, "get_task", { id: "t_a" })).toContain("Queue: Now");
    expect(await call(client, "get_task", { id: "t_c" })).toContain("Queue: Up next · 3rd");
  });
  it("a plain list has no queue line", async () => {
    fakeDb(line3(), null);
    expect(await call(await connect(), "get_task", { id: "t_a" })).not.toContain("Queue:");
  });
});

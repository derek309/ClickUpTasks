// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// A trashed task must be invisible through a client's share link: never
// listed, not reachable by ?task=<id>, and refused by every route that writes
// to a task, with the same 404 an unknown id gets (found 2026-09-11).

vi.mock("@/lib/supabaseAdmin", async () => ({
  supabaseAdmin: (await import("@/test/fakeSupabase")).fakeSupabaseAdmin,
  adminConfigured: true,
}));
vi.mock("@/lib/db", () => ({ TASK_FILES_BUCKET: "task-files" }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: async () => null }));
vi.mock("@/lib/waitingNotify", () => ({
  resolveNotifyRecipient: async () => null,
  notifyTeamOfClientActivity: async () => {},
}));

const { resetTables, writes } = await import("@/test/fakeSupabase");
const { GET } = await import("./route");
const { POST: respond } = await import("./respond/route");
const { POST: status } = await import("./status/route");
const { POST: message } = await import("./messages/route");
const { POST: upload } = await import("./upload/route");
const { POST: request } = await import("./request/route");

const TOKEN = "client_token_aaaaaaaaaaaa";
const TRASHED = "2026-09-10T12:00:00Z";
const base = `http://localhost/api/waiting/${TOKEN}`;
const ctx = { params: Promise.resolve({ token: TOKEN }) };

const task = (id: string, extra: Record<string, unknown>) => ({
  id, client_id: "cl_acme", project_id: "p_site", title: id, description: "", due: "2026-09-12",
  status: "todo", is_private: false, waiting_on_client: true, client_response: null,
  attachments: [], assignee_id: "u_derek", deleted_at: null, ...extra,
});

beforeEach(() => resetTables({
  clients: [{
    id: "cl_acme", name: "Acme", share_token: TOKEN, assigned_to: [], linked_contact_id: "c_acme",
    can_request_new_tasks: true, show_growth_plan: false, portal_shows_all_tasks: true, deleted_at: null,
  }],
  projects: [
    { id: "p_old", client_id: "cl_acme", name: "Old list", position: 0, deleted_at: TRASHED },
    { id: "p_site", client_id: "cl_acme", name: "Website", position: 1, deleted_at: null },
  ],
  tasks: [
    task("t_live", {}),
    // Matches every GET query (waiting, responded, open, and ?task=) but trashed.
    task("t_trashed", { deleted_at: TRASHED, client_response: { body: "x", attachments: [], submittedAt: TRASHED } }),
  ],
}));

const post = (path: string, body: unknown) =>
  new NextRequest(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });

describe("GET /api/waiting/[token]", () => {
  it("lists live tasks and projects, never trashed ones", async () => {
    const json = await (await GET(new NextRequest(base), ctx)).json();
    expect(json.tasks.map((t: { id: string }) => t.id)).toEqual(["t_live"]);
    expect(json.projects.map((p: { id: string }) => p.id)).toEqual(["p_site"]);
  });

  it("does not bring a trashed task back through ?task=", async () => {
    const json = await (await GET(new NextRequest(`${base}?task=t_trashed`), ctx)).json();
    expect(json.tasks.map((t: { id: string }) => t.id)).not.toContain("t_trashed");
  });
});

describe("task write routes refuse a trashed task", () => {
  const routes = [
    { name: "respond", call: (id: string) => respond(post("/respond", { taskId: id, body: "Here you go" }), ctx) },
    { name: "status", call: (id: string) => status(post("/status", { taskId: id, status: "review" }), ctx) },
    { name: "messages", call: (id: string) => message(post("/messages", { taskId: id, body: "Hello" }), ctx) },
    // Asking for an upload link: files go straight to storage, so this is where the task is checked.
    { name: "upload", call: (id: string) => upload(post("/upload", { action: "start", task_id: id, name: "shot.png", size: 3 }), ctx) },
  ];

  it.each(routes)("$name 404s on a trashed task and writes nothing", async ({ call }) => {
    const res = await call("t_trashed");
    expect(res.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it.each(routes)("$name still accepts a live task", async ({ call }) => {
    expect((await call("t_live")).status).toBe(200);
  });
});

describe("POST /api/waiting/[token]/request", () => {
  it("never files a new task into a trashed project", async () => {
    const res = await request(post("/request", { body: "Please add a page", projectId: "p_old" }), ctx);
    expect(res.status).toBe(200);
    const created = writes.find((w) => w.table === "tasks" && w.op === "insert")?.payload as { project_id: string };
    expect(created.project_id).toBe("p_site");
  });
});

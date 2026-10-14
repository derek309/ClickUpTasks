// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// A queue list on the client's portal (Derek, 2026-10-14): "What we're doing"
// shows what is Now, then the rest in line ("2nd", "3rd") with no dates.

vi.mock("@/lib/supabaseAdmin", async () => ({
  supabaseAdmin: (await import("@/test/fakeSupabase")).fakeSupabaseAdmin,
  adminConfigured: true,
}));
vi.mock("@/lib/db", () => ({ TASK_FILES_BUCKET: "task-files" }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: async () => null }));

const { resetTables } = await import("@/test/fakeSupabase");
const { GET } = await import("./route");

const TOKEN = "client_token_qqqqqqqqqqqq";
const base = `http://localhost/api/waiting/${TOKEN}`;
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const task = (id: string, extra: Record<string, unknown>) => ({
  id, client_id: "cl_mike", project_id: "p_videos", title: id, description: "", due: null, status: "in_progress", priority: "normal",
  is_private: false, hidden_from_client: false, waiting_on_client: false, client_response: null, attachments: [], subtasks: [],
  deleted_at: null, recurrence: "none", created_at: `2026-10-0${id.slice(-1)}T00:00:00Z`, updated_at: "2026-10-10T00:00:00Z",
  deadline: false, queue_saved_due: null, ...extra,
});
const tables = (queue: unknown) => ({
  clients: [{ id: "cl_mike", name: "Michael Swaleh", share_token: TOKEN, assigned_to: [], linked_contact_id: null, can_request_new_tasks: false, portal_shows_all_tasks: true, deleted_at: null }],
  projects: [{ id: "p_videos", client_id: "cl_mike", name: "Website", position: 0, deleted_at: null, hidden_from_client: false, queue }],
  tasks: [
    task("t_1", { queue_pos: 1000, due: "2026-10-16" }),
    task("t_2", { queue_pos: 2000, queue_saved_due: "2026-10-14" }),
    task("t_3", { queue_pos: 3000, queue_saved_due: "2026-10-14" }),
    // A private task holds its place but never leaves this route.
    task("t_4", { queue_pos: 2500, is_private: true }),
  ],
});
type T = { id: string; queue?: string; place?: string | null; due: string | null };

describe("GET /api/waiting/[token] on a queue list", () => {
  beforeEach(() => resetTables(tables({ now: 1, spacing: 3 })));
  it("marks Now and the line, no dates in line, and a private task leaves no gap in the places", async () => {
    const json = await (await GET(new NextRequest(base), ctx)).json();
    expect(json.projects).toEqual([{ id: "p_videos", name: "Website", queue: true }]);
    const by = (id: string) => json.tasks.find((t: T) => t.id === id) as T;
    expect(by("t_1")).toMatchObject({ queue: "now", place: null, due: "2026-10-16" });
    expect(by("t_2")).toMatchObject({ queue: "line", place: "2nd", due: null });
    expect(by("t_3")).toMatchObject({ queue: "line", place: "3rd", due: null });
    expect(by("t_4")).toBeUndefined();
  });
});

describe("GET /api/waiting/[token] on a plain list", () => {
  beforeEach(() => resetTables(tables(null)));
  it("is unchanged: no queue marks", async () => {
    const json = await (await GET(new NextRequest(base), ctx)).json();
    expect(json.projects).toEqual([{ id: "p_videos", name: "Website" }]);
    expect(json.tasks.every((t: T) => t.queue === undefined)).toBe(true);
  });
});

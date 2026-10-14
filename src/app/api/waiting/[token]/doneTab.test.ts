// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The Done tab (Derek, 2026-10-13): every task finished in the last 13 months
// (Brian Goodell has 162; the list used to stop at 150), the older ones as a
// count, the finish date from completed_at when it is there, and finished
// tasks past 30 days sent short, fetched in full with ?detail=.

vi.mock("@/lib/supabaseAdmin", async () => ({
  supabaseAdmin: (await import("@/test/fakeSupabase")).fakeSupabaseAdmin,
  adminConfigured: true,
}));
vi.mock("@/lib/db", () => ({ TASK_FILES_BUCKET: "task-files" }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: async () => null }));

const { resetTables } = await import("@/test/fakeSupabase");
const { GET } = await import("./route");

const TOKEN = "client_token_bbbbbbbbbbbb";
const base = `http://localhost/api/waiting/${TOKEN}`;
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const task = (id: string, extra: Record<string, unknown>) => ({
  id, client_id: "cl_bg", project_id: "p_tasks", title: id, description: "<p>Notes</p>", due: null,
  status: "done", is_private: false, hidden_from_client: false, waiting_on_client: false, client_response: null,
  attachments: [], deleted_at: null, recurrence: "none", ...extra,
});

beforeEach(() => resetTables({
  clients: [{ id: "cl_bg", name: "Brian Goodell", share_token: TOKEN, assigned_to: [], linked_contact_id: null, can_request_new_tasks: false, portal_shows_all_tasks: true, deleted_at: null }],
  projects: [{ id: "p_tasks", client_id: "cl_bg", name: "Tasks", position: 0, deleted_at: null, hidden_from_client: false }],
  tasks: [
    ...Array.from({ length: 162 }, (_, i) => task(`t_${i}`, { updated_at: daysAgo(2 + i) })),
    // Edited today, finished in 2024: its finish date wins, so it counts as older.
    task("t_edited", { updated_at: daysAgo(0), completed_at: "2024-01-05T12:00:00Z" }),
    task("t_ancient", { updated_at: daysAgo(500) }),
    task("t_other", { client_id: "cl_someone_else", updated_at: daysAgo(3) }),
    task("t_monthly", { status: "todo", recurrence: "monthly", due: "2026-11-06", updated_at: daysAgo(1) }),
  ],
}));

describe("GET /api/waiting/[token] finished work", () => {
  it("sends all 162 finished in the last 13 months and counts the older ones", async () => {
    const json = await (await GET(new NextRequest(base), ctx)).json();
    const done = json.tasks.filter((t: { status: string }) => t.status === "done");
    expect(done).toHaveLength(162);
    expect(json.olderDone).toBe(2);
    const monthly = json.tasks.find((t: { id: string }) => t.id === "t_monthly");
    expect(monthly.repeat).toBe("Every month");
  });

  it("sends recent ones in full and older ones short", async () => {
    const json = await (await GET(new NextRequest(base), ctx)).json();
    const recent = json.tasks.find((t: { id: string }) => t.id === "t_0");
    const old = json.tasks.find((t: { id: string }) => t.id === "t_100");
    expect(recent.short).toBeUndefined();
    expect(recent.description).toBe("Notes");
    expect(old.short).toBe(true);
    expect(old.description).toBe("");
    const detail = await (await GET(new NextRequest(`${base}?detail=t_100`), ctx)).json();
    expect(detail.task.description).toBe("Notes");
    expect(detail.task.short).toBeUndefined();
  });

  it("never gives the detail of another client's task", async () => {
    const res = await GET(new NextRequest(`${base}?detail=t_other`), ctx);
    expect(res.status).toBe(404);
  });
});

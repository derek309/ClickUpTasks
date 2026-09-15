import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The 30 day Trash purge, against an in-memory fake that applies the filters
// it is given and imitates the database's ON DELETE CASCADE (client takes its
// projects and tasks, project takes its tasks, task takes its documents).
// What matters: nothing live is ever deleted, and review files go with every
// task that is.

type Row = Record<string, any>;
let db: Record<string, Row[]>;
const removedFiles: string[] = [];

function cascade(table: string, ids: string[]) {
  const drop = (t: string, keep: (r: Row) => boolean) => { db[t] = db[t].filter(keep); };
  if (table === "clients") {
    const taskIds = db.tasks.filter((t) => ids.includes(t.client_id)).map((t) => t.id);
    drop("projects", (p) => !ids.includes(p.client_id));
    cascade("tasks", taskIds);
  }
  if (table === "projects") cascade("tasks", db.tasks.filter((t) => ids.includes(t.project_id)).map((t) => t.id));
  if (table === "tasks") drop("task_documents", (d) => !ids.includes(d.task_id));
  drop(table, (r) => !ids.includes(r.id));
}

function builder(table: string) {
  let op: "select" | "delete" = "select";
  const preds: ((r: Row) => boolean)[] = [];
  const b: any = {
    select: () => b,
    delete: () => { op = "delete"; return b; },
    lt: (k: string, v: string) => { preds.push((r) => r[k] != null && r[k] < v); return b; },
    is: (k: string, v: unknown) => { preds.push((r) => (r[k] ?? null) === v); return b; },
    in: (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[k])); return b; },
    limit: () => b,
    then: (resolve: (r: { data: Row[]; error: null }) => unknown) => {
      const hits = db[table].filter((r) => preds.every((p) => p(r))).map((r) => ({ ...r }));
      if (op === "delete") cascade(table, hits.map((h) => h.id));
      return Promise.resolve({ data: hits, error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: string) => builder(t) }, adminConfigured: true }));
vi.mock("./taskDocumentFiles", () => ({ deleteDocStorage: async (id: string) => { removedFiles.push(id); } }));

const { purgeExpiredTrash } = await import("./trashCleanupServer");

const OLD = "2026-01-01T00:00:00.000Z";
const ids = (t: string) => db[t].map((r) => r.id).sort();

beforeEach(() => {
  removedFiles.length = 0;
  const recent = new Date().toISOString();
  db = {
    clients: [
      { id: "cl_gone", deleted_at: OLD },
      { id: "cl_kept", deleted_at: OLD }, // expired, but a task in it was restored
      { id: "cl_live", deleted_at: null },
    ],
    projects: [
      { id: "p_gone", client_id: "cl_gone", deleted_at: OLD },
      { id: "p_kept", client_id: "cl_live", deleted_at: OLD }, // expired, but holds a live task
      { id: "p_in_kept", client_id: "cl_kept", deleted_at: OLD },
    ],
    tasks: [
      { id: "t_gone", client_id: "cl_gone", project_id: "p_gone", deleted_at: OLD },
      { id: "t_live_in_client", client_id: "cl_kept", project_id: "p_in_kept", deleted_at: null },
      { id: "t_live_in_project", client_id: "cl_live", project_id: "p_kept", deleted_at: null },
      { id: "t_alone", client_id: "cl_live", project_id: null, deleted_at: OLD },
      { id: "t_recent", client_id: "cl_live", project_id: null, deleted_at: recent },
    ],
    task_documents: [
      { id: "d_gone", task_id: "t_gone", deleted_at: null },
      { id: "d_alone", task_id: "t_alone", deleted_at: null },
      { id: "d_live", task_id: "t_live_in_client", deleted_at: null },
      { id: "d_trashed", task_id: "t_live_in_project", deleted_at: OLD },
    ],
  };
});

describe("purgeExpiredTrash", () => {
  it("keeps an expired client or project that still holds a live task", async () => {
    const result = await purgeExpiredTrash();
    expect(ids("clients")).toEqual(["cl_kept", "cl_live"]);
    expect(ids("projects")).toEqual(["p_in_kept", "p_kept"]);
    expect(ids("tasks")).toEqual(["t_live_in_client", "t_live_in_project", "t_recent"]);
    expect(result.kept).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it("removes review files for tasks deleted directly or by cascade, and only those", async () => {
    await purgeExpiredTrash();
    expect(removedFiles.sort()).toEqual(["d_alone", "d_gone", "d_trashed"]);
    expect(ids("task_documents")).toEqual(["d_live"]);
  });

  it("leaves trash younger than 30 days alone", async () => {
    await purgeExpiredTrash();
    expect(ids("tasks")).toContain("t_recent");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The 30 day video purge, against an in-memory fake that applies the filters it
// is given. What matters: only videos on reviews approved long enough ago go,
// the rows and comments stay, and the row is marked cleared rather than removed.

type Row = Record<string, any>;
let db: Record<string, Row[]>;
let storageRemoved: string[];
let storageFails = false;

function builder(table: string) {
  let op: "select" | "update" = "select";
  let patch: Row = {};
  const preds: ((r: Row) => boolean)[] = [];
  const b: any = {
    select: () => b,
    update: (p: Row) => { op = "update"; patch = p; return b; },
    eq: (k: string, v: unknown) => { preds.push((r) => r[k] === v); return b; },
    lt: (k: string, v: string) => { preds.push((r) => r[k] != null && r[k] < v); return b; },
    is: (k: string, v: unknown) => { preds.push((r) => (r[k] ?? null) === v); return b; },
    not: (k: string, _op: string, v: unknown) => { preds.push((r) => (r[k] ?? null) !== v); return b; },
    in: (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[k])); return b; },
    limit: () => b,
    then: (resolve: (r: { data: Row[]; error: null }) => unknown) => {
      const hits = db[table].filter((r) => preds.every((p) => p(r)));
      if (op === "update") for (const h of hits) Object.assign(h, patch);
      return Promise.resolve({ data: hits.map((r) => ({ ...r })), error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock("./supabaseAdmin", () => ({
  supabaseAdmin: {
    from: (t: string) => builder(t),
    storage: { from: () => ({ remove: async (paths: string[]) => {
      if (storageFails) return { error: { message: "storage is down" } };
      storageRemoved.push(...paths);
      return { error: null };
    } }) },
  },
  adminConfigured: true,
}));
vi.mock("./db", () => ({ TASK_FILES_BUCKET: "task-files" }));

const { purgeApprovedVideos, storedVideoBytes } = await import("./videoCleanupServer");

const NOW = new Date("2026-09-17T12:00:00.000Z");
const LONG_AGO = "2026-06-01T00:00:00.000Z"; // over 30 days before NOW
const RECENT = "2026-09-10T00:00:00.000Z"; // inside the window

const file = (id: string, doc: string, extra: Row = {}) =>
  ({ id, document_id: doc, path: `doc/${doc}/${id}.mp4`, size_bytes: 1_000_000, purpose: "video", cleared_at: null, removed_at: null, ...extra });

beforeEach(() => {
  storageRemoved = [];
  storageFails = false;
  db = {
    task_documents: [
      { id: "d_old", kind: "video", deleted_at: null, approved_at: LONG_AGO },
      { id: "d_recent", kind: "video", deleted_at: null, approved_at: RECENT },
      { id: "d_never", kind: "video", deleted_at: null, approved_at: null },
      { id: "d_image", kind: "image", deleted_at: null, approved_at: LONG_AGO },
    ],
    task_document_files: [
      file("f_old", "d_old"),
      file("f_recent", "d_recent"),
      file("f_never", "d_never"),
      file("f_image", "d_image", { purpose: "image" }),
    ],
  };
});

describe("purgeApprovedVideos", () => {
  it("clears a video whose review was approved over 30 days ago, and nothing else", async () => {
    const r = await purgeApprovedVideos(NOW);
    expect(r.cleared).toBe(1);
    expect(r.bytesFreed).toBe(1_000_000);
    expect(storageRemoved).toEqual(["doc/d_old/f_old.mp4"]);
    const byId = Object.fromEntries(db.task_document_files.map((f) => [f.id, f]));
    // Cleared, not removed: removed_at would hide the version from the client's
    // list and take the context for its comments with it.
    expect(byId.f_old.cleared_at).toBe(NOW.toISOString());
    expect(byId.f_old.removed_at).toBeNull();
    // Still approved recently, never approved, and not a video: all untouched.
    expect(byId.f_recent.cleared_at).toBeNull();
    expect(byId.f_never.cleared_at).toBeNull();
    expect(byId.f_image.cleared_at).toBeNull();
  });

  it("keeps every row and clears nothing twice", async () => {
    await purgeApprovedVideos(NOW);
    const again = await purgeApprovedVideos(NOW);
    expect(again.cleared).toBe(0);
    expect(storageRemoved).toHaveLength(1);
    expect(db.task_document_files).toHaveLength(4);
  });

  it("leaves the rows alone when storage refuses, so the next run tries again", async () => {
    storageFails = true;
    const r = await purgeApprovedVideos(NOW);
    expect(r.cleared).toBe(0);
    expect(r.errors[0]).toContain("storage is down");
    expect(db.task_document_files.find((f) => f.id === "f_old")!.cleared_at).toBeNull();
  });
});

describe("storedVideoBytes", () => {
  it("counts only video still stored", async () => {
    expect(await storedVideoBytes()).toEqual({ files: 3, bytes: 3_000_000 });
    await purgeApprovedVideos(NOW);
    expect(await storedVideoBytes()).toEqual({ files: 2, bytes: 2_000_000 });
  });
});

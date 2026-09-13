// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The review rules shared by the team routes and Claude over MCP, driven against a
// small fake Supabase that records every call. The document lookups, links, sends
// and version files are stubbed, so each case sees only the service's own logic.

type Call = { table: string; op: "select" | "insert" | "update"; payload?: any; filters: [string, unknown][] };
const calls: Call[] = [];
let result: (c: Call) => { data: unknown; error: { message: string } | null } = () => ({ data: null, error: null });

function builder(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const b: any = {
    select: () => b,
    insert: (p: unknown) => { call.op = "insert"; call.payload = p; return b; },
    update: (p: unknown) => { call.op = "update"; call.payload = p; return b; },
    eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
    is: (k: string, v: unknown) => { call.filters.push([`is:${k}`, v]); return b; },
    gt: (k: string, v: unknown) => { call.filters.push([`gt:${k}`, v]); return b; },
    order: () => b,
    limit: () => b,
    maybeSingle: () => b,
    single: () => b,
    then: (resolve: (r: unknown) => unknown) => { calls.push(call); return Promise.resolve(result(call)).then(resolve); },
  };
  return b;
}

vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: string) => builder(t) }, adminConfigured: true }));
const server = vi.hoisted(() => ({ liveDocument: vi.fn(), linkState: vi.fn(), mintDocLink: vi.fn(), setWorkingFile: vi.fn(), teamSend: vi.fn() }));
vi.mock("./taskDocumentServer", () => server);
const files = vi.hoisted(() => ({ docVersionFile: vi.fn(), recordCheckpoint: vi.fn(), removeVersionFile: vi.fn(), sharedVersionFiles: vi.fn() }));
vi.mock("./taskDocumentFiles", () => files);

const svc = await import("./reviewService");

const actor = (admin = true) => ({ id: "u_claude", memberId: "u_claude", admin, label: async () => "Claude" });
const TASK = { id: "t_1", title: "Hoodie email", client_id: "cl_1", project_id: null, status: "todo" };
const saved = () => ({ data: { id: "tdoc_1" }, error: null });

beforeEach(() => {
  calls.length = 0;
  result = () => ({ data: null, error: null });
  for (const f of [...Object.values(server), ...Object.values(files)]) f.mockReset();
  files.recordCheckpoint.mockResolvedValue(undefined);
  files.sharedVersionFiles.mockResolvedValue([]);
});

describe("createReview", () => {
  it("hands back the review a teammate made at the same moment", async () => {
    server.liveDocument.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "tdoc_winner" });
    result = (c) => (c.op === "insert" ? { data: null, error: { message: "duplicate key" } } : { data: null, error: null });
    expect(await svc.createReview(TASK, "image", actor())).toEqual({ ok: true, document: { id: "tdoc_winner" }, created: false });
    expect(calls.find((c) => c.op === "insert")?.payload).toMatchObject({ task_id: "t_1", kind: "image", created_by: "u_claude" });
  });
});

describe("setReviewStage", () => {
  it("refuses a stage that doesn't exist without touching the review", async () => {
    expect(await svc.setReviewStage("t_1", "doc", actor(), "sent")).toEqual({ ok: false, status: 400, error: "Unknown stage." });
    expect(server.liveDocument).not.toHaveBeenCalled();
  });

  it("clears a client approval for any stage but Approved", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1" });
    result = saved;
    await svc.setReviewStage("t_1", "doc", actor(), "with_client");
    expect(calls[0].payload).toMatchObject({ status: "with_client", approved_at: null, approved_version: null, updated_by: "u_claude" });
    calls.length = 0;
    await svc.setReviewStage("t_1", "doc", actor(), "approved");
    expect(calls[0].payload).not.toHaveProperty("approved_at");
  });
});

describe("writeDocBody", () => {
  it("won't change an approved document", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: "2026-09-01T00:00:00Z", body: "<p>Hi</p>" });
    expect(await svc.writeDocBody("t_1", actor(), { body: "<p>New</p>" })).toMatchObject({ ok: false, status: 409 });
    expect(calls).toHaveLength(0);
  });

  it("cleans the text, and only new text counts as something to send", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: "<p>Hi</p>", updated_by: "u_derek", created_at: "2026-09-01T00:00:00Z" });
    result = saved;
    await svc.writeDocBody("t_1", actor(), { body: "<p>Hi</p>" });
    expect(calls[0].payload).not.toHaveProperty("draft_dirty");
    expect(calls[0].filters).toContainEqual(["is:approved_at", null]);
    calls.length = 0;
    await svc.writeDocBody("t_1", actor(), { body: "<p>New</p><script>steal()</script>" });
    expect(calls[0].payload.draft_dirty).toBe(true);
    expect(calls[0].payload.body).not.toContain("script");
    expect(files.recordCheckpoint).toHaveBeenCalledTimes(2);
  });
});

describe("removeReviewVersion", () => {
  it("moves the review back to the newest version the client can still see", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: "tdf_b" });
    files.removeVersionFile.mockResolvedValue({ ok: true, id: "tdf_b", name: "b.png" });
    files.sharedVersionFiles.mockResolvedValue([{ fileId: "tdf_a", name: "a.png", number: 1, fromClient: false }]);
    result = saved;
    expect((await svc.removeReviewVersion("t_1", "image", actor(), "tdf_b")).ok).toBe(true);
    expect(files.removeVersionFile).toHaveBeenCalledWith("tdoc_1", "tdf_b", "image", { id: "u_claude", label: "Claude" });
    expect(calls[0].payload).toMatchObject({ body: "tdf_a", draft_dirty: false });
  });
});

describe("restoreReview", () => {
  it("waits until the live review of that kind is deleted", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_live" });
    const r = await svc.restoreReview("t_1", "page", actor(), null);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toContain("an HTML review");
  });

  it("says so when nothing was deleted in the last 30 days, else brings back the newest", async () => {
    server.liveDocument.mockResolvedValue(null);
    expect(await svc.restoreReview("t_1", "page", actor(), null)).toMatchObject({ ok: false, status: 404 });
    calls.length = 0;
    result = (c) => (c.op === "select" ? { data: { id: "tdoc_old" }, error: null } : { data: { id: "tdoc_old", deleted_at: null }, error: null });
    expect(await svc.restoreReview("t_1", "page", actor(), null)).toMatchObject({ ok: true, document: { id: "tdoc_old" } });
    const restore = calls.find((c) => c.op === "update")!;
    expect(restore.filters).toEqual(expect.arrayContaining([["id", "tdoc_old"], ["task_id", "t_1"], ["kind", "page"]]));
    expect(restore.payload).toMatchObject({ deleted_at: null, updated_by: "u_claude" });
  });
});

describe("sendReview", () => {
  it("won't turn a link on for someone who isn't an admin, and publishes nothing", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1" });
    server.linkState.mockResolvedValue({ live: false, url: null });
    expect(await svc.sendReview(TASK, "doc", actor(false), 0, "https://app")).toMatchObject({ ok: false, status: 403 });
    expect(server.teamSend).not.toHaveBeenCalled();
  });

  it("publishes, then makes the link on a first send", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1" });
    server.linkState.mockResolvedValue({ live: false, url: null });
    server.teamSend.mockResolvedValue({ ok: true, version: 1 });
    server.mintDocLink.mockResolvedValue("https://app/doc/doc_x");
    expect(await svc.sendReview(TASK, "doc", actor(), 0, "https://app")).toEqual({ ok: true, version: 1, url: "https://app/doc/doc_x", documentId: "tdoc_1" });
    expect(server.mintDocLink).toHaveBeenCalledWith("tdoc_1", TASK, expect.objectContaining({ memberId: "u_claude" }), "https://app");
  });
});

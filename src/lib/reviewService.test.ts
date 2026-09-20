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
const server = vi.hoisted(() => ({ liveDocument: vi.fn(), linkState: vi.fn(), mintDocLink: vi.fn(), setWorkingFile: vi.fn(), teamSend: vi.fn(), appendTaskEvent: vi.fn() }));
vi.mock("./taskDocumentServer", () => server);
const files = vi.hoisted(() => ({ docVersionFile: vi.fn(), recordCheckpoint: vi.fn(), removeVersionFile: vi.fn(), sharedVersionFiles: vi.fn() }));
vi.mock("./taskDocumentFiles", () => files);
const autoName = vi.hoisted(() => ({ nameReviewIfDefault: vi.fn() }));
vi.mock("./reviewAutoName", () => autoName);

const svc = await import("./reviewService");

const actor = (admin = true) => ({ id: "u_claude", memberId: "u_claude", admin, label: async () => "Claude" });
const TASK = { id: "t_1", title: "Hoodie email", client_id: "cl_1", project_id: null, status: "todo" };
const saved = () => ({ data: { id: "tdoc_1" }, error: null });

beforeEach(() => {
  calls.length = 0;
  result = () => ({ data: null, error: null });
  for (const f of [...Object.values(server), ...Object.values(files), ...Object.values(autoName)]) f.mockReset();
  autoName.nameReviewIfDefault.mockResolvedValue(null);
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

  it("clears an approval for any stage but Approved", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, version: 3 });
    result = saved;
    await svc.setReviewStage("t_1", "doc", actor(), "with_client");
    expect(calls[0].payload).toMatchObject({ status: "with_client", approved_at: null, approved_version: null, approved_by: null, updated_by: "u_claude" });
  });

  it("really approves when the team picks Approved, and says who did it", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, version: 3 });
    result = saved;
    await svc.setReviewStage("t_1", "doc", actor(), "approved");
    // Not the status alone: the client's page reads approved_at, so setting one
    // without the other left the two sides disagreeing (Derek, 2026-09-17).
    expect(calls[0].payload).toMatchObject({ status: "approved", approved_version: 3, approved_by: "u_claude" });
    expect(typeof calls[0].payload.approved_at).toBe("string");
    // And on the task's own record, so the Finished feed can find it later.
    expect(server.appendTaskEvent).toHaveBeenCalledWith("t_1", "approved the client document for the client (version 3)", "u_claude");
  });

  it("leaves the client's own approval alone when the team picks Approved after them", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: "2026-09-01T00:00:00Z", version: 3 });
    result = saved;
    await svc.setReviewStage("t_1", "doc", actor(), "approved");
    // approved_by stays null: the client clicked Approve, and nothing should
    // rewrite that into the team having done it.
    expect(calls[0].payload).not.toHaveProperty("approved_at");
    expect(calls[0].payload).not.toHaveProperty("approved_by");
    expect(calls[0].payload).toMatchObject({ status: "approved" });
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

  it("hands back the name the AI gave a document on its first words", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: "", updated_by: null, created_at: "2026-09-01T00:00:00Z" });
    result = () => ({ data: { id: "tdoc_1", title: "", ai_named_at: null }, error: null });
    autoName.nameReviewIfDefault.mockResolvedValue({ id: "tdoc_1", title: "Fall Open House Flyer" });
    expect(await svc.writeDocBody("t_1", actor(), { body: "<p>Words</p>" })).toEqual({ ok: true, document: { id: "tdoc_1", title: "Fall Open House Flyer" } });
    expect(autoName.nameReviewIfDefault).toHaveBeenCalledWith({ id: "tdoc_1", title: "", ai_named_at: null }, { kind: "doc", html: "<p>Words</p>" });
  });
});

describe("pickReviewVersion", () => {
  const A = "tdf_00000001-0000-0000-0000-000000000000";
  const B = "tdf_00000002-0000-0000-0000-000000000000";
  const file = (id: string, name: string) => ({ id, name, path: `doc/tdoc_1/${name}`, purpose: "image" });

  it("names an image review from the image it was given", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: "" });
    files.docVersionFile.mockResolvedValue(file(A, "flyer.png"));
    server.setWorkingFile.mockResolvedValue({ id: "tdoc_1", body: A, title: "" });
    await svc.pickReviewVersion("t_1", "image", actor(), { file: A });
    expect(server.setWorkingFile).toHaveBeenCalledWith("tdoc_1", A, "", expect.any(Object));
    expect(autoName.nameReviewIfDefault).toHaveBeenCalledWith({ id: "tdoc_1", body: A, title: "" }, { kind: "image", path: "doc/tdoc_1/flyer.png", fileName: "flyer.png" });
  });

  it("keeps a postcard's front and back as one version, labels and order included", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: "" });
    files.docVersionFile.mockImplementation(async (_doc: string, id: string) => file(id, id === A ? "front.png" : "back.png"));
    server.setWorkingFile.mockResolvedValue({ id: "tdoc_1" });
    expect((await svc.pickReviewVersion("t_1", "image", actor(), { images: [{ file: A, label: "" }, { file: B, label: "Inside" }] })).ok).toBe(true);
    expect(server.setWorkingFile).toHaveBeenCalledWith("tdoc_1", `[{"file":"${A}","label":""},{"file":"${B}","label":"Inside"}]`, "", expect.any(Object));
  });

  it("refuses a set with an image that isn't on the review, or too many", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: "" });
    files.docVersionFile.mockImplementation(async (_doc: string, id: string) => (id === A ? file(A, "front.png") : null));
    expect(await svc.pickReviewVersion("t_1", "image", actor(), { images: [{ file: A }, { file: B }] })).toMatchObject({ ok: false, status: 400 });
    const eleven = Array.from({ length: 11 }, (_, i) => ({ file: `tdf_${String(i).padStart(8, "0")}-0000-0000-0000-000000000000` }));
    expect(await svc.pickReviewVersion("t_1", "image", actor(), { images: eleven })).toMatchObject({ ok: false, status: 400 });
    expect(server.setWorkingFile).not.toHaveBeenCalled();
  });
});

describe("removeReviewVersion", () => {
  const A = "tdf_00000001-0000-0000-0000-000000000000";
  const B = "tdf_00000002-0000-0000-0000-000000000000";
  const C = "tdf_00000003-0000-0000-0000-000000000000";
  const set = (...ids: string[]) => JSON.stringify(ids.map((file) => ({ file, label: "" })));

  it("moves the review back to the newest version the client can still see", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: B });
    files.removeVersionFile.mockResolvedValue({ ok: true, id: B, name: "b.png" });
    files.sharedVersionFiles.mockResolvedValue([{ body: A, fileId: A, name: "a.png", number: 1, fromClient: false, images: [] }]);
    result = (c) => (c.table === "task_document_versions" ? { data: [{ body: A }, { body: B }], error: null } : saved());
    expect((await svc.removeReviewVersion("t_1", "image", actor(), B)).ok).toBe(true);
    expect(files.removeVersionFile).toHaveBeenCalledWith("tdoc_1", B, "image", { id: "u_claude", label: "Claude" });
    expect(calls.find((c) => c.op === "update")!.payload).toMatchObject({ body: A, draft_dirty: false });
  });

  it("keeps a front carried into another version and takes off only the new back", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: set(A, C) });
    files.removeVersionFile.mockResolvedValue({ ok: true, id: C, name: "c.png" });
    files.sharedVersionFiles.mockResolvedValue([{ body: set(A, B), fileId: A, name: "a.png", number: 1, fromClient: false, images: [] }]);
    result = (c) => (c.table === "task_document_versions" ? { data: [{ body: set(A, B) }, { body: set(A, C) }], error: null } : saved());
    expect((await svc.removeReviewVersion("t_1", "image", actor(), set(A, C))).ok).toBe(true);
    expect(files.removeVersionFile).toHaveBeenCalledTimes(1);
    expect(files.removeVersionFile).toHaveBeenCalledWith("tdoc_1", C, "image", expect.any(Object));
    expect(calls.find((c) => c.op === "update")!.payload).toMatchObject({ body: set(A, B), draft_dirty: false });
  });

  it("refuses a version made only of images other versions use", async () => {
    server.liveDocument.mockResolvedValue({ id: "tdoc_1", approved_at: null, body: set(A, B) });
    result = (c) => (c.table === "task_document_versions" ? { data: [{ body: set(A, B) }, { body: set(B, A) }], error: null } : saved());
    expect(await svc.removeReviewVersion("t_1", "image", actor(), set(B, A))).toMatchObject({ ok: false, status: 400 });
    expect(files.removeVersionFile).not.toHaveBeenCalled();
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

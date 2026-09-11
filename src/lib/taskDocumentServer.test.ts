import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The client review document's server logic, driven against a small fake
// Supabase that answers by table, records every write and rpc in order, and
// never touches a network. The cases that matter are every way a link must NOT
// open, and the order of writes when a client publishes.

type Call = { table: string; op: "select" | "insert" | "update" | "upsert"; cols?: string; filters: [string, unknown][]; payload?: unknown; wantsRows?: boolean };
const calls: Call[] = [];
const log: string[] = [];
const rpcCalls: { name: string; args: any }[] = [];
let answer: (c: Call) => unknown = () => null;
let rpcAnswer: (name: string, args: any) => unknown = () => null;

function builder(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const b: any = {
    select: (cols?: string) => { if (call.op === "select") call.cols = cols; else call.wantsRows = true; return b; },
    insert: (p: unknown) => { call.op = "insert"; call.payload = p; return b; },
    update: (p: unknown) => { call.op = "update"; call.payload = p; return b; },
    upsert: (p: unknown) => { call.op = "upsert"; call.payload = p; return b; },
    eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
    is: (k: string, v: unknown) => { call.filters.push([`is:${k}`, v]); return b; },
    or: (e: string) => { call.filters.push(["or", e]); return b; },
    order: () => b,
    limit: () => b,
    maybeSingle: () => b,
    single: () => b,
    then: (resolve: (r: { data: unknown; error: null }) => unknown) => {
      calls.push(call);
      if (call.op !== "select") log.push(`${call.op}:${table}`);
      return Promise.resolve({ data: answer(call), error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock("./supabaseAdmin", () => ({
  supabaseAdmin: {
    from: (t: string) => builder(t),
    rpc: (name: string, args: any) => {
      rpcCalls.push({ name, args });
      log.push(`rpc:${name}`);
      return Promise.resolve({ data: rpcAnswer(name, args), error: null });
    },
  },
  adminConfigured: true,
}));
const notify = vi.fn();
vi.mock("./waitingNotify", () => ({
  resolveNotifyRecipient: async () => "u_follower",
  notifyTeamOfClientActivity: (...args: unknown[]) => notify(...args),
}));
vi.mock("./serverAuth", () => ({ requireUser: async () => null, callerCanSeeTask: async () => false }));
vi.mock("./taskDocumentFiles", () => ({ shareTeamFiles: async () => {} }));

const { resolveDocToken, clientPublish } = await import("./taskDocumentServer");
const { mintToken, hashToken } = await import("./tokenCrypto");
const { todayIso } = await import("./data");

const TOKEN = mintToken("doc_").raw;

type World = { link?: any; task?: any; client?: any; project?: any; doc?: any; claim?: unknown[] };
const goodWorld = (): World => ({
  link: { document_id: "tdoc_1", bound_task_id: "t_1", bound_client_id: "cl_1", revoked_at: null, expires_at: null },
  task: { id: "t_1", title: "Hoodie email", status: "waiting", waiting_on_client: true, assignee_id: "u_owner", project_id: "p_1", client_id: "cl_1", is_private: false, deleted_at: null },
  client: { id: "cl_1", name: "Brian Goodell", assigned_to: ["u_follower"], deleted_at: null },
  project: { id: "p_1", deleted_at: null },
  doc: { id: "tdoc_1", task_id: "t_1" },
});

function setWorld(w: World) {
  calls.length = 0;
  log.length = 0;
  rpcCalls.length = 0;
  notify.mockClear();
  answer = (c) => {
    if (c.op !== "select") return c.wantsRows ? (w.claim ?? [{ id: "tdoc_1" }]) : null;
    if (c.table === "task_document_links") return w.link ?? null;
    if (c.table === "tasks") return w.task ?? null;
    if (c.table === "clients") return w.client ?? null;
    if (c.table === "projects") return w.project ?? null;
    if (c.table === "task_documents") return w.doc ?? null;
    if (c.table === "task_document_versions") return { version: 3, body: "<p>Latest</p>" };
    return null;
  };
  rpcAnswer = () => null;
}

describe("resolveDocToken", () => {
  beforeEach(() => setWorld(goodWorld()));

  it("refuses a malformed token without touching the database", async () => {
    expect(await resolveDocToken("doc_short")).toBeNull();
    expect(await resolveDocToken("cut_" + "a".repeat(43))).toBeNull();
    expect(calls).toEqual([]);
  });

  it("looks the link up by the token's hash, never the token itself", async () => {
    await resolveDocToken(TOKEN);
    const lookup = calls.find((c) => c.table === "task_document_links");
    expect(lookup?.filters).toContainEqual(["token_hash", hashToken(TOKEN)]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it("opens the one task a good link is bound to", async () => {
    expect(await resolveDocToken(TOKEN)).toMatchObject({
      documentId: "tdoc_1", taskId: "t_1", taskTitle: "Hoodie email", clientId: "cl_1", clientName: "Brian Goodell",
      assigneeId: "u_owner", waitingOnClient: true, assignedTo: ["u_follower"],
    });
  });

  const withChange = (change: (w: World) => void): World => { const w = goodWorld(); change(w); return w; };
  it.each([
    ["an unknown link", withChange((w) => { w.link = null; })],
    ["a link switched off", withChange((w) => { w.link.revoked_at = "2026-09-10T00:00:00Z"; })],
    ["an expired link", withChange((w) => { w.link.expires_at = "2020-01-01T00:00:00Z"; })],
    ["a private task", withChange((w) => { w.task.is_private = true; })],
    ["a task in the trash", withChange((w) => { w.task.deleted_at = "2026-09-10T00:00:00Z"; })],
    ["a task moved to another client", withChange((w) => { w.task.client_id = "cl_other"; })],
    ["the Personal client", withChange((w) => { w.task.client_id = "personal"; w.link.bound_client_id = "personal"; })],
    ["a client in the trash", withChange((w) => { w.client.deleted_at = "2026-09-10T00:00:00Z"; })],
    ["a list in the trash", withChange((w) => { w.project.deleted_at = "2026-09-10T00:00:00Z"; })],
    ["a document that is no longer on that task", withChange((w) => { w.doc.task_id = "t_other"; })],
  ])("will not open for %s", async (_label, w) => {
    setWorld(w);
    expect(await resolveDocToken(TOKEN)).toBeNull();
  });
});

const scope = {
  documentId: "tdoc_1", taskId: "t_1", taskTitle: "Hoodie email", taskStatus: "waiting", waitingOnClient: true,
  assigneeId: "u_owner" as string | null, projectId: "p_1", clientId: "cl_1", clientName: "Brian Goodell", assignedTo: ["u_follower"],
};

describe("clientPublish", () => {
  beforeEach(() => {
    setWorld(goodWorld());
    rpcAnswer = (name) => (name === "publish_task_document_version" ? 4 : null);
  });

  it("refuses a closed task and writes nothing", async () => {
    const r = await clientPublish({ ...scope, taskStatus: "done" }, "client_submitted", "<p>x</p>", 3);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(log).toEqual([]);
  });

  it("refuses an empty document and a malformed request", async () => {
    expect(await clientPublish(scope, "client_submitted", "<p> </p>", 3)).toMatchObject({ ok: false, status: 400 });
    expect(await clientPublish(scope, "client_submitted", 42, 3)).toMatchObject({ ok: false, status: 400 });
    expect(await clientPublish(scope, "client_submitted", "<p>x</p>", "3")).toMatchObject({ ok: false, status: 400 });
    expect(log).toEqual([]);
  });

  it("cleans the HTML and publishes on the version the client started from", async () => {
    await clientPublish(scope, "client_submitted", "<p>Hi<script>alert(1)</script></p>", 3);
    const publish = rpcCalls.find((c) => c.name === "publish_task_document_version");
    expect(publish?.args).toMatchObject({ p_document_id: "tdoc_1", p_base_version: 3, p_kind: "client_submitted", p_body: "<p>Hi</p>", p_author_id: null, p_author_label: "Brian Goodell" });
  });

  it("returns 409 with the current version when the team published first, and does not touch the task", async () => {
    rpcAnswer = () => -1;
    const r = await clientPublish(scope, "client_submitted", "<p>mine</p>", 2);
    expect(r).toMatchObject({ ok: false, status: 409, current: { version: 3, body: "<p>Latest</p>" } });
    expect(log).not.toContain("update:tasks");
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns 409 when the document is already approved", async () => {
    rpcAnswer = () => -2;
    const r = await clientPublish(scope, "client_approved", "<p>mine</p>", 3);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.ok ? "" : r.error).toMatch(/approved/i);
  });

  it("logs the event on the task before updating it, and clears updated_by so the team sees it live", async () => {
    const r = await clientPublish(scope, "client_submitted", "<p>mine</p>", 3);
    expect(r).toEqual({ ok: true, version: 4 });
    const append = log.indexOf("rpc:append_comment");
    const update = log.indexOf("update:tasks");
    expect(append).toBeGreaterThan(-1);
    expect(append).toBeLessThan(update);
    const comment = rpcCalls.find((c) => c.name === "append_comment")?.args.comment;
    expect(comment).toMatchObject({ kind: "event", authorId: "client" });
    const taskUpdate = calls.find((c) => c.table === "tasks" && c.op === "update");
    expect(taskUpdate?.payload).toEqual({ status: "review", waiting_on_client: false, due: todayIso(), updated_by: null });
  });

  it("moves the task to Approved (not Done) and always emails the owner on approval", async () => {
    setWorld({ ...goodWorld(), claim: [] });
    rpcAnswer = (name) => (name === "publish_task_document_version" ? 4 : null);
    await clientPublish(scope, "client_approved", "<p>ok</p>", 3);
    const taskUpdate = calls.find((c) => c.table === "tasks" && c.op === "update");
    expect((taskUpdate?.payload as any).status).toBe("approved");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ notifyRecipient: "u_owner" });
    expect((notify.mock.calls[0][0] as any).subject).toMatch(/approved/);
    expect(log).not.toContain("update:task_documents");
  });

  it("emails about sent changes only when it wins the cooldown claim", async () => {
    setWorld({ ...goodWorld(), claim: [] });
    rpcAnswer = (name) => (name === "publish_task_document_version" ? 4 : null);
    await clientPublish(scope, "client_submitted", "<p>again</p>", 3);
    expect(notify).not.toHaveBeenCalled();

    setWorld({ ...goodWorld(), claim: [{ id: "tdoc_1" }] });
    rpcAnswer = (name) => (name === "publish_task_document_version" ? 5 : null);
    await clientPublish(scope, "client_submitted", "<p>again</p>", 4);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("tells the client's follower when the task has no owner", async () => {
    await clientPublish({ ...scope, assigneeId: null }, "client_approved", "<p>ok</p>", 3);
    expect(notify.mock.calls[0][0]).toMatchObject({ notifyRecipient: "u_follower" });
  });
});

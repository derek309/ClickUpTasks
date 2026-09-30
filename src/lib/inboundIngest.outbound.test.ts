import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// A reply sent straight from Gmail should land where the work is (Derek,
// 2026-09-11: "I reply to emails in gmail, connect those to a task"). These
// tests drive ingestOutboundMessage against a small fake Supabase that answers
// the handful of queries it makes and records every write.

type Call = { table: string; op: "select" | "insert" | "update"; cols?: string; filters: [string, unknown][]; payload?: unknown };
const calls: Call[] = [];
let answer: (c: Call) => unknown = () => [];

function builder(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const b: any = {
    select: (cols: string) => { call.cols = cols; return b; },
    insert: (payload: unknown) => { call.op = "insert"; call.payload = payload; return b; },
    update: (payload: unknown) => { call.op = "update"; call.payload = payload; return b; },
    eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
    neq: (k: string, v: unknown) => { call.filters.push([`neq:${k}`, v]); return b; },
    not: (k: string, _o: string, v: unknown) => { call.filters.push([`not:${k}`, v]); return b; },
    or: (expr: string) => { call.filters.push(["or", expr]); return b; },
    contains: (k: string, v: unknown) => { call.filters.push([`contains:${k}`, v]); return b; },
    order: () => b,
    limit: () => b,
    maybeSingle: () => b,
    then: (resolve: (r: { data: unknown; error: null }) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: call.op === "select" ? answer(call) : null, error: null }).then(resolve);
    },
  };
  return b;
}

const rpcs: { fn: string; args: any }[] = [];
vi.mock("./supabaseAdmin", () => ({
  supabaseAdmin: { from: (t: string) => builder(t), rpc: (fn: string, args: unknown) => { rpcs.push({ fn, args }); return Promise.resolve({ error: null }); } },
  adminConfigured: true,
}));

const { ingestOutboundMessage, ingestInboundMessage } = await import("./inboundIngest");

const has = (c: Call, key: string) => c.filters.some(([k]) => k === key);
const baseOpts = {
  // client_id is the GHL sub-account; the tracked client lookup below resolves
  // it to a different id, which returns early and keeps the fake small.
  contact: { id: "abc123", name: "Brian Goodell", client_id: "sub_account" },
  channel: "email" as const, subject: "Re: Bulk Customers", body: "Sounds good, sending Monday.",
  gmailMessageId: "gm_1", gmailThreadId: "th_1", createdBy: "u_derek", at: "2026-09-11T15:00:00Z",
};

type TaskRow = { title: string; priority: string; status: string };
function setup(o: { threadTask?: string | null; conversationTask?: string | null; alreadyIngested?: boolean; tasks?: Record<string, TaskRow>; lastInbound?: string }) {
  calls.length = 0;
  rpcs.length = 0;
  answer = (c) => {
    if (c.table === "tasks" && has(c, "id")) return o.tasks?.[c.filters.find(([k]) => k === "id")![1] as string] ?? null;
    if (c.table === "messages" && c.cols === "created_at") return o.lastInbound ? [{ created_at: o.lastInbound }] : [];
    if (c.table === "clients") return [{ id: "cl_tracked" }];
    if (c.table === "messages" && has(c, "gmail_message_id")) return o.alreadyIngested ? [{ id: "m_old" }] : [];
    if (c.table === "messages" && c.cols === "body, created_at") return [];
    if (c.table === "messages" && has(c, "gmail_thread_id")) return o.threadTask ? [{ task_id: o.threadTask }] : [];
    if (c.table === "tasks" && has(c, "priority")) return o.conversationTask ? [{ id: o.conversationTask }] : [];
    return [];
  };
}
const inserted = () => calls.find((c) => c.table === "messages" && c.op === "insert")?.payload as Record<string, unknown> | undefined;
const taskWrites = () => calls.filter((c) => c.table === "tasks" && c.op !== "select");

describe("a reply sent from Gmail lands on a task", () => {
  beforeEach(() => setup({}));

  it("goes to the task its thread already belongs to, ahead of the Reply to task", async () => {
    setup({ threadTask: "t_thread", conversationTask: "t_conv" });
    expect(await ingestOutboundMessage(baseOpts)).toBe(true);
    expect(inserted()?.task_id).toBe("t_thread");
    expect(inserted()?.client_id).toBe("cl_tracked");
  });

  it("falls back to the contact's open Reply to task when the thread is new", async () => {
    setup({ threadTask: null, conversationTask: "t_conv" });
    await ingestOutboundMessage(baseOpts);
    expect(inserted()?.task_id).toBe("t_conv");
  });

  it("uses the Reply to task when Gmail gave no thread id", async () => {
    setup({ conversationTask: "t_conv" });
    await ingestOutboundMessage({ ...baseOpts, gmailThreadId: null });
    expect(calls.some((c) => c.table === "messages" && has(c, "gmail_thread_id"))).toBe(false);
    expect(inserted()?.task_id).toBe("t_conv");
  });

  it("is still logged on the client with no task when neither exists, and never makes one", async () => {
    setup({ threadTask: null, conversationTask: null });
    expect(await ingestOutboundMessage(baseOpts)).toBe(true);
    expect(inserted()?.task_id).toBeNull();
    expect(taskWrites()).toEqual([]);
  });

  it("leaves the task alone: no due date bump, no stage change", async () => {
    setup({ threadTask: "t_thread" });
    await ingestOutboundMessage(baseOpts);
    expect(taskWrites()).toEqual([]);
  });

  it("skips an email that was already ingested", async () => {
    setup({ alreadyIngested: true, threadTask: "t_thread" });
    expect(await ingestOutboundMessage(baseOpts)).toBe(false);
    expect(inserted()).toBeUndefined();
  });
});

const replyTask = (status = "todo"): TaskRow => ({ title: "Reply to Brian Goodell", priority: "conversation", status });
const closes = () => taskWrites().filter((c) => (c.payload as { status?: string }).status === "done");

// Derek, 2026-09-30: the reply tasks are "useful but also creating noise",
// because the email is answered in Gmail and the task stays open regardless.
describe("answering from Gmail closes the Reply to task", () => {
  it("closes it, says why in its activity, and clears the unread reply", async () => {
    setup({ conversationTask: "t_conv", tasks: { t_conv: replyTask() }, lastInbound: "2026-09-11T14:00:00Z" });
    await ingestOutboundMessage(baseOpts);
    expect(closes().map((c) => c.filters)).toEqual([[["id", "t_conv"]]]);
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].args.comment).toMatchObject({ authorId: "u_derek", kind: "event", body: "answered by email, which closed this task" });
    expect(calls.some((c) => c.table === "notifications" && c.op === "update" && has(c, "task_id"))).toBe(true);
  });

  it("does not close it for a sent email older than the client's last message", async () => {
    setup({ conversationTask: "t_conv", tasks: { t_conv: replyTask() }, lastInbound: "2026-09-11T16:00:00Z" });
    await ingestOutboundMessage(baseOpts);
    expect(inserted()?.task_id).toBe("t_conv");
    expect(taskWrites()).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it("never closes an ordinary task, or a meeting, that the thread belongs to", async () => {
    for (const row of [{ title: "Build the homepage", priority: "normal", status: "todo" }, { title: "Meeting with Brian Goodell", priority: "conversation", status: "todo" }]) {
      setup({ threadTask: "t_thread", tasks: { t_thread: row } });
      await ingestOutboundMessage(baseOpts);
      expect(taskWrites()).toEqual([]);
    }
  });

  it("files a reply on the open Reply to task when the thread's own one has closed", async () => {
    setup({ threadTask: "t_old", conversationTask: "t_conv", tasks: { t_old: replyTask("done"), t_conv: replyTask() } });
    await ingestOutboundMessage(baseOpts);
    expect(inserted()?.task_id).toBe("t_conv");
  });
});

describe("a client's next message after the Reply to task closed", () => {
  const inbound = { contact: baseOpts.contact, channel: "email" as const, subject: "Re: Bulk Customers", body: "One more thing", gmailMessageId: "gm_2", gmailThreadId: "th_1" };
  const newTasks = () => calls.filter((c) => c.table === "tasks" && c.op === "insert");

  it("raises a fresh Reply to task instead of landing on the closed one", async () => {
    setup({ threadTask: "t_old", tasks: { t_old: replyTask("done") } });
    expect(await ingestInboundMessage(inbound)).toBe(true);
    expect(newTasks()).toHaveLength(1);
    expect(newTasks()[0].payload).toMatchObject({ title: "Reply to Brian Goodell", priority: "conversation" });
    expect(taskWrites().some((c) => c.op === "update" && c.filters.some(([k, v]) => k === "id" && v === "t_old"))).toBe(false);
  });

  it("still lands on an ordinary task the thread belongs to, finished or not", async () => {
    setup({ threadTask: "t_thread", tasks: { t_thread: { title: "Build the homepage", priority: "normal", status: "done" } } });
    await ingestInboundMessage(inbound);
    expect(newTasks()).toEqual([]);
    expect(taskWrites().map((c) => c.filters)).toEqual([[["id", "t_thread"]]]);
  });
});

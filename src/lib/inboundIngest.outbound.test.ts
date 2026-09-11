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

vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: string) => builder(t) }, adminConfigured: true }));

const { ingestOutboundMessage } = await import("./inboundIngest");

const has = (c: Call, key: string) => c.filters.some(([k]) => k === key);
const baseOpts = {
  // client_id is the GHL sub-account; the tracked client lookup below resolves
  // it to a different id, which returns early and keeps the fake small.
  contact: { id: "abc123", name: "Brian Goodell", client_id: "sub_account" },
  channel: "email" as const, subject: "Re: Bulk Customers", body: "Sounds good, sending Monday.",
  gmailMessageId: "gm_1", gmailThreadId: "th_1", createdBy: "u_derek", at: "2026-09-11T15:00:00Z",
};

function setup(o: { threadTask?: string | null; conversationTask?: string | null; alreadyIngested?: boolean }) {
  calls.length = 0;
  answer = (c) => {
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

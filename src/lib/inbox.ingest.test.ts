import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The Inbox (Derek, 2026-10-01): strangers' email is kept for the teammate
// whose Gmail it is in, every row says whose mailbox it came from, and with
// INBOX_REPLY_TASKS=off a message no longer makes a "Reply to X" task.
// Same small fake Supabase as inboundIngest.outbound.test.ts.

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
    is: (k: string, v: unknown) => { call.filters.push([`is:${k}`, v]); return b; },
    gt: (k: string, v: unknown) => { call.filters.push([`gt:${k}`, v]); return b; },
    gte: (k: string, v: unknown) => { call.filters.push([`gte:${k}`, v]); return b; },
    lte: (k: string, v: unknown) => { call.filters.push([`lte:${k}`, v]); return b; },
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

const { ingestStrangerEmail, ingestInboundMessage } = await import("./inboundIngest");
const { threadKeyOf, raiseReplyTasks } = await import("./inbox");

const has = (c: Call, key: string) => c.filters.some(([k]) => k === key);
const val = (c: Call, key: string) => c.filters.find(([k]) => k === key)?.[1];
function setup(o: { dupe?: boolean; threadTask?: string | null } = {}) {
  calls.length = 0;
  answer = (c) => {
    if (c.table === "messages" && has(c, "gmail_message_id")) return o.dupe ? [{ id: "m_old" }] : [];
    if (c.table === "messages" && has(c, "gmail_thread_id")) return o.threadTask ? [{ task_id: o.threadTask }] : [];
    if (c.table === "clients") return [{ id: "cl_tracked" }];
    return [];
  };
}
const inserts = (table: string) => calls.filter((c) => c.table === table && c.op === "insert").map((c) => c.payload as any);
const stranger = {
  mailboxMemberId: "u_derek", direction: "inbound" as const, peerName: "Dale Summers", peerAddress: "Hello@SummitRoofing.co",
  subject: "Website quote", body: "What would a new site cost?", gmailMessageId: "gm_9", gmailThreadId: "th_9", at: "2026-10-01T16:20:00Z",
};

describe("an email from someone who is not a contact yet", () => {
  beforeEach(() => setup());

  it("is kept for that teammate's Inbox, with no client and no task", async () => {
    expect(await ingestStrangerEmail(stranger)).toBe(true);
    const row = inserts("messages")[0];
    expect(row.contact_id).toBeNull();
    expect(row.client_id).toBeNull();
    expect(row.task_id).toBeNull();
    expect(row.mailbox_member_id).toBe("u_derek");
    expect(row.peer_address).toBe("hello@summitroofing.co");
    expect(row.peer_name).toBe("Dale Summers");
    expect(row.read).toBe(false);
  });

  it("keeps collecting on the task its conversation was linked to", async () => {
    setup({ threadTask: "t_quote" });
    await ingestStrangerEmail(stranger);
    expect(inserts("messages")[0].task_id).toBe("t_quote");
    const lookup = calls.find((c) => c.table === "messages" && has(c, "gmail_thread_id"))!;
    expect(val(lookup, "mailbox_member_id")).toBe("u_derek");
  });

  it("is stored once, however often the poll sees it", async () => {
    setup({ dupe: true });
    expect(await ingestStrangerEmail(stranger)).toBe(false);
    expect(inserts("messages")).toEqual([]);
  });

  it("rings nothing and makes no task", async () => {
    await ingestStrangerEmail(stranger);
    expect(inserts("notifications")).toEqual([]);
    expect(inserts("tasks")).toEqual([]);
  });
});

describe("a client's email with reply tasks switched off", () => {
  const contactMail = {
    contact: { id: "abc123", name: "Pam Macias", client_id: "sub_account" }, channel: "email" as const,
    subject: "Booking page photos", body: "Here are the headshots.", gmailMessageId: "gm_1", gmailThreadId: "th_1",
    at: "2026-10-01T17:12:00Z", mailboxMemberId: "u_derek", fromName: "Pam Macias", fromAddress: "pam@example.com",
  };
  afterEach(() => { delete process.env.INBOX_REPLY_TASKS; });

  it("says whose mailbox it came into", async () => {
    setup();
    await ingestInboundMessage(contactMail);
    expect(inserts("messages")[0].mailbox_member_id).toBe("u_derek");
  });

  it("makes no Reply to task and rings no bell when its thread is on no task", async () => {
    process.env.INBOX_REPLY_TASKS = "off";
    setup();
    expect(await ingestInboundMessage(contactMail)).toBe(true);
    expect(inserts("tasks")).toEqual([]);
    expect(inserts("notifications")).toEqual([]);
  });

  it("still lands on the task its thread is linked to", async () => {
    process.env.INBOX_REPLY_TASKS = "off";
    setup({ threadTask: "t_booking" });
    await ingestInboundMessage(contactMail);
    const bind = calls.find((c) => c.table === "messages" && c.op === "update" && (c.payload as any)?.task_id);
    expect((bind?.payload as any)?.task_id).toBe("t_booking");
  });

  it("is on until the switch says off", () => {
    expect(raiseReplyTasks()).toBe(true);
    process.env.INBOX_REPLY_TASKS = " Off ";
    expect(raiseReplyTasks()).toBe(false);
  });
});

describe("threadKeyOf", () => {
  const base = { id: "m1", channel: "email" as const, taskId: null, gmailThreadId: null, ghlConversationId: null };
  it("groups a Gmail thread, a GoHighLevel conversation and a task chat", () => {
    expect(threadKeyOf({ ...base, gmailThreadId: "th" })).toBe("gm:th");
    expect(threadKeyOf({ ...base, channel: "sms", ghlConversationId: "cv" })).toBe("ghl:cv");
    expect(threadKeyOf({ ...base, channel: "chat", taskId: "t1" })).toBe("chat:t1");
    expect(threadKeyOf(base)).toBe("msg:m1");
  });
});

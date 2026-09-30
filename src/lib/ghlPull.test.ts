import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The GoHighLevel pull, against a fake Supabase that answers its queries and
// records its writes, and a fake GoHighLevel API behind fetch.

type Call = { table: string; op: "select" | "insert" | "update"; cols?: string; filters: [string, unknown][]; payload?: any };
const calls: Call[] = [];
let answer: (c: Call) => unknown = () => [];

function builder(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const push = (k: string) => (a: unknown, b2?: unknown, c3?: unknown) => { call.filters.push([k === "not" ? `not:${a}` : k === "eq" ? String(a) : `${k}:${a}`, c3 ?? b2]); return b; };
  const b: any = {
    select: (cols: string) => { call.cols = cols; return b; },
    insert: (payload: unknown) => { call.op = "insert"; call.payload = payload; return b; },
    update: (payload: unknown) => { call.op = "update"; call.payload = payload; return b; },
    eq: push("eq"), neq: push("neq"), not: push("not"), is: push("is"), in: push("in"), gte: push("gte"), lte: push("lte"),
    or: (expr: string) => { call.filters.push(["or", expr]); return b; },
    order: () => b, limit: () => b, maybeSingle: () => b,
    then: (resolve: (r: { data: unknown; error: null }) => unknown) => {
      calls.push(call);
      const data = call.op === "insert" ? null : answer(call);
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: string) => builder(t) }, adminConfigured: true }));
vi.mock("./ghlTokens", () => ({ tokenForLocation: async () => "pit-test" }));
const upsertConversationTask = vi.fn(async () => "t_new");
const closeAnsweredReplyTask = vi.fn(async () => true);
const closedTasks = new Set<string>();
vi.mock("./ghlConversationTask", () => ({
  upsertConversationTask: (...a: any[]) => (upsertConversationTask as any)(...a),
  closeAnsweredReplyTask: (...a: any[]) => (closeAnsweredReplyTask as any)(...a),
  isClosedReplyTask: async (id: string) => closedTasks.has(id),
  resolveOrPromoteTrackedClient: async (c: any) => c.client_id,
}));
const notifyInbound = vi.fn(async () => ["u_derek"]);
const sendInboundReplyEmail = vi.fn(async () => {});
vi.mock("./inboundIngest", () => ({
  notifyInbound: (...a: any[]) => (notifyInbound as any)(...a),
  sendInboundReplyEmail: (...a: any[]) => (sendInboundReplyEmail as any)(...a),
}));
const clientAnsweredOnTask = vi.fn(async () => {});
vi.mock("./clientAnswered", () => ({ clientAnsweredOnTask: (...a: any[]) => (clientAnsweredOnTask as any)(...a) }));

const { pullContactConversations } = await import("./ghlPull");

const NOW = Date.parse("2026-10-01T18:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60 * 1000;

type Setup = {
  ghl: any[];
  local?: { id: string; channel: string; direction: string; body: string; subject?: string | null; created_at: string; ghl_message_id?: string | null }[];
  convTask?: string;
  openTask?: string;
  lastOutbound?: string;
};
function setup(s: Setup) {
  calls.length = 0;
  closedTasks.clear();
  for (const f of [upsertConversationTask, closeAnsweredReplyTask, notifyInbound, sendInboundReplyEmail, clientAnsweredOnTask]) f.mockClear();
  answer = (c) => {
    if (c.table === "messages" && c.op === "update") return c.cols === "id" && c.payload?.ghl_message_id ? [{ id: "stamped" }] : [];
    if (c.table === "messages" && c.cols === "ghl_message_id") return [];
    if (c.table === "messages" && c.cols?.startsWith("id, channel")) return (s.local ?? []).map((r) => ({ subject: null, ghl_message_id: null, ...r }));
    if (c.table === "messages" && c.cols?.startsWith("ghl_conversation_id")) return s.convTask ? [{ ghl_conversation_id: "conv1", task_id: s.convTask, created_at: iso(DAY) }] : [];
    if (c.table === "messages" && c.cols === "created_at") return s.lastOutbound ? [{ created_at: s.lastOutbound }] : [];
    if (c.table === "tasks") return s.openTask ? { id: s.openTask } : null;
    if (c.table === "contacts") return { id: "ct1", name: "brian goodell", client_id: "cl_ct1" };
    return [];
  };
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("/conversations/search")) return new Response(JSON.stringify({ conversations: [{ id: "conv1" }] }));
    if (u.includes("/conversations/conv1/messages")) return new Response(JSON.stringify({ messages: { messages: s.ghl, nextPage: false } }));
    return new Response("{}", { status: 404 });
  }) as any;
}
const DAY = 24 * 60 * MIN;
const opts = (raiseTasks = true) => ({ contactId: "ct1", clientId: "cl_ct1", locationId: "loc1", ghlContactId: "g1", sinceMs: NOW - 2 * DAY, raiseTasks, now: NOW });
const inserts = () => calls.filter((c) => c.table === "messages" && c.op === "insert").flatMap((c) => c.payload);
const stamps = () => calls.filter((c) => c.table === "messages" && c.op === "update" && c.payload?.ghl_message_id);
const sms = (id: string, direction: string, msAgo: number, body = "Can we move it to Tuesday?") =>
  ({ id, messageType: "TYPE_SMS", direction, body, dateAdded: iso(msAgo) });

describe("the GoHighLevel pull", () => {
  beforeEach(() => setup({ ghl: [] }));

  it("stamps the GoHighLevel id on the Gmail row instead of storing a copy", async () => {
    setup({
      ghl: [{ id: "ghlE1", messageType: "TYPE_EMAIL", direction: "outbound", body: "<p>Hi Brian, the page is live.</p>", meta: { email: { subject: "Page is live" } }, dateAdded: iso(30 * MIN) }],
      local: [{ id: "m_gmail", channel: "email", direction: "outbound", body: "Hi Brian, the page is live.", subject: "Page is live", created_at: iso(30 * MIN + 2000) }],
    });
    const r = await pullContactConversations(opts());
    expect(r.stamped).toBe(1);
    expect(inserts()).toHaveLength(0);
    expect(stamps()[0].payload).toEqual({ ghl_message_id: "ghlE1", ghl_conversation_id: "conv1" });
    expect(stamps()[0].filters).toContainEqual(["id", "m_gmail"]);
  });

  it("stores an email GoHighLevel has that the app never saw", async () => {
    setup({ ghl: [{ id: "ghlE2", messageType: "TYPE_EMAIL", direction: "inbound", body: "Thanks!", dateAdded: iso(45 * MIN) }] });
    const r = await pullContactConversations(opts());
    expect(r.inserted).toBe(1);
    expect(inserts()[0]).toMatchObject({ id: "msg_ghl_ghlE2", ghl_message_id: "ghlE2", ghl_conversation_id: "conv1", channel: "email" });
    // Email is the Gmail poll's to raise tasks for, not this pull's.
    expect(upsertConversationTask).not.toHaveBeenCalled();
  });

  it("leaves a young email for the Gmail poll", async () => {
    setup({ ghl: [{ id: "ghlE3", messageType: "TYPE_EMAIL", direction: "inbound", body: "Thanks!", dateAdded: iso(5 * MIN) }] });
    const r = await pullContactConversations(opts());
    expect(r.held).toBe(1);
    expect(inserts()).toHaveLength(0);
  });

  it("raises the reply task for a text nobody has answered", async () => {
    setup({ ghl: [sms("s1", "inbound", 10 * MIN)] });
    const r = await pullContactConversations(opts());
    expect(r.tasksRaised).toBe(1);
    expect(upsertConversationTask).toHaveBeenCalledWith({ id: "ct1", name: "brian goodell", client_id: "cl_ct1" }, "g1");
    expect(clientAnsweredOnTask).toHaveBeenCalledWith("t_new", "reply");
    expect(notifyInbound).toHaveBeenCalledWith(expect.anything(), "t_new", "Brian Goodell sent a text: Can we move it to Tuesday?");
    expect(sendInboundReplyEmail).toHaveBeenCalledWith(expect.objectContaining({ channel: "sms", taskId: "t_new" }));
    const taskFile = calls.find((c) => c.table === "messages" && c.op === "update" && c.payload?.task_id === "t_new");
    expect(taskFile?.filters).toContainEqual(["in:id", ["msg_ghl_s1"]]);
  });

  it("does not raise a task for a text the team already answered", async () => {
    setup({ ghl: [sms("s1", "inbound", 60 * MIN), sms("s2", "outbound", 50 * MIN, "Sure, Tuesday works.")] });
    await pullContactConversations(opts());
    expect(upsertConversationTask).not.toHaveBeenCalled();
    expect(notifyInbound).not.toHaveBeenCalled();
  });

  it("does not raise one when the answer went out from the app", async () => {
    setup({ ghl: [sms("s1", "inbound", 60 * MIN)], lastOutbound: iso(30 * MIN) });
    await pullContactConversations(opts());
    expect(upsertConversationTask).not.toHaveBeenCalled();
  });

  it("raises one for a missed call, not for a call someone picked up", async () => {
    setup({ ghl: [{ id: "c1", messageType: "TYPE_CALL", direction: "inbound", meta: { call: { status: "completed", duration: 125 } }, dateAdded: iso(10 * MIN) }] });
    await pullContactConversations(opts());
    expect(inserts()[0].body).toBe("Call · 2m 5s");
    expect(upsertConversationTask).not.toHaveBeenCalled();

    setup({ ghl: [{ id: "c2", messageType: "TYPE_CALL", direction: "inbound", meta: { call: { status: "voicemail" } }, dateAdded: iso(10 * MIN) }] });
    await pullContactConversations(opts());
    expect(upsertConversationTask).toHaveBeenCalled();
    expect(notifyInbound).toHaveBeenCalledWith(expect.anything(), "t_new", "📞 Missed call from Brian Goodell");
    expect(sendInboundReplyEmail).not.toHaveBeenCalled();
  });

  it("raises nothing from the Refresh button", async () => {
    setup({ ghl: [sms("s1", "inbound", 10 * MIN)] });
    await pullContactConversations(opts(false));
    expect(inserts()).toHaveLength(1);
    expect(upsertConversationTask).not.toHaveBeenCalled();
  });

  it("files a text on a fresh reply task when its conversation's task closed itself", async () => {
    setup({ ghl: [sms("s1", "inbound", 10 * MIN)], convTask: "t_closed" });
    closedTasks.add("t_closed");
    await pullContactConversations(opts());
    expect(inserts()[0].task_id).toBeNull();
    expect(upsertConversationTask).toHaveBeenCalled();
  });

  it("keeps a text on the live task its conversation belongs to", async () => {
    setup({ ghl: [sms("s1", "inbound", 10 * MIN)], convTask: "t_work" });
    await pullContactConversations(opts());
    expect(inserts()[0].task_id).toBe("t_work");
    expect(upsertConversationTask).not.toHaveBeenCalled();
    expect(notifyInbound).toHaveBeenCalledWith(expect.anything(), "t_work", expect.any(String));
  });

  it("skips automated mail on the timer, and never lets it count as an answer", async () => {
    setup({ ghl: [
      sms("s1", "inbound", 60 * MIN),
      { id: "w1", messageType: "TYPE_EMAIL", direction: "outbound", source: "workflow", body: "Claim your listing", dateAdded: iso(50 * MIN) },
      { id: "c1", messageType: "TYPE_EMAIL", source: "campaign", body: "Newsletter", dateAdded: iso(40 * MIN) },
    ] });
    await pullContactConversations(opts());
    expect(inserts().map((r: any) => r.id)).toEqual(["msg_ghl_s1"]);
    expect(upsertConversationTask).toHaveBeenCalled();

    setup({ ghl: [{ id: "w2", messageType: "TYPE_EMAIL", direction: "outbound", source: "workflow", body: "Claim your listing", dateAdded: iso(50 * MIN) }], openTask: "t_reply" });
    await pullContactConversations(opts(false));
    expect(inserts()).toHaveLength(1);
    expect(closeAnsweredReplyTask).not.toHaveBeenCalled();
  });

  it("ignores messages older than the window", async () => {
    setup({ ghl: [sms("old", "inbound", 3 * DAY)] });
    await pullContactConversations(opts());
    expect(inserts()).toHaveLength(0);
  });
});

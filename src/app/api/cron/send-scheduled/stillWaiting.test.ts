import { describe, it, expect, vi, beforeEach } from "vitest";

// A client reminder whose step is no longer the client's turn never goes
// (Derek, 2026-10-15: Jack Flynn booked through the link, and "We need you to
// book a Meeting by Mon, Oct 19" was still set to go at 8 AM). Supabase is a
// recording stub; the rule (clientRequests.reminderStillWanted) is real.
type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown };
const calls: Call[] = [];
const ROW = "smr_req_asked_s_mv5p7nbeh_cd7e099a-428d-48a5-8ea2-1d733e6e19bd";
const jackTask = (waitDone: boolean) => ({
  id: "t_mv5op68qe", status: waitDone ? "in_progress" : "waiting", deleted_at: null,
  subtasks: [
    { id: "s_mv5ophbxg", title: "Email Request", done: true },
    { id: "s_mv5p7nbeh", title: "Check in if Jack hasn't replied", done: waitDone, stage: "waiting", finishWhen: "reply", due: "2026-10-19", ...(waitDone ? { outcome: "Jack booked Wed, Oct 21, 10:00 AM", doneBy: "client" } : {}) },
    ...(waitDone ? [{ id: "s_next", title: "Jack booked: what's next?", done: false, addedFor: "next:s_mv5p7nbeh" }] : []),
  ],
});
const state = { waitDone: true, sweepRows: [] as unknown[] };
const dueRow = { id: ROW, client_id: "cl_ct_ghl_jC2AGuOsztKpohi9T8Gg", task_id: "t_mv5op68qe", channel: "email", subject: "We need you to book a Meeting by Mon, Oct 19", body: "<p>Hi</p>", cc: [], bcc: [], from_email: null, attachments: [], created_by: "u_derek", reply_to_message_id: null, attempts: 0 };

function query(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  calls.push(call);
  const q: Record<string, unknown> = {};
  for (const n of ["eq", "in", "or", "lt", "lte", "like", "is", "order", "limit"]) q[n] = (...a: unknown[]) => { call.filters.push([n, a[0] as string, a[1]]); return q; };
  q.select = () => q;
  q.update = (payload: unknown) => { call.op = "update"; call.payload = payload; return q; };
  q.insert = async (payload: unknown) => { call.op = "insert"; call.payload = payload; return { error: null }; };
  q.maybeSingle = async () => ({ data: null, error: null });
  q.then = (res: (v: unknown) => void) => {
    if (table === "tasks") return res({ data: [jackTask(state.waitDone)], error: null });
    if (table !== "scheduled_messages") return res({ data: [], error: null });
    if (call.op === "update") {
      const p = call.payload as { status?: string };
      return res({ data: p.status === "sending" || p.status === "canceled" ? [{ id: ROW }] : [], error: null });
    }
    const sweep = call.filters.some(([n, c]) => n === "in" && c === "status");
    return res({ data: sweep ? state.sweepRows : [dueRow], error: null });
  };
  return q;
}

const sent: unknown[] = [];
vi.mock("@/lib/supabaseAdmin", () => ({ adminConfigured: true, supabaseAdmin: { from: (t: string) => query(t) } }));
vi.mock("@/lib/cronAuth", () => ({ authorizeCron: async () => true }));
vi.mock("@/lib/sendMessageServer", () => ({ sendScheduledMessageNow: async (m: unknown) => { sent.push(m); return { ok: true, messageId: "msg_1" }; } }));
vi.mock("@/lib/clientRequestsServer", () => ({
  runClientRequests: async () => ({ tally: {} }),
  threadRequestRow: async (r: { subject: string | null; reply_to_message_id: string | null }) => ({ replyTo: r.reply_to_message_id, subject: r.subject }),
}));
vi.mock("@/lib/clientRequests", async (orig) => ({ ...(await orig<typeof import("@/lib/clientRequests")>()), isFollowOnHour: () => false }));

const { GET } = await import("./route");
const run = async () => (await GET(new Request("https://x.invalid/api/cron/send-scheduled") as never)).json();
const cancels = () => calls.filter((c) => c.table === "scheduled_messages" && c.op === "update" && (c.payload as { status?: string }).status === "canceled");

beforeEach(() => { calls.length = 0; sent.length = 0; state.waitDone = true; state.sweepRows = []; });

describe("the 15 minute sender and a client reminder", () => {
  it("cancels Jack's reminder instead of sending it once his wait is done", async () => {
    const out = await run();
    expect(sent).toEqual([]);
    expect(out).toMatchObject({ sent: 0, canceled: 1 });
    expect(cancels()[0].payload).toEqual({ status: "canceled", error: "No longer waiting on the client" });
  });

  it("sends it while the wait is still his turn", async () => {
    state.waitDone = false;
    const out = await run();
    expect(sent).toHaveLength(1);
    expect(out).toMatchObject({ sent: 1, canceled: 0 });
    expect(cancels()).toEqual([]);
  });

  it("sweeps queued and waiting for review ones first", async () => {
    state.sweepRows = [{ id: ROW, task_id: "t_mv5op68qe" }, { id: "smr_portal_cl_x_abc", task_id: null }];
    await run();
    // The swept one, then the claimed one read again: only the step reminder is touched.
    expect(cancels().length).toBeGreaterThanOrEqual(1);
    expect(cancels().every((c) => c.filters.some(([n, col, v]) => n === "eq" && col === "id" && v === ROW))).toBe(true);
  });
});

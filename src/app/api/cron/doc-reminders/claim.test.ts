import { describe, it, expect, vi, beforeEach } from "vitest";

// The reminder cron claims a reminder before queueing it, so two runs at once
// cannot both send one (audit 2026-09-29, 1.5). Supabase is a recording stub;
// the rules in reviewReminders.ts are real, with the clock and the business
// day check fixed so the one review below is due.
type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown };
const calls: Call[] = [];
const state = { claimRows: [{ id: "d_1" }] as unknown[], insertError: null as null | { message: string } };

function query(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  calls.push(call);
  const q: Record<string, unknown> = {};
  const chain = (...names: string[]) => names.forEach((n) => { q[n] = (...a: unknown[]) => { if (n === "eq" || n === "is" || n === "gt") call.filters.push([n, a[0] as string, a[1]]); return q; }; });
  chain("eq", "is", "gt", "order", "limit", "like");
  q.select = () => q;
  q.update = (payload: unknown) => { call.op = "update"; call.payload = payload; return q; };
  q.insert = async (payload: unknown) => { call.op = "insert"; call.payload = payload; return { error: state.insertError }; };
  q.in = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  // Awaiting the chain: the reviews, their versions and tasks, or the claim's rows.
  const lists: Record<string, unknown[]> = {
    task_documents: [{ id: "d_1", task_id: "t_1", title: "Homepage", kind: "page", reminder_every_days: 1, reminder_round_at: null, reminders_sent: 0, last_reminder_at: null }],
    task_document_versions: [{ document_id: "d_1", kind: "sent", created_at: "2026-09-21T16:00:00Z", version: 2 }, { document_id: "d_1", kind: "client_submitted", created_at: "2026-09-20T16:00:00Z", version: 1 }],
    tasks: [{ id: "t_1", title: "Homepage", status: "review", is_private: false, deleted_at: null, assignee_id: "u_derek", client_id: "cl_1", project_id: null }],
  };
  q.then = (res: (v: unknown) => void) => res(
    call.op === "update" ? { data: call.filters.some(([, c]) => c === "reminders_sent") ? state.claimRows : [], error: null }
      : { data: lists[table] ?? [], error: null });
  return q;
}

vi.mock("@/lib/supabaseAdmin", () => ({ adminConfigured: true, supabaseAdmin: { from: (t: string) => query(t) } }));
vi.mock("@/lib/cronAuth", () => ({ authorizeCron: async () => true }));
vi.mock("@/lib/taskDocumentServer", () => ({ linkState: async () => ({ live: true, url: "https://x.invalid/r/abc" }) }));
vi.mock("@/lib/sendMessageServer", () => ({ resolveContact: async () => ({ email: "brian@example.com" }) }));
vi.mock("@/lib/waitingNotify", () => ({ resolveNotifyRecipient: async () => "u_derek" }));
vi.mock("@/lib/reviewReminders", async (orig) => ({
  ...(await orig<typeof import("@/lib/reviewReminders")>()),
  isBusinessDay: () => true,
  reminderDue: () => ({ due: true, sentThisRound: 0, reason: "due" }),
}));

const { GET } = await import("./route");
const run = async () => (await GET(new Request("https://x.invalid/api/cron/doc-reminders") as never)).json();
const inserts = () => calls.filter((c) => c.op === "insert" && c.table === "scheduled_messages");
const updates = () => calls.filter((c) => c.op === "update" && c.table === "task_documents");

beforeEach(() => { calls.length = 0; state.claimRows = [{ id: "d_1" }]; state.insertError = null; });

describe("the review reminder cron", () => {
  it("claims the reminder, then queues it as a reminder", async () => {
    expect((await run()).sent).toBe(1);
    const [claim] = updates();
    expect(claim.payload).toEqual({ reminders_sent: 1, last_reminder_at: expect.any(String) });
    expect(claim.filters).toEqual(expect.arrayContaining([["eq", "reminders_sent", 0], ["is", "last_reminder_at", null]]));
    expect((inserts()[0].payload as { id: string }).id).toMatch(/^sm_rm_/);
  });

  it("queues nothing when another run claimed it first", async () => {
    state.claimRows = [];
    expect((await run()).sent).toBe(0);
    expect(inserts()).toEqual([]);
  });

  it("hands the claim back when the queue refuses the message", async () => {
    state.insertError = { message: "boom" };
    expect((await run()).sent).toBe(0);
    expect(updates().at(-1)!.payload).toEqual({ reminders_sent: 0, last_reminder_at: null });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// mentionReply builds a real Supabase client at module load, which there is no
// env for under vitest. A controllable stub instead, so these tests exercise
// the rules: who may write into a task by email, and what stops the same reply
// becoming two hundred comments.
type Row = Record<string, unknown> | null;
const state: { profile: Row; task: Row; appended: unknown[]; appendError: string | null } = {
  profile: null, task: null, appended: [], appendError: null,
};

const builder = (row: Row) => {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "ilike", "not", "order", "limit"]) self[m] = () => self;
  self.maybeSingle = async () => ({ data: row, error: null });
  return self;
};

vi.mock("./supabaseAdmin", () => ({
  adminConfigured: true,
  supabaseAdmin: {
    from: (table: string) => (table === "profiles" ? builder(state.profile) : builder(state.task)),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (state.appendError) return { data: null, error: { message: state.appendError } };
      state.appended.push(args);
      return { data: null, error: null };
    },
  },
}));

const { commentFromMentionReply } = await import("./mentionReply");

const reply = (over: Partial<Parameters<typeof commentFromMentionReply>[0]> = {}) =>
  commentFromMentionReply({
    taskId: "t_1", fromEmail: "michaella@clickuplocal.com",
    body: "Sent it this morning, waiting on Brian now.",
    gmailMessageId: "gm_abc", at: "2026-09-29T10:00:00.000Z", ...over,
  });

beforeEach(() => {
  state.profile = { member_id: "u_mich", id: "uuid-mich" };
  state.task = { id: "t_1", comments: [], deleted_at: null };
  state.appended = [];
  state.appendError = null;
});

describe("a reply to a mention email", () => {
  it("lands on the task as a comment by whoever wrote it", async () => {
    expect(await reply()).toBe(true);
    expect(state.appended).toHaveLength(1);
    const { task_id, comment } = state.appended[0] as { task_id: string; comment: Record<string, string> };
    expect(task_id).toBe("t_1");
    expect(comment.authorId).toBe("u_mich");
    expect(comment.body).toContain("Sent it this morning");
    expect(comment.at).toBe("2026-09-29T10:00:00.000Z");
  });

  // The poller looks two days back every fifteen minutes, so it offers the
  // same reply about two hundred times. Each one has to be the same comment.
  it("is the same comment however many times the poller sees it", async () => {
    expect(await reply()).toBe(true);
    const { comment } = state.appended[0] as { comment: { id: string } };
    expect(comment.id).toBe("cm_gm_gm_abc");
    // Second pass: the task now carries that comment.
    state.task = { id: "t_1", comments: [{ id: comment.id }], deleted_at: null };
    expect(await reply()).toBe(false);
    expect(state.appended).toHaveLength(1);
  });

  // Anyone can put whatever they like in a From header, so this is the check
  // that stops a stranger who learns a thread id writing into the app.
  it("refuses anyone who is not on the team", async () => {
    state.profile = null;
    expect(await reply({ fromEmail: "someone@example.com" })).toBe(false);
    expect(state.appended).toEqual([]);
  });

  it("falls back to the profile id when a teammate has no member id", async () => {
    state.profile = { member_id: null, id: "uuid-justin" };
    expect(await reply()).toBe(true);
    expect((state.appended[0] as { comment: { authorId: string } }).comment.authorId).toBe("uuid-justin");
  });

  it("writes nothing for an empty reply", async () => {
    expect(await reply({ body: "   \n  " })).toBe(false);
    expect(state.appended).toEqual([]);
  });

  it("writes nothing to a task that has gone", async () => {
    state.task = { id: "t_1", comments: [], deleted_at: "2026-09-01T00:00:00.000Z" };
    expect(await reply()).toBe(false);
    state.task = null;
    expect(await reply()).toBe(false);
    expect(state.appended).toEqual([]);
  });

  it("says so rather than throwing when the append fails", async () => {
    state.appendError = "deadlock detected";
    expect(await reply()).toBe(false);
  });
});

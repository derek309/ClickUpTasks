import { describe, it, expect, vi, beforeEach } from "vitest";

// mentionReply builds a real Supabase client at module load, which there is no
// env for under vitest. A controllable stub instead, so these tests exercise
// the rules: who may write into a task by email, and what stops the same reply
// becoming two hundred comments.
type Row = Record<string, unknown> | null;
const state: {
  profile: Row; task: Row; appended: unknown[]; appendError: string | null; canAct: boolean;
  emailPattern: string | null; taskUpdates: unknown[]; bells: unknown[];
} = { profile: null, task: null, appended: [], appendError: null, canAct: true, emailPattern: null, taskUpdates: [], bells: [] };

const builder = (table: string, row: Row) => {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "order", "limit"]) self[m] = () => self;
  self.ilike = (_col: string, pattern: string) => { state.emailPattern = pattern; return self; };
  self.update = (patch: unknown) => { if (table === "tasks") state.taskUpdates.push(patch); return self; };
  self.upsert = async (r: unknown) => { if (table === "notifications") state.bells.push(r); return { error: null }; };
  self.maybeSingle = async () => ({ data: row, error: null });
  return self;
};

vi.mock("./supabaseAdmin", () => ({
  adminConfigured: true,
  supabaseAdmin: {
    from: (table: string) => builder(table, table === "profiles" ? state.profile : state.task),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (state.appendError) return { data: null, error: { message: state.appendError } };
      state.appended.push(args);
      return { data: null, error: null };
    },
  },
}));
vi.mock("./taskAccess", () => ({ canActOnTask: async () => state.canAct }));

const { commentFromMentionReply, replyOnly } = await import("./mentionReply");

const reply = (over: Partial<Parameters<typeof commentFromMentionReply>[0]> = {}) =>
  commentFromMentionReply({
    taskId: "t_1", fromEmail: "michaella@clickuplocal.com",
    body: "Sent it this morning, waiting on Brian now.",
    gmailMessageId: "gm_abc", at: "2026-09-29T10:00:00.000Z", ...over,
  });

beforeEach(() => {
  state.profile = { member_id: "u_mich", id: "uuid-mich", name: "Michaella Pastrana", email: "michaella@clickuplocal.com", role: "va" };
  state.task = { id: "t_1", title: "Stores newsletter", comments: [], client_id: "cl_1", assignee_id: "u_derek", is_private: false, deleted_at: null };
  state.appended = [];
  state.appendError = null;
  state.canAct = true;
  state.emailPattern = null;
  state.taskUpdates = [];
  state.bells = [];
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
    state.task = { ...state.task, comments: [{ id: comment.id }] };
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
    state.profile = { ...state.profile, member_id: null, id: "uuid-justin" };
    expect(await reply()).toBe(true);
    expect((state.appended[0] as { comment: { authorId: string } }).comment.authorId).toBe("uuid-justin");
  });

  it("writes nothing for an empty reply", async () => {
    expect(await reply({ body: "   \n  " })).toBe(false);
    expect(state.appended).toEqual([]);
  });

  it("writes nothing to a task that has gone", async () => {
    state.canAct = false;
    expect(await reply()).toBe(false);
    state.task = null;
    expect(await reply()).toBe(false);
    expect(state.appended).toEqual([]);
  });

  it("writes nothing to a private task", async () => {
    state.task = { ...state.task, is_private: true };
    expect(await reply()).toBe(false);
    expect(state.appended).toEqual([]);
  });

  it("refuses a teammate who could not open the task", async () => {
    state.canAct = false;
    expect(await reply()).toBe(false);
    expect(state.appended).toEqual([]);
  });

  // In ilike, _ and % are wildcards: an address with an underscore could
  // match another person's profile.
  it("matches the From address literally", async () => {
    await reply({ fromEmail: " a_b%c@clickuplocal.com " });
    expect(state.emailPattern).toBe("a\\_b\\%c@clickuplocal.com");
  });

  it("posts only the answer, not the quoted email", async () => {
    await reply({ body: "Done, sent it.\n\nOn Mon, Sep 29, 2026 at 10:00 AM Derek Fox <derek@clickuplocal.com> wrote:\n> Can you send it?" });
    expect((state.appended[0] as { comment: { body: string } }).comment.body).not.toContain("wrote");
  });

  it("writes nothing when the reply is only the quote", async () => {
    expect(await reply({ body: "> Can you send it?" })).toBe(false);
    expect(state.appended).toEqual([]);
  });

  // The app skips live updates stamped with the viewer's own id, which
  // append_comment sets to the author.
  it("clears updated_by so the comment shows live", async () => {
    await reply();
    expect(state.taskUpdates).toEqual([{ updated_by: null }]);
  });

  it("rings the task owner's bell once per email, and not for their own reply", async () => {
    await reply();
    expect(state.bells).toEqual([expect.objectContaining({ id: "n_mr_gm_abc", recipient_id: "u_derek", text: "Michaella Pastrana replied by email on “Stores newsletter”" })]);
    state.bells = [];
    state.task = { ...state.task, assignee_id: "u_mich" };
    await reply({ gmailMessageId: "gm_def" });
    expect(state.bells).toEqual([]);
  });

  it("says so rather than throwing when the append fails", async () => {
    state.appendError = "deadlock detected";
    expect(await reply()).toBe(false);
  });
});

describe("replyOnly", () => {
  const answer = "Yes, it went out this morning.\nBrian has it now.";
  it("keeps a reply with no quote as is", () => {
    expect(replyOnly(`  ${answer}\n\n`)).toBe(answer);
  });
  it("cuts Gmail's quote, on one line or wrapped over two", () => {
    expect(replyOnly(`${answer}\n\nOn Mon, Sep 29, 2026 at 10:00 AM Derek Fox <derek@clickuplocal.com> wrote:\n\n> Derek Fox mentioned you on`)).toBe(answer);
    expect(replyOnly(`${answer}\r\n\r\nOn Mon, Sep 29, 2026 at 10:00 AM Derek Fox <\r\nderek@clickuplocal.com> wrote:\r\n\r\n> quoted`)).toBe(answer);
  });
  it("cuts Apple Mail's quote", () => {
    expect(replyOnly(`${answer}\n\nSent from my iPhone\n\nOn Sep 29, 2026, at 10:00 AM, Derek Fox <derek@clickuplocal.com> wrote:\n\n> quoted`))
      .toBe(`${answer}\n\nSent from my iPhone`);
  });
  it("cuts Outlook's quote, in both of its shapes", () => {
    expect(replyOnly(`${answer}\n\n-----Original Message-----\nFrom: Derek Fox`)).toBe(answer);
    expect(replyOnly(`${answer}\n\n________________________________\nFrom: Derek Fox <derek@clickuplocal.com>\nSent: Monday`)).toBe(answer);
  });
  it("cuts at our own footer when the quote is not marked", () => {
    expect(replyOnly(`${answer}\nReply to this email and your answer lands on the task, where the whole team can see it.`)).toBe(answer);
  });
  it("leaves an answer that only mentions someone writing", () => {
    expect(replyOnly("On Friday Brian wrote back, all good.")).toBe("On Friday Brian wrote back, all good.");
  });
  it("leaves nothing when there is only a quote", () => {
    expect(replyOnly("> Can you send it?")).toBe("");
  });
});

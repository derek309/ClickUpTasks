import { describe, expect, it, vi, beforeEach } from "vitest";
import { withMeetingSteps, type Subtask } from "./data";

// A small in-memory database: enough of supabase's chain for stepsServer.
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
function builder(table: string) {
  const filters: [string, unknown][] = [];
  let patch: Row | null = null;
  const rows = () => (db[table] ?? []).filter((r) => filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)));
  const b = {
    select: () => b,
    update: (p: Row) => { patch = p; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    is: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    not: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
    then: (res: (x: { data: Row[] }) => unknown) => {
      const hit = rows();
      if (patch) hit.forEach((r) => Object.assign(r, patch, { updated_at: `${Date.now()}${Math.random()}` }));
      return Promise.resolve({ data: hit }).then(res);
    },
  };
  return b;
}
// append_comment: the comments a run wrote, in order.
const comments: { task_id: string; comment: { body: string } }[] = [];
vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: string) => builder(t), rpc: (_name: string, args: { task_id: string; comment: { body: string } }) => { comments.push(args); return Promise.resolve({ data: null, error: null }); } }, adminConfigured: true }));

const { stepsOnReviewSent, stepsOnReviewChanges, stepsOnReviewApproved, stepsOnClientReply, stepsOnClientChanges, stepsOnCommentAfterApproval, stepsOnCommentRemoved, tickStep, tickTodo, holdDraftOnStep, releaseDraftFromSteps, stepsOnMeetingTranscript, stepsOnMeetNow } = await import("./stepsServer");

const steps = () => (db.tasks[0].subtasks as Subtask[]);
function setup(subtasks: Subtask[]) {
  db.tasks = [{ id: "t1", subtasks, assignee_id: "u_derek", client_id: "cl_1", status: "in_progress", updated_at: "1" }];
  db.clients = [{ id: "cl_1", name: "Brian Goodell" }];
  db.task_documents = [{ task_id: "t1", kind: "doc", title: "Newsletter", deleted_at: null }];
  db.task_document_comments = [
    { id: "c1", document_id: "d1", body: "Change the headline", author_id: null, completed_at: null },
    { id: "c2", document_id: "d1", body: "Team note", author_id: "u_derek", completed_at: null },
  ];
}

describe("steps added on the server", () => {
  beforeEach(() => setup([{ id: "a", title: "Write the newsletter", done: false }, { id: "b", title: "Schedule it", done: false }]));

  it("a send finishes our step and starts the client's waiting step", async () => {
    expect(await stepsOnReviewSent("t1", "doc")).toBe(true);
    expect(steps().map((s) => [s.title, s.done])).toEqual([["Write the newsletter", true], ["Waiting on Brian's approval", false], ["Schedule it", false]]);
    // Sent again (the task page got there too): nothing more.
    expect(await stepsOnReviewSent("t1", "doc")).toBe(false);
    expect(steps()).toHaveLength(3);
  });

  it("changes add Make Brian's changes with the client's comments as to-dos", async () => {
    await stepsOnReviewSent("t1", "doc");
    expect(await stepsOnReviewChanges("t1", "doc", "d1", 1)).toBe(true);
    const made = steps().find((s) => s.title === "Make Brian's changes")!;
    expect(made.todos?.map((t) => t.title)).toEqual(["Change the headline"]);
    // Due in three business days, and the task's follow up the same day.
    expect(made.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(db.tasks[0].follow_up_at).toBe(made.due);
    expect(await stepsOnReviewChanges("t1", "doc", "d1", 1)).toBe(false);
  });

  it("an approval is recorded and the plan's next step starts", async () => {
    await stepsOnReviewSent("t1", "doc");
    expect(await stepsOnReviewApproved("t1", "doc", 1, true)).toBe(true);
    const approval = steps().find((s) => s.addedFor === "ok:doc:1")!;
    expect(approval).toMatchObject({ title: "Brian approved Newsletter", done: true });
    expect(steps().find((s) => s.title === "Schedule it")!.startedAt).toBeTruthy();
    expect(await stepsOnReviewApproved("t1", "doc", 1, true)).toBe(false);
  });

  it("a reply finishes a step waiting on it, and nothing else", async () => {
    expect(await stepsOnClientReply("t1")).toBe(false);
    setup([{ id: "k", title: "Check in if Brian hasn't replied", done: false, finishWhen: "reply" }]);
    expect(await stepsOnClientReply("t1")).toBe(true);
    expect(steps()[0]).toMatchObject({ done: true, outcome: "Brian replied" });
  });

  it("an emailed reply to a request reminder finishes only that step and starts check it with their email", async () => {
    setup([
      { id: "w1", title: "Wait for Brian's flyer approval", done: false, finishWhen: "reply", stage: "waiting", startedAt: "2026-10-10T00:00:00Z" },
      { id: "w2", title: "Wait for Brian's logo", done: false, finishWhen: "reply", startedAt: "2026-10-10T00:00:00Z" },
    ]);
    Object.assign(db.tasks[0], { status: "waiting", waiting_on_client: true });
    const email = { messageId: "msg_9", from: "Brian", subject: "Re: flyer", body: "Approved", at: "2026-10-20T18:00:00Z", fileKey: "k9" };
    expect(await stepsOnClientReply("t1", { stepId: "w1", email })).toBe(true);
    expect(steps().map((s) => [s.title, s.done])).toEqual([["Wait for Brian's flyer approval", true], ["Brian replied: check it", false], ["Wait for Brian's logo", false]]);
    expect(steps()[1]).toMatchObject({ addedFor: "checkit:w1", fromEmails: [email] });
    expect(db.tasks[0]).toMatchObject({ waiting_on_client: false, status: "in_progress" });
    // No step to match: every started wait finishes, as before.
    setup([{ id: "w1", title: "Wait", done: false, finishWhen: "reply", startedAt: "x" }, { id: "w2", title: "Wait 2", done: false, finishWhen: "reply", startedAt: "x" }]);
    expect(await stepsOnClientReply("t1", { stepId: "gone", email })).toBe(true);
    expect(steps().filter((s) => s.done).map((s) => s.id)).toEqual(["w1", "w2"]);
  });

  it("a reply leaves a reply step that never started", async () => {
    setup([{ id: "a", title: "Make the ads", done: false, startedAt: "2026-10-10T00:00:00Z" }, { id: "r", title: "Review Ads", done: false, finishWhen: "reply" }]);
    expect(await stepsOnClientReply("t1")).toBe(false);
    expect(steps().find((s) => s.id === "r")!.done).toBe(false);
  });

  it("a reply stops the task waiting on the client and moves its status", async () => {
    setup([{ id: "k", title: "Check in if Brian hasn't replied", done: false, finishWhen: "reply", startedAt: "2026-10-10T00:00:00Z" }, { id: "n", title: "Schedule it", done: false }]);
    Object.assign(db.tasks[0], { status: "waiting", waiting_on_client: true });
    expect(await stepsOnClientReply("t1")).toBe(true);
    expect(db.tasks[0]).toMatchObject({ waiting_on_client: false, status: "in_progress" });
  });

  it("a portal request lands on a changes step made in front of the current one", async () => {
    setup([{ id: "a", title: "Write the newsletter", done: false }, { id: "r1", title: "Make the logo bigger", done: false, fromClient: true }]);
    expect(await stepsOnClientChanges("t1")).toBe(true);
    const made = steps().find((s) => s.title === "Changes from Brian")!;
    expect(steps().find((s) => s.id === "r1")!.stepId).toBe(made.id);
    expect(steps().map((s) => s.title).slice(0, 2)).toEqual(["Changes from Brian", "Write the newsletter"]);
    expect(await stepsOnClientChanges("t1")).toBe(false);
  });

  it("a portal request on a task with no steps gets its changes step too", async () => {
    setup([{ id: "r1", title: "Why do we need to state that?", done: false, fromClient: true }]);
    expect(await stepsOnClientChanges("t1")).toBe(true);
    const made = steps().find((s) => s.title === "Changes from Brian")!;
    expect(made.startedAt).toBeTruthy();
    expect(steps().find((s) => s.id === "r1")!.stepId).toBe(made.id);
  });

  it("a comment after approval is a to-do on a changes step holding the review", async () => {
    setup([{ id: "a", title: "Write it", done: true, holds: ["doc"] }, { id: "b", title: "Schedule it", done: false }]);
    expect(await stepsOnCommentAfterApproval("t1", "doc", { id: "c9", body: "Actually change the date" })).toBe(true);
    const made = steps().find((s) => s.title === "Changes from Brian")!;
    expect(made.todos?.map((t) => [t.title, t.commentId])).toEqual([["Actually change the date", "c9"]]);
    expect(made.holds).toEqual(["doc"]);
    expect(await stepsOnCommentAfterApproval("t1", "doc", { id: "c9", body: "Actually change the date" })).toBe(false);
  });

  it("a deleted comment takes its to-do with it", async () => {
    setup([{ id: "a", title: "Write it", done: true, holds: ["doc"] }, { id: "b", title: "Schedule it", done: false }]);
    await stepsOnCommentAfterApproval("t1", "doc", { id: "c9", body: "Change the date" });
    await stepsOnCommentAfterApproval("t1", "doc", { id: "c10", body: "And the title" });
    expect(await stepsOnCommentRemoved("t1", "c9")).toBe(true);
    expect(steps().find((s) => s.title === "Changes from Brian")!.todos?.map((t) => t.commentId)).toEqual(["c10"]);
    expect(await stepsOnCommentRemoved("t1", "c9")).toBe(false);
  });

  it("an approval on one review moves that review's waiting step, not another's", async () => {
    setup([
      { id: "a", title: "Write", done: true },
      { id: "wd", title: "Waiting on the document", done: false, onClient: true, waitsOn: "doc", addedFor: "sent:a" },
      { id: "wi", title: "Waiting on the image", done: false, onClient: true, waitsOn: "image", addedFor: "sent:a" },
      { id: "z", title: "Schedule", done: false },
    ]);
    db.task_documents.push({ task_id: "t1", kind: "image", title: "Poster", deleted_at: null });
    expect(await stepsOnReviewApproved("t1", "image", 1, true)).toBe(true);
    expect(steps().find((x) => x.id === "wd")!.done).toBe(false);
    expect(steps().find((x) => x.id === "wi")!.done).toBe(true);
  });

  it("Send changes after a comment joins the open round instead of starting a second", async () => {
    await stepsOnReviewSent("t1", "doc");
    expect(await stepsOnReviewChanges("t1", "doc", "d1", 3)).toBe(true);
    db.task_document_comments.push({ id: "c3", document_id: "d1", body: "And the date", author_id: null, completed_at: null });
    expect(await stepsOnReviewChanges("t1", "doc", "d1", 4)).toBe(true);
    const rounds = steps().filter((x) => x.title === "Make Brian's changes");
    expect(rounds).toHaveLength(1);
    expect(rounds[0].todos?.map((t) => t.title)).toEqual(["Change the headline", "And the date"]);
  });

  it("after an approval the plan's next step starts, even past a portal request", async () => {
    setup([
      { id: "w", title: "Waiting", done: false, onClient: true, waitsOn: "doc", addedFor: "sent:a" },
      { id: "req", title: "Make the logo bigger", done: false, fromClient: true },
      { id: "z", title: "Schedule", done: false },
    ]);
    await stepsOnReviewApproved("t1", "doc", 1, true);
    expect(steps().find((x) => x.id === "z")!.startedAt).toBeTruthy();
    expect(steps().find((x) => x.id === "req")!.startedAt).toBeUndefined();
  });

  it("a step ticked from the MCP starts the next one; the last asks what's next", async () => {
    expect(await tickStep("t1", "a", true)).toContain('Next step: "Schedule it"');
    expect(steps().find((x) => x.id === "b")!.startedAt).toBeTruthy();
    expect(await tickStep("t1", "b", true)).toContain("last step");
    expect(steps().at(-1)).toMatchObject({ title: "Schedule it: what's next?", done: false });
    expect(await tickStep("t1", "b", false)).toContain("reopened");
  });

  it("Claude finishing its own step: back with whoever gave it at What's next, nothing else starts (Derek, 2026-10-17)", async () => {
    setup([
      { id: "a", title: "Write subject lines", done: false, assigneeId: "u_claude", givenBy: "u_derek" },
      { id: "b", title: "Brian approves", done: false, finishWhen: "reply", stage: "waiting" },
    ]);
    expect(await tickStep("t1", "a", true)).toContain("back with whoever gave it");
    expect(steps().map((x) => x.id)).toEqual(["a", expect.any(String), "b"]);
    expect(steps()[1]).toMatchObject({ title: "Write subject lines: what's next?", addedFor: "next:a", done: false });
    expect(steps().find((x) => x.id === "b")!.startedAt).toBeUndefined();
    // The giver's own step next: it simply starts, as before.
    setup([
      { id: "a", title: "Write subject lines", done: false, assigneeId: "u_claude" },
      { id: "b", title: "Pick one", done: false },
    ]);
    expect(await tickStep("t1", "a", true)).toContain('Next step: "Pick one"');
  });

  it("a tick carries unfinished work to the next review step; the next step still starts", async () => {
    setup([
      { id: "a", title: "Draft the blog post", done: false, holds: ["doc"] },
      { id: "b", title: "Create the stat image in ChatGPT", done: false },
      { id: "c", title: "Derek review", done: false },
    ]);
    expect(await tickStep("t1", "a", true)).toContain('Next step: "Create the stat image in ChatGPT"');
    expect(steps().find((x) => x.id === "a")!.holds).toBeUndefined();
    expect(steps().find((x) => x.id === "b")!.holds).toBeUndefined();
    expect(steps().find((x) => x.id === "b")!.startedAt).toBeTruthy();
    expect(steps().find((x) => x.id === "c")).toMatchObject({ holds: ["doc"] });
    expect(steps().find((x) => x.id === "c")!.startedAt).toBeUndefined();
  });

  it("with no review step, the work goes to the next step as before", async () => {
    setup([{ id: "a", title: "Write it", done: false, holds: ["doc"] }, { id: "b", title: "Schedule it", done: false }]);
    await tickStep("t1", "a", true);
    expect(steps().find((x) => x.id === "b")).toMatchObject({ holds: ["doc"] });
  });

  it("a to-do from a client comment is ticked and its comment resolved", async () => {
    setup([{ id: "a", title: "Make Brian's changes", done: false, todos: [{ id: "td1", title: "Change the headline", done: false, fromClient: true, commentId: "c1" }] }]);
    db.task_documents[0].id = "d1";
    expect(await tickTodo("t1", "headline", true, "Claude")).toContain("resolved");
    expect(steps()[0].todos![0].done).toBe(true);
    expect(db.task_document_comments[0].completed_at).toBeTruthy();
  });

  // One step at a time (Derek, 2026-10-17): with a step open the email goes
  // on it; only with none open is it a step of its own.
  it("a drafted email goes on the current step, and gets its own step only when none is open", async () => {
    expect((await holdDraftOnStep("t1", "Your newsletter")).on).toBe("Write the newsletter");
    expect(steps().map((x) => x.title)).toEqual(["Write the newsletter", "Schedule it"]);
    expect(steps()[0].holds).toEqual(["email"]);
    // A second draft keeps to the step that holds one.
    expect((await holdDraftOnStep("t1", "Other")).on).toBe("Write the newsletter");
    expect(steps()).toHaveLength(2);
    setup([{ id: "a", title: "Write the newsletter", done: true }]);
    expect((await holdDraftOnStep("t1", "Your newsletter")).on).toBe("Email Brian: Your newsletter");
    expect(steps().map((x) => x.title)).toEqual(["Write the newsletter", "Email Brian: Your newsletter"]);
    expect(steps()[1]).toMatchObject({ holds: ["email"], startedAt: expect.any(String) });
  });

  // Seen 2026-10-12 on t_mv5ma65g8: replace with a step left the draft on step 1.
  it("a named step takes a draft another step holds, by id or by a piece of its title", async () => {
    setup([
      { id: "a", title: "Rebuild the page", done: true, holds: ["email"] },
      { id: "w", title: "Rebuild the page: what's next?", done: false, addedFor: "next:a" },
    ]);
    expect((await holdDraftOnStep("t1", "Done", "what's next?")).on).toBe("Email Brian: Done");
    expect(steps()[0].holds).toBeUndefined();
    expect(steps()[1]).toMatchObject({ id: "w", title: "Email Brian: Done", holds: ["email"] });
    // Back by id, and by a whole title that another title also contains.
    expect((await holdDraftOnStep("t1", "Done", "a")).on).toBe("Rebuild the page");
    expect(steps()[0].holds).toEqual(["email"]);
    expect(steps()[1].holds).toBeUndefined();
    expect((await holdDraftOnStep("t1", "Done", "email brian: done")).on).toBe("Email Brian: Done");
    expect((await holdDraftOnStep("t1", "Done", "rebuild the page")).on).toBe("Rebuild the page");
  });

  it("a named step that matches none or several leaves the draft and says why", async () => {
    setup([
      { id: "a", title: "Rebuild the page", done: false, holds: ["email"] },
      { id: "b", title: "Rebuild the menu", done: false },
    ]);
    const none = await holdDraftOnStep("t1", "Hi", "nothing like it");
    expect(none).toEqual({ on: "Rebuild the page", note: expect.stringContaining("No step matching") });
    const two = await holdDraftOnStep("t1", "Hi", "rebuild");
    expect(two.note).toContain("matches 2 steps");
    expect(steps()[0].holds).toEqual(["email"]);
  });

  it("a deleted draft comes off its step, and a step made only for it goes", async () => {
    await holdDraftOnStep("t1", "Your newsletter");
    expect(await releaseDraftFromSteps("t1")).toBe(true);
    expect(steps().map((x) => x.title)).toEqual(["Write the newsletter", "Schedule it"]);
    setup([{ id: "a", title: "Write the newsletter", done: false, holds: ["email"] }, { id: "b", title: "Schedule it", done: false }]);
    expect(await releaseDraftFromSteps("t1")).toBe(true);
    expect(steps()).toHaveLength(2);
    expect(steps()[0].holds).toBeUndefined();
    expect(await releaseDraftFromSteps("t1")).toBe(false);
  });

  it("the meeting's transcript ticks its step and the meeting, holding the file", async () => {
    setup(withMeetingSteps([], "Brian", "2026-10-14", (() => { let n = 0; return () => `m${++n}`; })(), "2026-10-12T00:00:00Z")!);
    expect(steps().map((x) => [x.title, x.due, !!x.startedAt])).toEqual([["Meet with Brian", "2026-10-14", true], ["Add the meeting transcript", "2026-10-14", false]]);
    // Rebooked: the same pair moves, no second pair.
    expect(withMeetingSteps(steps(), "Brian", "2026-10-16", () => "x")!.map((x) => x.due)).toEqual(["2026-10-16", "2026-10-16"]);
    expect(await stepsOnMeetingTranscript("t1", "a_1")).toBe(true);
    expect(steps().map((x) => [x.done, x.outcome])).toEqual([[true, "Met"], [true, "Transcript from Granola"]]);
    expect(steps()[1].holds).toEqual(["att:a_1"]);
    expect(await stepsOnMeetingTranscript("t1", "a_2")).toBe(false);
    // The sync runs again for the same meeting: no second pair.
    expect(withMeetingSteps(steps(), "Brian", "2026-10-14", () => "y")).toBeNull();
  });

  it("a meeting started now: its two steps in front of the current one, ticked by the transcript", async () => {
    const meeting = { url: "https://meet.google.com/abc-defg-hij", start: "2026-10-14T21:05:00.000Z", end: "2026-10-14T21:35:00.000Z", via: "meet" as const };
    const id = await stepsOnMeetNow("t1", { first: "Brian", attachmentId: "a_9", meeting });
    expect(steps().map((x) => [x.title, x.done])).toEqual([["Meet with Brian", false], ["Add the meeting transcript", false], ["Write the newsletter", false], ["Schedule it", false]]);
    expect(steps()[0].id).toBe(id);
    expect(steps()[0]).toMatchObject({ holds: ["att:a_9"], meeting, assigneeId: "u_derek" });
    expect(await stepsOnMeetingTranscript("t1", "a_10")).toBe(true);
    expect(steps().slice(0, 2).map((x) => [x.done, x.outcome])).toEqual([[true, "Met"], [true, "Transcript from Granola"]]);
  });
});

// t_mv01d2mnx "MEDAL of brands", 2026-10-14: Brian approved by email, Derek
// marked the HTML review approved, and nothing moved: no step was waiting on
// Brian, and the step making the designed version was Claude's.
describe("an approval with no step waiting on the client", () => {
  const medal = (): Subtask[] => [
    { id: "s5", title: "Waiting on Brian to review the review", done: true, onClient: true, waitsOn: "page", outcome: "Brian approved" },
    { id: "s6", title: "Reply to brian", done: true, outcome: "Done", assigneeId: "u_derek", holds: [] },
    { id: "s7", title: "Build the HTML review version", done: false, assigneeId: "u_claude", holds: ["email"], madeHere: ["email"], addedFor: "next:s6", startedAt: "2026-10-13T17:52:38Z" },
  ];
  beforeEach(() => {
    setup(medal());
    db.task_documents = [{ id: "d9", task_id: "t1", kind: "page", title: "", deleted_at: null }];
    db.task_document_files = [{ document_id: "d9", purpose: "page", added_by: "u_claude", removed_at: null }];
  });

  it("marked approved by the team: Claude's step is done and Brian approved: what's next? follows, on the owner", async () => {
    expect(await stepsOnReviewApproved("t1", "page", 4, false, { approverId: "u_derek" })).toBe(true);
    const s7 = steps().find((x) => x.id === "s7")!;
    expect(s7).toMatchObject({ done: true, outcome: "Brian approved (version 4)", doneBy: "u_derek" });
    const next = steps()[3];
    expect(next).toMatchObject({ title: "Brian approved: what's next?", done: false, addedFor: "ok:page:4", assigneeId: "u_derek" });
    expect(next.startedAt).toBeTruthy();
    expect(db.tasks[0].status).toBe("approved");
    // The same approval again (the task page got there too): nothing more.
    expect(await stepsOnReviewApproved("t1", "page", 4, false, { approverId: "u_derek" })).toBe(false);
    expect(steps()).toHaveLength(4);
  });

  it("the client's own button does the same, saying the version they saw", async () => {
    expect(await stepsOnReviewApproved("t1", "page", 6, true, { shown: 5 })).toBe(true);
    expect(steps().find((x) => x.id === "s7")).toMatchObject({ done: true, outcome: "Brian approved (version 5)", doneBy: "client" });
    expect(steps()[3].title).toBe("Brian approved: what's next?");
  });

  it("a step waiting on Brian still takes it, as before", async () => {
    setup([...medal(), { id: "w", title: "Waiting on Brian to review the review", done: false, onClient: true, waitsOn: "page" }]);
    expect(await stepsOnReviewApproved("t1", "page", 4, true)).toBe(true);
    expect(steps().find((x) => x.id === "w")).toMatchObject({ done: true, outcome: "Brian approved" });
    expect(steps().find((x) => x.id === "s7")!.done).toBe(false);
  });
});

describe("a What's next keeps its suggested next step", () => {
  it("is kept once, and only on a step still asking", async () => {
    const { setSuggestedNext } = await import("./stepsServer");
    setup([{ id: "a", title: "Built it", done: true }, { id: "q", title: "Brian approved: what's next?", done: false, addedFor: "ok:page:4" }]);
    expect(await setSuggestedNext("t1", "q", { name: "Put it in the Bulk customers blast", kind: "page" })).toBe(true);
    expect(steps()[1].suggested).toEqual({ name: "Put it in the Bulk customers blast", kind: "page" });
    expect(await setSuggestedNext("t1", "q", { name: "Other" })).toBe(false);
    expect(await setSuggestedNext("t1", "a", { name: "Other" })).toBe(false);
  });
});

// Brian's "Hot Chocolate" task, 2026-10-16: Chelsea's email (with a file)
// landed on it while it was Done with no steps, and nothing happened.
describe("a client's message on a finished task, or one with no steps", () => {
  const email = (id = "msg_1", over: Partial<{ subject: string; body: string; from: string }> = {}) => ({
    id, subject: "Re: 2026/2027 Hot Chocolate Asset Discussion", body: "Here are the logos for next year, can you start on the banner?", at: "2026-10-16T18:28:43Z",
    from: "Chelsea Proctor", fileKey: "rfc:abc", ...over,
  });
  beforeEach(() => { comments.length = 0; });

  it("a Done task opens again with a Reply step holding the email, and says so", async () => {
    const { stepsOnClientEmail } = await import("./stepsServer");
    setup([
      { id: "a", title: "Design the banner", done: true, doneAt: "2026-10-05T20:01:22Z", outcome: "Closed with the task" },
      { id: "f", title: "Task done", done: true, addedFor: "finished", outcome: "Done by Derek" },
    ]);
    db.tasks[0].status = "done";
    expect(await stepsOnClientEmail("t1", email())).toBe(true);
    expect(db.tasks[0].status).toBe("in_progress");
    expect(steps().map((x) => [x.title, x.done])).toEqual([["Design the banner", true], ["Reply to Chelsea: 2026/2027 Hot Chocolate Asset Discussion", false]]);
    const reply = steps()[1];
    expect(reply).toMatchObject({ makes: "email", addedFor: "reply:msg_1", assigneeId: "u_derek" });
    expect(reply.startedAt).toBeTruthy();
    expect(reply.fromEmails).toEqual([expect.objectContaining({ messageId: "msg_1", from: "Chelsea Proctor", fileKey: "rfc:abc", at: "2026-10-16T18:28:43Z" })]);
    expect(comments.map((c) => c.comment.body)).toEqual(["Reopened: Chelsea wrote on Oct 16"]);
  });

  it("an on hold task opens again too", async () => {
    const { stepsOnClientEmail } = await import("./stepsServer");
    setup([{ id: "a", title: "Design the banner", done: false, startedAt: "2026-10-01T00:00:00Z" }]);
    db.tasks[0].status = "on_hold";
    expect(await stepsOnClientEmail("t1", email())).toBe(true);
    expect(db.tasks[0].status).toBe("in_progress");
    expect(steps().map((x) => x.title)).toEqual(["Reply to Chelsea: 2026/2027 Hot Chocolate Asset Discussion", "Design the banner"]);
    expect(comments).toHaveLength(1);
  });

  it("a task with no steps gets the Reply step, open or Done", async () => {
    const { stepsOnClientEmail } = await import("./stepsServer");
    setup([]);
    db.tasks[0].status = "get_started";
    expect(await stepsOnClientEmail("t1", email())).toBe(true);
    expect(steps()).toHaveLength(1);
    expect(steps()[0]).toMatchObject({ title: "Reply to Chelsea: 2026/2027 Hot Chocolate Asset Discussion", done: false });
    expect(db.tasks[0].status).toBe("in_progress");
    // Open, so nothing was reopened.
    expect(comments).toHaveLength(0);
    setup([]);
    db.tasks[0].status = "done";
    expect(await stepsOnClientEmail("t1", email())).toBe(true);
    expect(db.tasks[0].status).toBe("in_progress");
    expect(steps()[0].fromEmails?.[0].messageId).toBe("msg_1");
    expect(comments).toHaveLength(1);
  });

  it("an automatic message changes nothing", async () => {
    const { stepsOnClientEmail, stepsOnClientMessage } = await import("./stepsServer");
    for (const over of [
      { subject: "Automatic reply: Hot Chocolate", body: "I am out of the office until Monday." },
      { subject: "Re: Hot Chocolate", body: "I'm currently out of the office with limited access to email." },
      { subject: "Accepted: Hot Chocolate kickoff", body: "Chelsea accepted this invitation." },
      { subject: "Your receipt", body: "We received your payment of $250.00. Thank you." },
    ]) {
      setup([]);
      db.tasks[0].status = "done";
      expect(await stepsOnClientEmail("t1", email("msg_auto", over))).toBe(false);
      expect(db.tasks[0].status).toBe("done");
      expect(steps()).toEqual([]);
    }
    setup([]);
    db.tasks[0].status = "done";
    expect(await stepsOnClientMessage("t1", { ...email("msg_bulk"), channel: "email", bulk: true })).toBe(false);
    expect(comments).toHaveLength(0);
  });

  it("the same message twice adds it once", async () => {
    const { stepsOnClientEmail } = await import("./stepsServer");
    setup([{ id: "f", title: "Task done", done: true, addedFor: "finished" }]);
    db.tasks[0].status = "done";
    expect(await stepsOnClientEmail("t1", email())).toBe(true);
    expect(await stepsOnClientEmail("t1", email())).toBe(false);
    expect(steps()).toHaveLength(1);
    expect(steps()[0].fromEmails).toHaveLength(1);
    expect(comments).toHaveLength(1);
  });

  it("a text reopens a Done task with a step holding it; on an open task with steps it changes nothing", async () => {
    const { stepsOnClientMessage } = await import("./stepsServer");
    setup([{ id: "a", title: "Design the banner", done: true }]);
    db.tasks[0].status = "done";
    expect(await stepsOnClientMessage("t1", { id: "msg_t", subject: null, body: "Can we move the race date on the banner?", at: "2026-10-16T18:00:00Z", from: "Brian Goodell", channel: "sms" })).toBe(true);
    expect(db.tasks[0].status).toBe("in_progress");
    expect(steps()[1]).toMatchObject({ title: "Reply to Brian's text", addedFor: "reply:msg_t" });
    expect(steps()[1].makes).toBeUndefined();
    expect(comments.map((c) => c.comment.body)).toEqual(["Reopened: Brian wrote on Oct 16"]);
    setup([{ id: "a", title: "Design the banner", done: false }]);
    expect(await stepsOnClientMessage("t1", { id: "msg_t2", subject: null, body: "Can we move the race date on the banner?", at: "2026-10-16T18:00:00Z", from: "Brian Goodell", channel: "sms" })).toBe(false);
  });

  it("a Conversation task keeps its own rules, and Inbox links leave the status", async () => {
    const { stepsOnClientEmail } = await import("./stepsServer");
    setup([]);
    db.tasks[0].priority = "conversation";
    expect(await stepsOnClientEmail("t1", email())).toBe(false);
    setup([{ id: "a", title: "Design the banner", done: true }]);
    db.tasks[0].status = "done";
    expect(await stepsOnClientEmail("t1", email(), true)).toBe(true);
    expect(db.tasks[0].status).toBe("done");
    expect(comments).toHaveLength(0);
  });
});

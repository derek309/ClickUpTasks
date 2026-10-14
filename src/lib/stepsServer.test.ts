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
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
    then: (res: (x: { data: Row[] }) => unknown) => {
      const hit = rows();
      if (patch) hit.forEach((r) => Object.assign(r, patch, { updated_at: `${Date.now()}${Math.random()}` }));
      return Promise.resolve({ data: hit }).then(res);
    },
  };
  return b;
}
vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: string) => builder(t) }, adminConfigured: true }));

const { stepsOnReviewSent, stepsOnReviewChanges, stepsOnReviewApproved, stepsOnClientReply, stepsOnClientChanges, stepsOnCommentAfterApproval, stepsOnCommentRemoved, tickStep, tickTodo, holdDraftOnStep, stepsOnMeetingTranscript } = await import("./stepsServer");

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
    expect(steps().map((s) => [s.title, s.done])).toEqual([["Write the newsletter", true], ["Waiting on Brian to review Newsletter", false], ["Schedule it", false]]);
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

  it("a to-do from a client comment is ticked and its comment resolved", async () => {
    setup([{ id: "a", title: "Make Brian's changes", done: false, todos: [{ id: "td1", title: "Change the headline", done: false, fromClient: true, commentId: "c1" }] }]);
    db.task_documents[0].id = "d1";
    expect(await tickTodo("t1", "headline", true, "Claude")).toContain("resolved");
    expect(steps()[0].todos![0].done).toBe(true);
    expect(db.task_document_comments[0].completed_at).toBeTruthy();
  });

  it("a drafted email gets its own step right after the current one", async () => {
    expect(await holdDraftOnStep("t1", "Your newsletter")).toBe("Email Brian: Your newsletter");
    expect(steps().map((x) => x.title)).toEqual(["Write the newsletter", "Email Brian: Your newsletter", "Schedule it"]);
    expect(steps()[1].holds).toEqual(["email"]);
    // A second draft keeps to the step that holds one.
    expect(await holdDraftOnStep("t1", "Other")).toBe("Email Brian: Your newsletter");
    expect(steps()).toHaveLength(3);
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
});

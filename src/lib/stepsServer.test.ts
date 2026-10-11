import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Subtask } from "./data";

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

const { stepsOnReviewSent, stepsOnReviewChanges, stepsOnReviewApproved, stepsOnClientReply, stepsOnClientChanges, stepsOnCommentAfterApproval, stepsOnCommentRemoved } = await import("./stepsServer");

const steps = () => (db.tasks[0].subtasks as Subtask[]);
function setup(subtasks: Subtask[]) {
  db.tasks = [{ id: "t1", subtasks, assignee_id: "u_derek", client_id: "cl_1", updated_at: "1" }];
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

  it("a portal request lands on a changes step made in front of the current one", async () => {
    setup([{ id: "a", title: "Write the newsletter", done: false }, { id: "r1", title: "Make the logo bigger", done: false, fromClient: true }]);
    expect(await stepsOnClientChanges("t1")).toBe(true);
    const made = steps().find((s) => s.title === "Changes from Brian")!;
    expect(steps().find((s) => s.id === "r1")!.stepId).toBe(made.id);
    expect(steps().map((s) => s.title).slice(0, 2)).toEqual(["Changes from Brian", "Write the newsletter"]);
    expect(await stepsOnClientChanges("t1")).toBe(false);
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
});

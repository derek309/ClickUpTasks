import { describe, expect, it } from "vitest";
import { addFoldIns, askFromNotes, askFromTaskTitle, foldInNeedBys, foldInTasks, needsFoldIn, withClientStep, type FoldInTask } from "./foldIn";
import { isClientWait, waitsOnClientByTitle } from "./afterThis";
import { requestFromTask } from "./clientRequests";
import type { Subtask } from "./data";

// James Brenneis's 18 tasks flagged waiting on him (live, read 2026-10-15),
// with the description lines the asks read.
const JAMES: { title: string; notes?: string; ask: string }[] = [
  { title: "Record the two welcome videos (Medicare Advantage, Medicare Supplement)", ask: "Record the two welcome videos (Medicare Advantage, Medicare Supplement)" },
  { title: "Medicare one to one consent under every Submit button that offers Medicare", notes: "FOLLOW UP: Tue 6 Oct.\n\nUse the compliance reviewer's email word for word (task \"Consent email, plan counts and PlanEnroll link\").", ask: "Send what we need for: Medicare one to one consent under every Submit button that offers Medicare" },
  { title: "Footer consent: \"I also consent\" version and Reply STOP", notes: "FOLLOW UP: Tue 6 Oct.\n\nBlocked on: paragraph 2 of the reviewer's email.\n\nChanges to the footer", ask: "Send paragraph 2 of the reviewer's email" },
  { title: "Send the static Facebook ad with the reviewer's changes", ask: "Send the static Facebook ad with the reviewer's changes" },
  { title: "Consent email, plan counts and PlanEnroll link from James", notes: "FOLLOW UP: Mon 5 Oct, then Wed 7 Oct.\n\nWhat we need from James:\n1. Forward the compliance reviewer's 4:47 email", ask: "Send consent email, plan counts and PlanEnroll link" },
  { title: "Send any other changes to the AEP email and text wording", ask: "Send any other changes to the AEP email and text wording" },
  { title: "Add the 2027 Medicare disclaimer (Health, Medicare, Keep Your Dr)", notes: "FOLLOW UP: Wed 7 Oct.\n\nThe Third Party Marketing Organization disclaimer. Blocked on James's carrier and plan counts (task \"Consent email, plan counts and PlanEnroll link\").", ask: "Send your carrier and plan counts" },
  { title: "Swap the form checkbox text for the one to one consent", notes: "FOLLOW UP: Wed 7 Oct.\n\nkeepyourdr.com's form checkbox says: ...\n\nBlocked on: the reviewer's email (paragraph 1 for the checkbox, paragraph 2 for the footer).", ask: "Send the reviewer's email (paragraph 1 for the checkbox, paragraph 2 for the footer)" },
  { title: "Test the 858-283-4447 line rings through the LeadConnector app", ask: "Test the 858-283-4447 line rings through the LeadConnector app" },
  { title: "Clean up contacts: deceased, duplicates, agents, spam", ask: "Clean up contacts: deceased, duplicates, agents, spam" },
  { title: "Other absolute claims to clear with James", notes: "FOLLOW UP: Fri 9 Oct.", ask: "Clear the other absolute claims" },
  { title: "Content for partnerwithtrinity.com", notes: "For the agent site (5 Oct meeting). Send here:\n1. What you do for agents", ask: "Send the content for partnerwithtrinity.com" },
  { title: "Tag every client in GoHighLevel before the blast", ask: "Tag every client in GoHighLevel before the blast" },
  { title: "Put the Medicare disclaimer and PlanEnroll back when James sends them", notes: "Taken off the site on 5 Oct because they were placeholders. Waiting on James (task \"Consent email, plan counts and PlanEnroll link\"): his carrier count and plan count for the Third Party Marketing Organization disclaimer, and his own PlanEnroll link.", ask: "Send your carrier count and plan count for the Third Party Marketing Organization disclaimer, and your own PlanEnroll link" },
  { title: "Add the PlanEnroll self enrollment option", notes: "FOLLOW UP: Tue 6 Oct.\n\nBlocked on: James's own PlanEnroll link.\n\nFrom the compliance call", ask: "Send your own PlanEnroll link" },
  { title: "Record short product page videos", ask: "Record short product page videos" },
  { title: "A video of James on every product page", notes: "James, 5 Oct: so the site does not feel thrown together by AI", ask: "Send what we need for: A video of James on every product page" },
  { title: "Develop Keep the Docter page on Website", notes: "", ask: "Send what we need for: Develop Keep the Docter page on Website" },
];

describe("askFromTaskTitle", () => {
  it.each(JAMES)("$title", ({ title, notes, ask }) => {
    expect(askFromTaskTitle(title, { first: "James", notes })).toBe(ask);
  });
  it("never leaves the name in a from or with", () => {
    for (const j of JAMES) expect(askFromTaskTitle(j.title, { first: "James", notes: j.notes })).not.toMatch(/\b(from|with) James\b|James's/);
  });
  it("reads HTML notes", () => {
    expect(askFromNotes("<p>FOLLOW UP: Tue.</p><p>Blocked on: <b>Brian's</b> logo.</p>", "Brian")).toBe("Send your logo");
  });
  it("a Blocked on that only names them is not an ask", () => {
    expect(askFromNotes("Blocked on James", "James")).toBeNull();
    expect(askFromTaskTitle("Build the pricing page", { first: "James", notes: "Blocked on James." })).toBe("Send what we need for: Build the pricing page");
  });
});

describe("foldInNeedBys", () => {
  it("first 3 business days out, then every 2 business days", () => {
    // Thu Oct 15 2026: Tue 20, Thu 22, Mon 26, Wed 28.
    expect(foldInNeedBys(4, "2026-10-15")).toEqual(["2026-10-20", "2026-10-22", "2026-10-26", "2026-10-28"]);
  });
  it("skips weekends from a Saturday", () => {
    expect(foldInNeedBys(2, "2026-10-17")).toEqual(["2026-10-21", "2026-10-23"]);
  });
  it("none for none", () => expect(foldInNeedBys(0, "2026-10-15")).toEqual([]));
});

describe("the waiting step rule", () => {
  it("a step that says it waits on the client by name is their turn", () => {
    expect(waitsOnClientByTitle("Waiting on James Reply")).toBe(true);
    expect(waitsOnClientByTitle("Wait for James to send the logo")).toBe(true);
    expect(waitsOnClientByTitle("Waiting on the client")).toBe(true);
    expect(waitsOnClientByTitle("Waiting on James's answer")).toBe(true);
    expect(isClientWait({ title: "Waiting on James Reply", assigneeId: null })).toBe(true);
  });
  it("not a teammate's, a plain word, or another name", () => {
    expect(waitsOnClientByTitle("Waiting on Justin", { assigneeId: "u_justin" })).toBe(false);
    expect(waitsOnClientByTitle("Waiting for approval")).toBe(false);
    expect(waitsOnClientByTitle("Waiting For Approval")).toBe(false);
    expect(waitsOnClientByTitle("Waiting on us")).toBe(false);
    expect(waitsOnClientByTitle("Waiting on Brian", { first: "James" })).toBe(false);
    expect(waitsOnClientByTitle("Remind James")).toBe(false);
    expect(isClientWait({ title: "Rebuild the page: what's next?" })).toBe(false);
  });
  it("James's GoHighLevel tagging task is now a request", () => {
    const subtasks = [
      { id: "s1", title: "Remind James", done: true, assigneeId: "u_derek" },
      { id: "s2", title: "Waiting on James Reply", done: false, assigneeId: null },
    ] as Subtask[];
    expect(requestFromTask({ id: "t_qb0joxvh", title: "Tag every client in GoHighLevel before the blast", clientId: "cl_x", subtasks })?.stepId).toBe("s2");
  });
});

const task = (o: Partial<FoldInTask> & { id: string }): FoldInTask & { subtasks: Subtask[] } =>
  ({ title: o.id, status: "waiting", waitingOnClient: true, projectId: "p1", due: null, ...o, subtasks: o.subtasks ?? [] });

describe("which tasks fold in", () => {
  it("waiting, shared and open, with no client step", () => {
    expect(needsFoldIn(task({ id: "a" }))).toBe(true);
    expect(needsFoldIn(task({ id: "b", waitingOnClient: false, status: "todo" }))).toBe(false);
    expect(needsFoldIn(task({ id: "c", status: "waiting", waitingOnClient: false }))).toBe(true);
    expect(needsFoldIn(task({ id: "d", private: true }))).toBe(false);
    expect(needsFoldIn(task({ id: "e", hiddenFromClient: true }))).toBe(false);
    expect(needsFoldIn(task({ id: "f", subtasks: [{ id: "s", title: "Send the logo", done: false, onClient: true }] }))).toBe(false);
    expect(needsFoldIn(task({ id: "g", subtasks: [{ id: "s", title: "Waiting on James Reply", done: false }] }))).toBe(false);
    expect(needsFoldIn(task({ id: "h", subtasks: [{ id: "s", title: "Rebuild the page: what's next?", done: false, assigneeId: "u_derek" }] }))).toBe(true);
  });
  it("grouped by list, each by its due date, undated last", () => {
    const out = foldInTasks([
      task({ id: "x1", projectId: "p2", due: "2026-10-12" }),
      task({ id: "y1", projectId: "p1", due: "2026-10-06" }),
      task({ id: "x2", projectId: "p2", due: null }),
      task({ id: "y2", projectId: "p1", due: "2026-10-16" }),
      task({ id: "x0", projectId: "p2", due: "2026-10-07" }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["y1", "y2", "x0", "x1", "x2"]);
  });
});

describe("adding a client step", () => {
  const ids = () => { let n = 0; return () => `new${++n}`; };
  it("goes in before the first open step; done steps stay", () => {
    const subtasks = [
      { id: "a", title: "Rebuild the page", done: true },
      { id: "b", title: "Rebuild the page: what's next?", done: false },
      { id: "c", title: "Derek reviews", done: true },
      { id: "d", title: "Follow-up review email", done: false },
    ] as Subtask[];
    const out = withClientStep(subtasks, { ask: "Send the copy", needBy: "2026-10-20", now: "2026-10-15T20:00:00.000Z", makeId: ids() })!;
    expect(out.map((s) => s.id)).toEqual(["a", "new1", "b", "c", "d"]);
    expect(out[1]).toEqual({ id: "new1", title: "Send the copy", done: false, onClient: true, due: "2026-10-20", startedAt: "2026-10-15T20:00:00.000Z" });
    expect(requestFromTask({ id: "t", title: "T", clientId: "c", subtasks: out })?.stepId).toBe("new1");
  });
  it("a task with no steps gets it as its only step", () => {
    expect(withClientStep([], { ask: "Send it", needBy: "2026-10-20", now: "n", makeId: ids() })!.map((s) => s.title)).toEqual(["Send it"]);
  });
  it("skips a task whose current step is already theirs", () => {
    expect(withClientStep([{ id: "a", title: "Send it", done: false, onClient: true }], { ask: "x", needBy: "2026-10-20", now: "n", makeId: ids() })).toBeNull();
  });
  it("writes one task per call, each after the one before", async () => {
    const tasks = new Map([
      ["t1", task({ id: "t1" })],
      ["t2", task({ id: "t2", subtasks: [{ id: "s", title: "Send it", done: false, onClient: true }] })],
      ["t3", task({ id: "t3", status: "todo" })],
    ]);
    const calls: { id: string; patch: { subtasks: Subtask[]; status?: string } }[] = [];
    let inFlight = 0;
    let most = 0;
    const progress: string[] = [];
    const added = await addFoldIns([
      { taskId: "t1", ask: "Send the logo", needBy: "2026-10-20" },
      { taskId: "t2", ask: "Send it again", needBy: "2026-10-22" },
      { taskId: "t3", ask: "Send the copy", needBy: "2026-10-26" },
    ], {
      getTask: (id) => tasks.get(id),
      patch: async (id, patch) => {
        inFlight++; most = Math.max(most, inFlight);
        calls.push({ id, patch });
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
      now: () => "2026-10-15T20:00:00.000Z", makeId: ids(),
      onProgress: (d, n) => progress.push(`${d} of ${n}`),
    });
    expect(added).toBe(2);
    expect(most).toBe(1);
    expect(calls.map((c) => c.id)).toEqual(["t1", "t3"]);
    expect(calls[0].patch).toEqual({ subtasks: [expect.objectContaining({ title: "Send the logo", onClient: true, due: "2026-10-20" })] });
    // Not yet "waiting": it is kept waiting on them.
    expect(calls[1].patch.status).toBe("waiting");
    expect(progress).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
  });
});

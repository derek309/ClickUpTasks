// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, taskDatesForStepDue as mcpDates, stepStage as mcpStage, statusForStep as mcpStatus } from "../../mcp/core.mjs";
import { addBusinessDaysIso, pacificToday } from "../../mcp/queue.mjs";
import { taskDatesForStepDue, stepStage, statusForStep, type TaskStatus } from "./data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// update_step (Derek, 2026-10-14): who and when on a step that already
// exists, by the app's rules, one step written through patch_subtask. Supabase
// (and Claude in the cloud) are faked: the task lives in memory, the locked
// step writes apply to it, and these check what is written and read back.

const ME = "u_derek";
const people = [{ member_id: "u_derek", name: "Derek Fox" }, { member_id: "u_justin", name: "Justin Lee" }];
const baseTask = (over: Record<string, unknown> = {}) => ({
  id: "t_1", title: "Spring flyer", status: "in_progress", priority: "normal", due: "2026-10-16", follow_up_at: null, client_id: "cl_1", project_id: "p_1",
  comments: [], attachments: [], deleted_at: null, is_private: false, assignee_id: ME, draft_email: null, queue_pos: null,
  subtasks: [
    { id: "s_1", title: "Draft the copy", done: true },
    { id: "s_2", title: "Design the flyer", done: false, due: "2026-10-20", todos: [{ id: "td_1", title: "Pick a photo", done: false }] },
    { id: "s_3", title: "Print it", done: false },
  ],
  ...over,
});

let state: any;
let writes: { method: string; url: string; body: any }[] = [];
let urls: string[] = [];
function fake(opts: { task?: any; queue?: unknown; actions?: unknown[]; cloud?: { ok: boolean; body: unknown } } = {}) {
  state = JSON.parse(JSON.stringify(opts.task ?? baseTask()));
  writes = [];
  urls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    urls.push(u);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : null;
    if (method !== "GET") writes.push({ method, url: u, body });
    const ok = (rows: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(rows) }) as any;
    if (u.startsWith("https://api.anthropic.com/")) return ok(opts.cloud?.body ?? {}, opts.cloud?.ok === false ? 500 : 200);
    const path = decodeURIComponent(u.split("/rest/v1/")[1] ?? "");
    if (path.startsWith("rpc/patch_subtask")) {
      state.subtasks = state.subtasks.map((s: any) => {
        if (s.id !== body.subtask_id) return s;
        const out = { ...s, ...body.patch };
        for (const [k, v] of Object.entries(body.patch)) if (v === null) delete out[k];
        return out;
      });
      return ok(null);
    }
    if (path.startsWith("rpc/")) return ok(null);
    if (path.startsWith("tasks?id=eq.") && method === "PATCH") { Object.assign(state, body); return ok([state]); }
    if (path.startsWith("tasks")) return ok([state]);
    if (path.startsWith("profiles")) return ok(people);
    if (path.startsWith("clients")) return ok([{ name: "Pam Macias" }]);
    if (path.startsWith("projects?select=queue")) return ok([{ queue: opts.queue ?? null }]);
    if (path.startsWith("task_actions") && method === "GET") return ok(opts.actions ?? []);
    return ok([]);
  }));
}
async function connect(extra: Record<string, unknown> = {}) {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: ME, ...extra });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = async (c: Client, args: Record<string, unknown>) => ((await c.callTool({ name: "update_step", arguments: { task_id: "t_1", ...args } })) as any).content[0].text as string;
const stepWrites = () => writes.filter((w) => w.url.includes("rpc/patch_subtask"));
const taskWrite = () => writes.find((w) => w.method === "PATCH" && w.url.includes("/rest/v1/tasks?id=eq."))?.body;
const step = (id: string) => state.subtasks.find((s: any) => s.id === id);
const today = pacificToday();

beforeEach(() => { vi.stubEnv("CLAUDE_ROUTINE_ID", ""); vi.stubEnv("CLAUDE_ROUTINE_TOKEN", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("update_step: whose turn", () => {
  it("a teammate on the current step: on their list today, the task Delegated with the handoff dates, the follow up watching it; one step written, never the list", async () => {
    fake({ actions: [{ id: "a_1", next_step_watch: null }] });
    const text = await call(await connect(), { step_id: "s_2", assignee: "u_justin" });
    expect(stepWrites()).toEqual([{ method: "POST", url: expect.any(String), body: { task_id: "t_1", subtask_id: "s_2", patch: { assigneeId: "u_justin", followUpAt: today, givenBy: ME }, author: null } }]);
    expect(taskWrite()).toEqual({ status: "delegated", due: "2026-10-20", updated_by: null });
    expect(writes.some((w) => w.body && "subtasks" in w.body)).toBe(false);
    expect(writes.find((w) => w.url.includes("task_actions?id=eq.a_1"))?.body).toEqual({ next_step_watch: "handoff:s_2" });
    // The step as get_task shows it.
    expect(text).toContain("2. [CURRENT] Design the flyer [s_2] · Justin Lee · due 2026-10-20");
    expect(text).toContain("The task: status delegated · due 2026-10-20");
  });

  it("a later step handed to a teammate leaves the task alone", async () => {
    fake();
    await call(await connect(), { step_id: "Print", assignee: "u_justin", due: "2026-10-25" });
    expect(stepWrites()[0].body.patch).toEqual({ assigneeId: "u_justin", followUpAt: today, givenBy: ME, due: "2026-10-25" });
    expect(taskWrite()).toBeUndefined();
  });

  it("back to the owner: the step's own stage, no handoff dates", async () => {
    fake({ task: baseTask({ status: "delegated", subtasks: [{ id: "s_2", title: "Review the flyer", done: false, assigneeId: "u_justin", followUpAt: "2026-10-15" }] }) });
    await call(await connect(), { step_id: "s_2", assignee: "me" });
    expect(stepWrites()[0].body.patch).toEqual({ assigneeId: ME });
    expect(taskWrite()).toEqual({ status: "review", updated_by: null });
  });

  it("Claude, not set up: due today, no follow up, on Claude's list with the task left on its owner", async () => {
    fake();
    const text = await call(await connect(), { step_id: "s_2", assignee: "claude", due: "2026-10-30" });
    const patch = stepWrites()[0].body.patch;
    expect(patch).toMatchObject({ assigneeId: "u_claude", due: today, followUpAt: null, cloudError: "not_set_up", toClaudeAt: expect.any(String) });
    expect(taskWrite()).toEqual({ follow_up_at: null, updated_by: null });
    expect(urls.some((u) => u.includes("anthropic.com"))).toBe(false);
    expect(text).toContain("on Claude's list");
    expect(text).toContain("due today");
  });

  it("Claude, set up: Delegated, Claude started in the cloud, its link on the step", async () => {
    fake({ cloud: { ok: true, body: { claude_code_session_url: "https://claude.ai/code/s_x" } } });
    const text = await call(await connect({ claudeRoutine: { id: "r_1", token: "tok" } }), { step_id: "s_2", assignee: "claude" });
    expect(stepWrites()[0].body.patch).toMatchObject({ assigneeId: "u_claude", due: today, cloudError: null });
    expect(taskWrite()).toEqual({ follow_up_at: null, status: "delegated", updated_by: null });
    expect(urls.find((u) => u.includes("anthropic.com"))).toContain("/routines/r_1/fire");
    expect(stepWrites()[1].body.patch).toEqual({ cloudSession: { url: "https://claude.ai/code/s_x", at: expect.any(String) }, cloudError: null });
    expect(writes.find((w) => w.url.includes("rpc/append_comment"))?.body.comment.body).toBe('started Claude on "Design the flyer" in the cloud');
    expect(text).toContain("https://claude.ai/code/s_x");
  });

  it("a what's next given to Claude becomes Claude's step, named for what comes next", async () => {
    fake({ task: baseTask({ subtasks: [{ id: "s_1", title: "Draft", done: true }, { id: "s_n", title: "Draft: what's next?", done: false, addedFor: "next:s_1", suggested: { name: "Send the draft" } }] }) });
    await call(await connect(), { step_id: "s_n", assignee: "claude" });
    expect(stepWrites()[0].body.patch).toMatchObject({ title: "Send the draft", asked: { title: "Draft: what's next?", assigneeId: null, due: null } });
  });

  it("the client: an ask holding the email, on the task's owner, the email off the step that held it", async () => {
    fake({ task: baseTask({ status: "delegated", subtasks: [
      { id: "s_e", title: "Email Pam", done: true, holds: ["email", "doc"], namedFrom: { title: "Draft", key: "email", as: "Email Pam" } },
      { id: "s_2", title: "Send the logo", done: false, assigneeId: "u_justin", followUpAt: "2026-10-15" },
    ] }) });
    const text = await call(await connect(), { step_id: "s_2", assignee: "client", due: "2026-10-21" });
    expect(stepWrites()[0].body.patch).toEqual({ assigneeId: ME, followUpAt: null, holds: ["email"], madeHere: ["email"], due: "2026-10-21", title: "Ask Pam: Send the logo" });
    expect(stepWrites()[1].body).toEqual({ task_id: "t_1", subtask_id: "s_e", patch: { holds: ["doc"], namedFrom: null, title: "Draft" }, author: null });
    // The task no longer reads Delegated; its date stays (the ask's date is the client's).
    expect(taskWrite()).toEqual({ status: "in_progress", updated_by: null });
    expect(text).toContain("Ask Pam: Send the logo [s_2]");
    expect(text).toContain("draft_email");
  });
});

describe("update_step: when", () => {
  it("a new due date on the owner's current step moves the task's due date", async () => {
    fake();
    await call(await connect(), { step_id: "s_2", due: "2026-10-23" });
    expect(stepWrites()[0].body.patch).toEqual({ due: "2026-10-23" });
    expect(taskWrite()).toEqual({ due: "2026-10-23", updated_by: null });
  });
  it("a teammate's current step: due that day, no follow up made from it", async () => {
    fake({ task: baseTask({ subtasks: [{ id: "s_2", title: "Design", done: false, assigneeId: "u_justin" }] }) });
    await call(await connect(), { step_id: "s_2", due: "2026-10-23", follow_up: "2026-10-21" });
    expect(stepWrites()[0].body.patch).toEqual({ due: "2026-10-23", followUpAt: "2026-10-21" });
    expect(taskWrite()).toEqual({ due: "2026-10-23", updated_by: null });
  });
  it("a task in a queue's Up next keeps no date; a cleared date leaves the task alone", async () => {
    fake({ task: baseTask({ due: null, queue_pos: 2000 }), queue: { now: 1, spacing: 3 } });
    await call(await connect(), { step_id: "s_2", due: "2026-10-23" });
    expect(taskWrite()).toBeUndefined();
    fake();
    await call(await connect(), { step_id: "s_2", due: null });
    expect(stepWrites()[0].body.patch).toEqual({ due: null });
    expect(step("s_2").due).toBeUndefined();
    expect(taskWrite()).toBeUndefined();
  });
});

describe("update_step: name, directions and to-dos", () => {
  it("replaces the directions and adds to the step's to-dos", async () => {
    fake();
    await call(await connect(), { step_id: "s_2", title: "Design the spring flyer", directions: "Use the **brand** colors", add_todos: ["Export a PDF", " "] });
    const patch = stepWrites()[0].body.patch;
    expect(patch).toMatchObject({ title: "Design the spring flyer", notes: "<p>Use the <strong>brand</strong> colors</p>" });
    expect(patch.todos).toEqual([{ id: "td_1", title: "Pick a photo", done: false }, { id: expect.stringMatching(/^td_/), title: "Export a PDF", done: false }]);
    expect(taskWrite()).toBeUndefined();
  });
  it("a done step can be renamed", async () => {
    fake();
    await call(await connect(), { step_id: "s_1", title: "Write the copy" });
    expect(stepWrites()[0].body.patch).toEqual({ title: "Write the copy" });
  });
});

describe("update_step refuses, writing nothing", () => {
  for (const [what, args, said, over] of [
    ["an unknown member", { step_id: "s_2", assignee: "u_nobody" }, "Unknown member", {}],
    ["who or when on a done step", { step_id: "s_1", due: "2026-10-22" }, "only its name and directions", {}],
    ["to-dos on a done step", { step_id: "s_1", add_todos: ["x"] }, "only its name and directions", {}],
    ["the client on a Personal task", { step_id: "s_2", assignee: "client" }, "no client to ask", { client_id: "personal" }],
    ["the client on a private task", { step_id: "s_2", assignee: "client" }, "no client to ask", { is_private: true }],
    ["a step that isn't there", { step_id: "s_9" }, "No item matching", {}],
    ["a portal request", { step_id: "s_r", due: "2026-10-22" }, "a request from the client's portal", { subtasks: [{ id: "s_r", title: "New photo", done: false, fromClient: true }] }],
    ["nothing to change", { step_id: "s_2" }, "Nothing to change", {}],
  ] as [string, Record<string, unknown>, string, Record<string, unknown>][]) {
    it(what, async () => {
      fake({ task: baseTask(over) });
      expect(await call(await connect(), args)).toContain(said);
      expect(writes).toHaveLength(0);
    });
  }
  it("a teammate's private task is not there", async () => {
    fake({ task: baseTask({ is_private: true, assignee_id: "u_justin" }) });
    expect(await call(await connect(), { step_id: "s_2", due: "2026-10-22" })).toBe("No task t_1.");
    expect(writes).toHaveLength(0);
  });
  it("reads and writes live rows only", async () => {
    fake();
    await call(await connect(), { step_id: "s_2", due: "2026-10-23" });
    for (const u of urls.filter((x) => /\/rest\/v1\/(tasks|clients|projects)/.test(x))) expect(u).toContain("deleted_at=is.null");
  });
});

// The MCP's copies of the app's step rules agree with src/lib/data.ts.
describe("the step rules match the app's", () => {
  it("taskDatesForStepDue", () => {
    const cases = [];
    for (const due of [null, "2026-10-16", "2026-10-17"]) for (const isCurrent of [true, false])
      for (const stepAssignee of [undefined, null, "u_derek", "u_justin", "u_claude"]) for (const onClient of [undefined, true]) for (const upNext of [undefined, true])
        cases.push({ due, isCurrent, stepAssignee, taskOwner: "u_derek", onClient, upNext });
    cases.push({ due: "2026-10-16", isCurrent: true, stepAssignee: "u_justin", taskOwner: null });
    for (const c of cases) expect(mcpDates(c)).toEqual(taskDatesForStepDue(c));
  });
  it("stepStage and statusForStep", () => {
    const statuses: TaskStatus[] = ["todo", "in_progress", "review", "waiting", "on_hold", "delegated", "done"];
    for (const title of ["Design it", "Fix the logo", "Client review", "Wait for photos"]) for (const assigneeId of [undefined, "u_derek", "u_justin"])
      for (const onClient of [undefined, true]) for (const stage of [undefined, "review" as TaskStatus]) {
        const s = { title, assigneeId, onClient, stage };
        expect(mcpStage(s, "u_derek")).toBe(stepStage(s, "u_derek"));
        for (const cur of statuses) expect(mcpStatus(cur, mcpStage(s, "u_derek"))).toBe(statusForStep(cur, stepStage(s, "u_derek")));
      }
  });
});

describe("update_step and the app's drafts (Derek, 2026-10-17)", () => {
  it("setting whose turn on a draft gives it: the draft flag comes off", async () => {
    fake({ task: baseTask({ subtasks: [{ id: "s_1", title: "Hand off", done: false, draftFor: "u_justin" }] }) });
    await call(await connect(), { step_id: "s_1", assignee: "u_justin" });
    expect(stepWrites()[0].body.patch).toMatchObject({ assigneeId: "u_justin", draftFor: null, givenBy: ME });
    expect(step("s_1").draftFor).toBeUndefined();
  });
  it("get_task says a draft is not given yet", async () => {
    fake({ task: baseTask({ subtasks: [{ id: "s_1", title: "Hand off", done: false, draftFor: "u_justin" }] }) });
    const text = await call(await connect(), { step_id: "s_1", title: "Hand off the flyer" });
    expect(text).toContain("draft, not given to Justin Lee yet");
  });
});

describe("add_comment with step: Claude messages whoever gave it the step", () => {
  const callComment = async (c: Client, args: Record<string, unknown>) => ((await c.callTool({ name: "add_comment", arguments: { id: "t_1", ...args } })) as any).content[0].text as string;
  it("posts on the step, makes it a question for the giver, tells them once, and leaves the turn alone", async () => {
    fake({ task: baseTask({ subtasks: [{ id: "s_1", title: "Write subject lines", done: false, assigneeId: "u_claude", givenBy: "u_justin" }] }) });
    const text = await callComment(await connect({ memberId: "u_claude" }), { step: "s_1", text: "Which tone, warm or plain?\nI have both." });
    expect(text).toContain("Justin Lee");
    const action = writes.find((w) => w.url.endsWith("/rest/v1/task_actions"))?.body;
    expect(action).toMatchObject({ kind: "team", author_id: "u_claude", to_id: "u_justin", body: "Which tone, warm or plain?\nI have both." });
    expect(step("s_1").question).toMatchObject({ from: "u_claude", to: "u_justin", text: "Which tone, warm or plain?" });
    expect(step("s_1").assigneeId).toBe("u_claude");
    const bells = writes.filter((w) => w.url.endsWith("/rest/v1/notifications"));
    expect(bells).toHaveLength(1);
    expect(bells[0].body).toMatchObject({ recipient_id: "u_justin", kind: "message" });
  });
  it("only on Claude's own step", async () => {
    fake();
    const text = await callComment(await connect({ memberId: "u_claude" }), { step: "s_2", text: "Hi" });
    expect(text).toContain("not your step");
    expect(writes.some((w) => w.url.endsWith("/rest/v1/notifications"))).toBe(false);
  });
});

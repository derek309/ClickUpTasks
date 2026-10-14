import { describe, it, expect, vi } from "vitest";
import { save, unsavedCount } from "./db";
import type { Subtask, Task } from "./data";

// save() is the seam every write in the app goes through, and its whole job is
// to be right about whether something actually landed. These are the three
// cases that matter: it worked, it will never work, and it might work if we
// wait.
describe("save", () => {
  it("returns on the first success without retrying", async () => {
    const run = vi.fn().mockResolvedValue({ error: null, data: [1] });
    const res = await save(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(res?.error).toBeNull();
  });

  it("retries a transport failure and reports the eventual success", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ error: { message: "fetch failed" } })
      .mockResolvedValueOnce({ error: null, data: [] });
    const res = await save(run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(res?.error).toBeNull();
  });

  it("gives up immediately on a rejection that will not change", async () => {
    const before = unsavedCount();
    const run = vi.fn().mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint "x"' } });
    await save(run);
    // One attempt, not four: a constraint violation is not a network blip, and
    // retrying it only delays telling someone.
    expect(run).toHaveBeenCalledTimes(1);
    expect(unsavedCount()).toBe(before + 1);
  });

  it("counts a write that never lands, so the UI can say the screen is wrong", async () => {
    const before = unsavedCount();
    const run = vi.fn().mockResolvedValue({ error: { message: "network unreachable" } });
    await save(run);
    expect(run).toHaveBeenCalledTimes(4); // the first attempt plus three retries
    expect(unsavedCount()).toBe(before + 1);
  });

  it("treats a thrown error as a failure rather than letting it escape", async () => {
    const before = unsavedCount();
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(save(run)).resolves.toBeTruthy();
    expect(unsavedCount()).toBe(before + 1);
  });
}, 30000);

// Taking a handoff back clears the item's assignee by setting it to undefined.
// JSON drops undefined, so it has to go as null for the database to remove it.
describe("patchSubtaskDb", () => {
  it("sends a cleared field as null", async () => {
    const { supabase } = await import("./supabase");
    const { patchSubtaskDb } = await import("./db");
    const rpc = vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: null } as never);
    await patchSubtaskDb("t_1", "s_1", { assigneeId: undefined, done: true }, "u_me");
    expect(rpc).toHaveBeenCalledWith("patch_subtask", { task_id: "t_1", subtask_id: "s_1", patch: { assigneeId: null, done: true }, author: "u_me" });
    rpc.mockRestore();
  });
});

// t_mv5llezz0 (2026-10-14): Done · what's next? ticked the step through
// patch_subtask, then saved the new What's next step with a whole-list save.
// That save read the steps before the tick landed, saw the step as untouched
// by its own edit, took the database's open copy (mergeSubtasks) and wrote it
// back over the tick. One task's writes now go out one after another.
describe("a step's tick and the save right after it", () => {
  it("keeps the tick", async () => {
    const { supabase } = await import("./supabase");
    const { patchSubtaskDb, saveTaskEdit } = await import("./db");
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const reply: Subtask = { id: "s4", title: "Reply to Brian", done: false };
    let stored: Subtask[] = [reply];
    // The tick lands 10ms after it is sent; a whole-list write 20ms after.
    const rpc = vi.spyOn(supabase, "rpc").mockImplementation((async (_fn: string, args: { subtask_id: string; patch: Partial<Subtask> }) => {
      await wait(10);
      stored = stored.map((x) => (x.id === args.subtask_id ? { ...x, ...args.patch } : x));
      return { data: null, error: null };
    }) as never);
    const from = vi.spyOn(supabase, "from").mockImplementation((() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subtasks: JSON.parse(JSON.stringify(stored)) }, error: null }) }) }),
      update: (vals: { subtasks?: Subtask[] }) => ({ eq: () => ({ select: async () => { await wait(20); if (vals.subtasks) stored = vals.subtasks; return { data: [{ id: "t_1" }], error: null }; } }) }),
    })) as never);
    const task: Task = {
      id: "t_1", projectId: "p_x", clientId: "cl_x", title: "Task", description: "",
      status: "in_progress", priority: "none", assigneeId: null, contactId: null, due: null,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [reply], attachments: [],
      comments: [], createdAt: "2026-10-14T00:00:00.000Z",
    };
    // As completeStep does it: the tick, its doneAt, then What's next added.
    const ticked = { ...reply, done: true, doneAt: "2026-10-14T16:05:26.206Z", outcome: "Done" };
    void patchSubtaskDb("t_1", "s4", { done: true }, "u_derek");
    void patchSubtaskDb("t_1", "s4", { doneAt: ticked.doneAt, outcome: "Done" }, "u_derek");
    const next: Subtask = { id: "s5", title: "Reply to Brian: what's next?", done: false, addedFor: "next:s4" };
    await saveTaskEdit({ ...task, subtasks: [ticked] }, { ...task, subtasks: [ticked, next] }, "u_derek");
    expect(stored.map((x) => [x.id, x.done])).toEqual([["s4", true], ["s5", false]]);
    expect(stored[0]).toMatchObject({ doneAt: ticked.doneAt, outcome: "Done" });
    rpc.mockRestore();
    from.mockRestore();
  });
});

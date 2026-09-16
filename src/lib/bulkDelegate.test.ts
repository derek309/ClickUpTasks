import { describe, it, expect } from "vitest";
import { bulkDelegateProblem, bulkDelegateSummary, bulkDelegations, type BulkDelegateSpec, type DelegatableTask } from "./bulkDelegate";

// Handing nine tasks to one person should differ from handing one task nine
// times only in how long it takes. These check that every task still gets a
// handoff of its own, named after itself, and that a batch refuses to half
// happen for the same three reasons a single handoff does.

const spec = (over: Partial<BulkDelegateSpec> = {}): BulkDelegateSpec => ({
  toId: "u_maria", instructions: "Draft the copy and send it back", theirDue: "2026-09-20",
  followUpAt: null, size: null, priority: null, ...over,
});
const task = (id: string, over: Partial<DelegatableTask> = {}): DelegatableTask => ({ id, title: `Task ${id}`, priority: "normal", ...over });

describe("handing a batch over", () => {
  it("makes one handoff per task, all sharing the brief", () => {
    const out = bulkDelegations([task("a"), task("b"), task("c")], spec());
    expect(out.map((o) => o.taskId)).toEqual(["a", "b", "c"]);
    for (const o of out) {
      expect(o.spec.toId).toBe("u_maria");
      expect(o.spec.instructions).toBe("Draft the copy and send it back");
      expect(o.spec.theirDue).toBe("2026-09-20");
    }
  });

  it("names each handoff after its own task, not after the brief", () => {
    const out = bulkDelegations([task("a", { title: "Rewrite the about page" }), task("b", { title: "Fix the footer" })], spec());
    expect(out.map((o) => o.spec.title)).toEqual(["Rewrite the about page", "Fix the footer"]);
  });

  it("falls back to a name from the brief when a task has no title", () => {
    const out = bulkDelegations([task("a", { title: "   " })], spec());
    expect(out[0].spec.title.length).toBeGreaterThan(0);
    expect(out[0].spec.title).not.toBe("   ");
  });

  it("leaves every task on its own priority when none was chosen", () => {
    const out = bulkDelegations([task("a", { priority: "urgent" }), task("b", { priority: "normal" })], spec({ priority: null }));
    expect(out.map((o) => o.spec.priority)).toEqual(["urgent", "normal"]);
  });

  it("applies one priority to all of them when one was chosen", () => {
    const out = bulkDelegations([task("a", { priority: "urgent" }), task("b", { priority: "normal" })], spec({ priority: "none" }));
    expect(out.map((o) => o.spec.priority)).toEqual(["none", "none"]);
  });

  it("passes the follow-up date and size straight through", () => {
    const out = bulkDelegations([task("a")], spec({ followUpAt: "2026-09-25", size: "hour" }));
    expect(out[0].spec.followUpAt).toBe("2026-09-25");
    expect(out[0].spec.size).toBe("hour");
  });

  it("trims the brief once rather than on every task", () => {
    const out = bulkDelegations([task("a"), task("b")], spec({ instructions: "  Do the thing  " }));
    expect(out.map((o) => o.spec.instructions)).toEqual(["Do the thing", "Do the thing"]);
  });

  it("puts no links on a batch, since they ride in the brief", () => {
    expect(bulkDelegations([task("a")], spec())[0].spec.links).toEqual([]);
  });

  it("makes nothing from an empty selection", () => {
    expect(bulkDelegations([], spec())).toEqual([]);
  });
});

describe("what stops a batch going", () => {
  it("refuses without anyone selected", () => {
    expect(bulkDelegateProblem(spec(), 0)).toBe("Select some tasks first.");
  });

  it("refuses without a person, a brief, or a date they owe it by", () => {
    expect(bulkDelegateProblem(spec({ toId: "" }), 3)).toBe("Pick who you are handing these to.");
    expect(bulkDelegateProblem(spec({ instructions: "   " }), 3)).toBe("Say what they need to do.");
    expect(bulkDelegateProblem(spec({ theirDue: "" }), 3)).toBe("Give them a date to have these by.");
  });

  it("allows a complete batch", () => {
    expect(bulkDelegateProblem(spec(), 3)).toBe(null);
  });

  it("counts in the toast, and gets the one-task case right", () => {
    expect(bulkDelegateSummary(1, "Maria")).toBe("Delegated 1 task to Maria");
    expect(bulkDelegateSummary(9, "Maria")).toBe("Delegated 9 tasks to Maria");
  });
});

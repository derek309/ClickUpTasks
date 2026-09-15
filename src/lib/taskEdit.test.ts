import { describe, it, expect } from "vitest";
import { changedTaskColumns } from "./db";
import type { Task } from "./data";

// changedTaskColumns decides what a task edit writes. Anything it wrongly
// includes is a column one window can overwrite for another, so the cases
// that matter are the ones where it must leave comments and checklists out.

const base = {
  id: "t_1", projectId: "p_1", clientId: "cl_1", title: "Flyer", description: "",
  status: "todo", priority: "normal", assigneeId: "u_owner", waitingOnClient: false, contactId: null,
  due: null, recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: false, private: false,
  subtasks: [{ id: "s_1", title: "Proof", done: false }],
  attachments: [], comments: [{ id: "cm_1", authorId: "u_owner", body: "hi", at: "2026-09-15T00:00:00Z" }],
  createdAt: "2026-09-15T00:00:00Z", createdBy: "u_owner",
} as unknown as Task;

describe("changedTaskColumns", () => {
  it("sends only the status for a status change, never comments or the checklist", () => {
    expect(changedTaskColumns(base, { ...base, status: "done" })).toEqual({ status: "done" });
  });

  it("sends nothing when nothing changed", () => {
    expect(changedTaskColumns(base, { ...base })).toEqual({});
  });

  it("sends the checklist and the delegation it implies when an item is handed off", () => {
    const subtasks = [{ id: "s_1", title: "Proof", done: false, assigneeId: "u_va" }];
    const changed = changedTaskColumns(base, { ...base, subtasks } as Task);
    expect(Object.keys(changed).sort()).toEqual(["delegated_to", "subtasks"]);
    expect(changed.delegated_to).toEqual(["u_va"]);
  });

  it("sends only the instructions when they are edited", () => {
    expect(changedTaskColumns(base, { ...base, instructions: "<p>Use the new logo.</p>" })).toEqual({ instructions: "<p>Use the new logo.</p>" });
  });

  it("maps renamed fields to their columns", () => {
    expect(changedTaskColumns(base, { ...base, assigneeId: "u_va", private: true })).toEqual({ assignee_id: "u_va", is_private: true });
  });
});

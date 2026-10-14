import { describe, expect, it } from "vitest";
import { changedTaskColumns, rowToTask } from "./db";

// The queue's columns (supabase/task-queues.sql) must never reach a database
// that has not had the SQL: a save naming a missing column fails outright.
const row = { id: "t1", project_id: "p1", client_id: "cl_x", title: "Video", description: "", status: "todo", priority: "normal", assignee_id: null, contact_id: null, due: "2026-10-14", recurrence: "none", subtasks: [], attachments: [], comments: [], created_at: "2026-10-01T00:00:00Z" };

describe("queue columns before and after the SQL", () => {
  it("a row without them reads as no queue and saves without them", () => {
    const t = rowToTask(row);
    expect(t.queuePos).toBeUndefined();
    expect(t.deadline).toBeUndefined();
    const changed = changedTaskColumns(t, { ...t, title: "Video 2" });
    expect(Object.keys(changed)).toEqual(["title"]);
  });
  it("a row with them reads them and saves a change to them", () => {
    const t = rowToTask({ ...row, queue_pos: 2000, deadline: false, queue_saved_due: null });
    expect(t).toMatchObject({ queuePos: 2000, deadline: false, queueSavedDue: null });
    expect(changedTaskColumns(t, { ...t, queuePos: 1500, due: null, queueSavedDue: "2026-10-14" })).toEqual({ queue_pos: 1500, due: null, queue_saved_due: "2026-10-14" });
  });
});

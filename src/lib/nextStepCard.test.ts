import { describe, expect, it } from "vitest";
import { doneSteps, followUpMoves, stepDateLabel, type TaskAction } from "./data";

describe("stepDateLabel", () => {
  it("names today, tomorrow, late and later", () => {
    expect(stepDateLabel("2026-09-16", "2026-09-16")).toMatchObject({ tone: "soon" });
    expect(stepDateLabel("2026-09-16", "2026-09-16").label.startsWith("Today, ")).toBe(true);
    expect(stepDateLabel("2026-09-17", "2026-09-16").label.startsWith("Tomorrow, ")).toBe(true);
    expect(stepDateLabel("2026-09-14", "2026-09-16")).toMatchObject({ tone: "late" });
    expect(stepDateLabel("2026-09-14", "2026-09-16").label.startsWith("2 days late, ")).toBe(true);
    expect(stepDateLabel("2026-09-15", "2026-09-16").label.startsWith("1 day late, ")).toBe(true);
    expect(stepDateLabel("2026-09-23", "2026-09-16").tone).toBe("later");
    expect(stepDateLabel(null)).toEqual({ label: "Set a date", tone: "none" });
  });
});

describe("followUpMoves", () => {
  it("counts only moves since the step was set", () => {
    const comments = [
      { kind: "event" as const, body: "moved follow up from Sep 10 to Sep 12", at: "2026-09-09T10:00:00Z" },
      { kind: "event" as const, body: "moved follow up from Sep 12 to Sep 14", at: "2026-09-12T10:00:00Z" },
      { kind: "event" as const, body: "set follow up to Sep 14", at: "2026-09-12T11:00:00Z" },
      { kind: "event" as const, body: "moved follow up from Sep 14 to Sep 17", at: "2026-09-14T10:00:00Z" },
      { kind: "comment" as const, body: "moved follow up from nowhere", at: "2026-09-15T10:00:00Z" },
    ];
    expect(followUpMoves(comments, "2026-09-10T00:00:00Z")).toBe(2);
  });
});

describe("doneSteps", () => {
  const a = (id: string, nextStep: string | null, done: string | null): TaskAction => ({
    id, taskId: "t", kind: "note", authorId: null, toId: null, parentId: null, body: "", at: "2026-09-01T00:00:00Z",
    nextStep, nextStepDue: null, nextStepDoneAt: done,
  });
  it("lists the last finished steps in order", () => {
    const rows = [a("1", "Send review", "2026-09-14T00:00:00Z"), a("2", "Open step", null), a("3", "Get content approved", "2026-09-12T00:00:00Z"), a("4", null, "2026-09-15T00:00:00Z")];
    expect(doneSteps(rows).map((s) => s.text)).toEqual(["Get content approved", "Send review"]);
  });
});

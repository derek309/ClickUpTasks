import { describe, it, expect } from "vitest";
import { finishKindOf, handoffDoneEvent, reviewApprovedByTeamEvent } from "./data";

// Each finish is recognised from the exact line that writes it. If a writer's
// wording drifts from its reader, the feed quietly stops showing that kind, so
// these build the lines with the same helpers the writers use.

describe("finishKindOf", () => {
  it("reads a task marked done", () => {
    expect(finishKindOf("changed status from In progress to Done", "u_derek")).toBe("completed");
  });

  it("reads a client approval, by the line clientPublish writes", () => {
    // taskDocumentServer.ts: `${clientName} approved the ${noun} (version ${n})`, author "client".
    expect(finishKindOf("Brian Goodell approved the image review (version 2)", "client")).toBe("client_approved");
    expect(finishKindOf("Pam Macias approved the HTML review (version 1)", "client")).toBe("client_approved");
  });

  it("reads the team approving for the client", () => {
    expect(finishKindOf(reviewApprovedByTeamEvent("video review", 3), "u_derek")).toBe("team_approved");
  });

  it("reads a finished handoff, whatever the name holds", () => {
    expect(finishKindOf(handoffDoneEvent("Schedule Promotional Newsletter"), "u_michaella")).toBe("handoff");
    expect(finishKindOf(handoffDoneEvent(`Fix the "About" page`), "u_michaella")).toBe("handoff");
  });

  it("does not take a teammate's note for a client approval", () => {
    // Only the client writes as "client"; the same words from a person are a note.
    expect(finishKindOf("Brian Goodell approved the image review (version 2)", "u_derek")).toBeNull();
  });

  it("ignores every other activity line", () => {
    expect(finishKindOf("changed status from Todo to In progress", "u_derek")).toBeNull();
    expect(finishKindOf("Brian Goodell asked for changes on the image review (version 2)", "client")).toBeNull();
    expect(finishKindOf("assigned to Michaella Pastrana", "u_derek")).toBeNull();
  });
});

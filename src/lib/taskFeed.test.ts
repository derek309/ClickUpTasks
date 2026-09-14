import { describe, it, expect } from "vitest";
import { describeEvent, eventTopic, foldRuns, followUpAfterStepDone, type TaskAction } from "./data";

const step = (id: string, at: string, due: string | null, done = false): TaskAction => ({
  id, taskId: "t1", kind: "email", authorId: "u1", body: "", at,
  nextStep: `step ${id}`, nextStepDue: due, nextStepDoneAt: done ? at : null,
});

describe("followUpAfterStepDone", () => {
  it("rolls the follow up to the step still open", () => {
    const actions = [step("a", "2026-09-10T10:00:00Z", "2026-09-12"), step("b", "2026-09-14T10:00:00Z", "2026-09-17")];
    expect(followUpAfterStepDone(actions, "b")).toBe("2026-09-12");
  });
  it("clears it when nothing else is open", () => {
    const actions = [step("a", "2026-09-10T10:00:00Z", "2026-09-12", true), step("b", "2026-09-14T10:00:00Z", "2026-09-17")];
    expect(followUpAfterStepDone(actions, "b")).toBeNull();
  });
});

describe("describeEvent", () => {
  it("pulls the new value out of a field change", () => {
    expect(describeEvent("changed status from In progress to Waiting")).toEqual({ text: "set status to", value: "Waiting" });
    expect(describeEvent("set due date to Sep 18")).toEqual({ text: "set due date to", value: "Sep 18" });
    expect(describeEvent("cleared the due date (was Sep 18)")).toEqual({ text: "cleared the due date", value: null });
  });
  it("reads old dashed events the same as the new wording", () => {
    expect(describeEvent("added a link — Orders")).toEqual({ text: "added the link", value: "Orders" });
    expect(describeEvent("added the link Orders")).toEqual({ text: "added the link", value: "Orders" });
    expect(describeEvent("updated the description — Hello")).toEqual({ text: "updated the description: Hello", value: null });
  });
  it("names the new follow up date", () => {
    expect(describeEvent("moved follow up from Sep 17 to Sep 15")).toEqual({ text: "set the follow up to", value: "Sep 15" });
    expect(describeEvent("set follow up to Sep 10")).toEqual({ text: "set the follow up to", value: "Sep 10" });
  });
  it("leaves anything else as written", () => {
    expect(describeEvent("cleared the follow up (was Aug 31)")).toEqual({ text: "cleared the follow up (was Aug 31)", value: null });
  });
});

describe("eventTopic", () => {
  it("names what a change is about", () => {
    expect(eventTopic("changed status from Todo to Waiting")).toBe("status");
    expect(eventTopic("moved follow up from Sep 17 to Sep 15")).toBe("follow up");
    expect(eventTopic("added a link — Mail")).toBe("links");
    expect(eventTopic("attached flyer.pdf")).toBe("files");
  });
});

describe("foldRuns", () => {
  it("gathers consecutive changes and keeps order", () => {
    const items = ["c1", "c2", "m1", "c3", "m2", "c4", "c5", "c6"];
    expect(foldRuns(items, (s) => s.startsWith("c"))).toEqual([{ run: ["c1", "c2"] }, "m1", "c3", "m2", { run: ["c4", "c5", "c6"] }]);
  });
  it("returns nothing for nothing", () => {
    expect(foldRuns([], () => true)).toEqual([]);
  });
});

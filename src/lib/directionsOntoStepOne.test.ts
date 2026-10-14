import { describe, expect, it } from "vitest";
import { directionsOntoStepOne, type Subtask } from "./data";

// A new task's directions go on step 1, never the task's description
// (Derek, 2026-10-14).
const s = (id: string, title: string, extra: Partial<Subtask> = {}): Subtask => ({ id, title, done: false, ...extra });
const NOW = "2026-10-14T12:00:00.000Z";

describe("directions onto step 1", () => {
  it("no steps: step 1 is made, named for the task, started, with the directions", () => {
    const out = directionsOntoStepOne([], "<p>Swap the logo</p>", "New logo", () => "s_1", NOW);
    expect(out).toEqual([{ id: "s_1", title: "New logo", done: false, notes: "<p>Swap the logo</p>", startedAt: NOW }]);
  });
  it("step 1 there: the directions go on the end of its own", () => {
    const out = directionsOntoStepOne([s("a", "For Matt", { notes: "<p>Mine</p>" }), s("b", "Send")], "<p>More</p>", "X", () => "s_new", NOW);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
    expect(out[0].notes).toBe("<p>Mine</p><p>More</p>");
    expect(out[1].notes).toBeUndefined();
  });
  it("a client's change is not step 1", () => {
    const out = directionsOntoStepOne([s("c", "Their ask", { fromClient: true }), s("a", "Draft")], "<p>Do it</p>", "X", () => "s_new", NOW);
    expect(out.find((x) => x.id === "a")?.notes).toBe("<p>Do it</p>");
    expect(out.find((x) => x.id === "c")?.notes).toBeUndefined();
  });
  it("nothing to write leaves the steps alone", () => {
    const list = [s("a", "Draft")];
    expect(directionsOntoStepOne(list, "<p> </p>", "X", () => "s_new", NOW)).toBe(list);
    expect(directionsOntoStepOne([], "", "X", () => "s_new", NOW)).toEqual([]);
  });
  it("a task named with the whole request names step 1 with its first words", () => {
    const long = "Please update the homepage hero so it says we are open on Saturdays now. Also the phone number is wrong.";
    const out = directionsOntoStepOne([], "<p>x</p>", long, () => "s_1", NOW);
    expect(out[0].title).toBe("Please update the homepage hero so it says");
  });
});

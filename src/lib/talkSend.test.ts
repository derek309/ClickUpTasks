import { describe, expect, it } from "vitest";
import { talkSendPatch, talkStepPlan } from "./talkSend";
import type { Subtask } from "./data";

const step = (p: Partial<Subtask> & Pick<Subtask, "id" | "title">): Subtask => ({ done: false, ...p } as Subtask);
const NOW = "2026-10-14T17:00:00.000Z";
let n = 0;
const makeId = () => `s_new${++n}`;

describe("talkStepPlan", () => {
  it("finishes a text step holding the text, from that step", () => {
    const subs = [step({ id: "a", title: "Text Pamela", draftMessage: { channel: "sms", body: "Hi" } })];
    const plan = talkStepPlan(subs, null, "sms", "2026-10-14", null, "a");
    expect(plan?.kind).toBe("finish");
    expect(plan?.due).toBe("2026-10-19");
  });
  it("follows up on a check in that is waiting on their reply", () => {
    const subs = [step({ id: "a", title: "Email Pamela", done: true }), step({ id: "b", title: "Check in", finishWhen: "reply" })];
    expect(talkStepPlan(subs, null, "email", "2026-10-14")?.kind).toBe("wait");
  });
  it("leaves a step that isn't about talking to them", () => {
    expect(talkStepPlan([step({ id: "a", title: "Design the page" })], null, "email", "2026-10-14")).toBeNull();
  });
});

describe("talkSendPatch", () => {
  it("ticks the step, clears its draft and adds the check in", () => {
    const subs = [step({ id: "a", title: "Text Pamela", draftMessage: { channel: "sms", body: "Hi" } })];
    const plan = talkStepPlan(subs, null, "sms", "2026-10-14", null, "a")!;
    const out = talkSendPatch({ subtasks: subs, status: "todo", due: "2026-10-15", assigneeId: null }, plan, "sms", "Pamela", makeId, NOW)!;
    const list = out.patch.subtasks!;
    expect(list[0]).toMatchObject({ id: "a", done: true, outcome: "Text sent to Pamela", draftMessage: undefined });
    expect(list[1]).toMatchObject({ title: "Check in if Pamela hasn't replied", finishWhen: "reply", due: "2026-10-19" });
    expect(out.patch.followUpAt).toBe("2026-10-19");
    expect(out.patch.due).toBe("2026-10-19");
  });
  it("records a follow up on a wait and clears the draft", () => {
    const subs = [step({ id: "b", title: "Check in", finishWhen: "reply", draftMessage: { channel: "sms", body: "Nudge" } })];
    const plan = talkStepPlan(subs, null, "sms", "2026-10-14")!;
    const out = talkSendPatch({ subtasks: subs, status: "waiting", due: null, assigneeId: null }, plan, "sms", "Pamela", makeId, NOW)!;
    expect(out.patch.subtasks![0]).toMatchObject({ draftMessage: undefined, followUps: [{ via: "sms", at: NOW }] });
  });
});
